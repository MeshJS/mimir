import { createRateLimiter } from "../utils/rateLimiter";
import pLimit from "p-limit";
import pRetry, { type FailedAttemptError } from "p-retry";
import { getLogger } from "../utils/logger";
import { AppConfig, LLMModelConfig } from "../config/types";
import type { DocumentChunk } from "../supabase/types";
import { batchChunks } from "../utils/batchChunks";
import type { ChatProvider, EmbedOptions, EmbeddingProvider, GenerateAnswerOptions } from "./types";
import Bottleneck from "bottleneck";
import { Logger } from "pino";
import { countTokensInBatch } from "../utils/tokenEncoder";

export interface ProviderRateLimits {
    batchSize?: number;
    concurrency?: number;
    maxRequestsPerMinute?: number;
    maxTokensPerMinute?: number;
    retries?: number;
}

interface ScheduleOptions {
    logPrefix: string;
    signal?: AbortSignal;
}

export abstract class BaseEmbeddingProvider implements EmbeddingProvider {
    protected readonly concurrencyLimit: number;
    protected readonly batchSize: number;
    protected readonly retries: number;

    private readonly requestLimiter: Bottleneck;
    private readonly tokenLimiter?: Bottleneck;

    constructor(
        public readonly config: LLMModelConfig,
        limits: ProviderRateLimits,
        protected readonly logger?: Logger
    ) {
        this.batchSize = limits.batchSize ?? 50;
        this.retries = limits.retries ?? 5;
        this.concurrencyLimit = Math.max(1, limits.concurrency ?? 5);

        this.requestLimiter = createRateLimiter(this.concurrencyLimit, limits.maxRequestsPerMinute);

        if(limits.maxTokensPerMinute && Number.isFinite(limits.maxTokensPerMinute)) {
            this.tokenLimiter = createRateLimiter(this.concurrencyLimit, limits.maxTokensPerMinute);
        }
    }

    async embedDocuments(chunks: string[], options?: EmbedOptions): Promise<number[][]> {
        if(chunks.length === 0) {
            return [];
        }

        const effectiveBatchSize = this.batchSize * 2;
        const batches = batchChunks(chunks, effectiveBatchSize)
            .map((batch, idx) => ({
                idx, batch, tokens: countTokensInBatch(batch, this.config.embeddingModel)
            }));
        
        const limit = pLimit(this.concurrencyLimit);
        const logPrefix = `${this.config.provider}:embed`;
        const results = await Promise.all(
            batches.map(({ batch, idx, tokens }) => 
                limit(async () => {
                    const embeddings = await this.scheduleWithRateLimits(tokens, () => this.sendEmbeddingRequest(batch, options), { logPrefix, signal: options?.signal });
                    return { idx, embeddings };
                })
            )
        );

        const ordered = results.sort((a, b) => a.idx - b.idx);
        return ordered.flatMap((entry) => entry.embeddings);
    }

    async embedQuery(query: string, options?: EmbedOptions): Promise<number[]> {
        const [embedding] = await this.embedDocuments([query], options);
        return embedding;
    }

    protected abstract sendEmbeddingRequest(chunks: string[], options?: EmbedOptions): Promise<number[][]>;

    private async scheduleWithRateLimits<T>(tokens: number, task: () => Promise<T>, { logPrefix, signal }: ScheduleOptions): Promise<T> {
        await this.reserveTokens(tokens);
        return this.requestLimiter.schedule(() => 
            pRetry(task, { retries: this.retries, signal, onFailedAttempt: (error: FailedAttemptError) => {
                this.logger?.warn(
                    {
                        attemptNumber: error.attemptNumber,
                        retriesLeft: error.retriesLeft,
                        error: error.message,
                    },
                    `${logPrefix} failed attempt`
                );
            }})
        );
    }

    private async reserveTokens(tokens: number): Promise<void> {
        if(!this.tokenLimiter || tokens <= 0) {
            return;
        }

        const weight = Math.max(1, Math.ceil(tokens));
        await this.tokenLimiter.schedule({ weight }, async () => undefined);
    }
}