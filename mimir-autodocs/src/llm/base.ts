import { createRateLimiter } from "../utils/rateLimiter";
import pLimit from "p-limit";
import pRetry from "p-retry";
import { ChatModelConfig, EmbeddingModelConfig } from "../config/types";
import { batchChunks } from "../utils/batchChunks";
import type { ChatProvider, EmbedOptions, EmbeddingProvider, EntityContextInput } from "./types";
import { buildBatchContextPrompt, getEntityContextSystemPrompt, parseNumberedResponse } from "./prompts";
import Bottleneck from "bottleneck";
import { Logger } from "pino";
import { countTokensInBatch, countTokens } from "../utils/tokenEncoder";

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
        public readonly config: EmbeddingModelConfig,
        limits: ProviderRateLimits,
        protected readonly logger?: Logger
    ) {
        this.batchSize = limits.batchSize ?? 50;
        this.retries = limits.retries ?? 5;
        this.concurrencyLimit = Math.max(1, limits.concurrency ?? 5);

        this.requestLimiter = createRateLimiter(this.concurrencyLimit, limits.maxRequestsPerMinute);

        if (limits.maxTokensPerMinute && Number.isFinite(limits.maxTokensPerMinute)) {
            const tokenConcurrency = Math.max(
                this.concurrencyLimit,
                Math.ceil(limits.maxTokensPerMinute)
            );
            this.tokenLimiter = createRateLimiter(tokenConcurrency, limits.maxTokensPerMinute);
        }
    }

    async embedDocuments(chunks: string[], options?: EmbedOptions): Promise<number[][]> {
        if (chunks.length === 0) {
            return [];
        }

        const effectiveBatchSize = this.batchSize * 2;
        const batches = batchChunks(chunks, effectiveBatchSize)
            .map((batch, idx) => ({
                idx,
                batch,
                tokens: countTokensInBatch(batch, this.config.model),
            }));

        const limit = pLimit(this.concurrencyLimit);
        const logPrefix = `${this.config.provider}:embed`;
        const results = await Promise.all(
            batches.map(({ batch, idx, tokens }) =>
                limit(async () => {
                    const embeddings = await this.scheduleWithRateLimits(
                        tokens,
                        () => this.sendEmbeddingRequest(batch, options),
                        { logPrefix, signal: options?.signal }
                    );
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

    private async scheduleWithRateLimits<T>(
        tokens: number,
        task: () => Promise<T>,
        { logPrefix, signal }: ScheduleOptions
    ): Promise<T> {
        await this.reserveTokens(tokens);
        return this.requestLimiter.schedule(() =>
            pRetry(task, {
                retries: this.retries,
                signal,
                onFailedAttempt: (error: any) => {
                    this.logger?.warn(
                        {
                            attemptNumber: error.attemptNumber,
                            retriesLeft: error.retriesLeft,
                            error: error.message,
                        },
                        `${logPrefix} failed attempt`
                    );
                },
            })
        );
    }

    private async reserveTokens(tokens: number): Promise<void> {
        if (!this.tokenLimiter || tokens <= 0) {
            return;
        }

        const weight = Math.max(1, Math.ceil(tokens));
        await this.tokenLimiter.schedule({ weight }, async () => undefined);
    }
}

export abstract class BaseChatProvider implements ChatProvider {
    protected readonly concurrencyLimit: number;
    protected readonly retries: number;

    private readonly requestLimiter: Bottleneck;
    private readonly tokenLimiter?: Bottleneck;

    constructor(
        public readonly config: ChatModelConfig,
        limits: ProviderRateLimits,
        protected readonly logger?: Logger
    ) {
        this.retries = limits.retries ?? 5;
        this.concurrencyLimit = Math.max(1, limits.concurrency ?? 5);

        this.requestLimiter = createRateLimiter(this.concurrencyLimit, limits.maxRequestsPerMinute);

        if (limits.maxTokensPerMinute && Number.isFinite(limits.maxTokensPerMinute)) {
            const tokenConcurrency = Math.max(
                this.concurrencyLimit,
                Math.ceil(limits.maxTokensPerMinute)
            );
            this.tokenLimiter = createRateLimiter(tokenConcurrency, limits.maxTokensPerMinute);
        }
    }

    async generateEntityContexts(entities: EntityContextInput[], fileContent: string): Promise<string[]> {
        if (entities.length === 0) {
            return [];
        }

        // Process in smaller batches to avoid context limits
        const BATCH_SIZE = 5;
        const batches = batchChunks(entities, BATCH_SIZE);
        const allContexts: string[] = [];

        const limit = pLimit(Math.max(1, this.concurrencyLimit));

        const batchResults = await Promise.all(
            batches.map((batch, batchIndex) =>
                limit(async () => {
                    const systemPrompt = getEntityContextSystemPrompt();
                    const userPrompt = buildBatchContextPrompt(batch, fileContent);

                    const tokens = this.estimateTokens(systemPrompt, userPrompt);
                    const response = await this.scheduleWithRateLimits(
                        tokens,
                        () => this.complete(systemPrompt, userPrompt),
                        { logPrefix: `${this.config.provider}:context`, signal: undefined }
                    );

                    const contexts = parseNumberedResponse(response, batch.length);
                    return { batchIndex, contexts };
                })
            )
        );

        // Sort by batch index and flatten
        batchResults
            .sort((a, b) => a.batchIndex - b.batchIndex)
            .forEach(({ contexts }) => allContexts.push(...contexts));

        return allContexts;
    }

    protected estimateTokens(systemPrompt: string, userPrompt: string): number {
        const model = this.config.model;
        let tokens = countTokens(systemPrompt, model);
        tokens += countTokens(userPrompt, model);
        tokens += this.config.maxOutputTokens ?? 500;
        return tokens;
    }

    protected abstract complete(systemPrompt: string, userPrompt: string): Promise<string>;

    private async scheduleWithRateLimits<T>(
        tokens: number,
        task: () => Promise<T>,
        { logPrefix, signal }: ScheduleOptions
    ): Promise<T> {
        await this.reserveTokens(tokens);
        return this.requestLimiter.schedule(() =>
            pRetry(task, {
                retries: this.retries,
                signal,
                onFailedAttempt: (error: any) => {
                    this.logger?.warn(
                        {
                            attemptNumber: error.attemptNumber,
                            retriesLeft: error.retriesLeft,
                            error: error.message,
                        },
                        `${logPrefix} failed attempt`
                    );
                },
            })
        );
    }

    private async reserveTokens(tokens: number): Promise<void> {
        if (!this.tokenLimiter || tokens <= 0) {
            return;
        }

        const weight = Math.max(1, Math.ceil(tokens));
        await this.tokenLimiter.schedule({ weight }, async () => undefined);
    }
}

