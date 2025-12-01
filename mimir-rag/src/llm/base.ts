import { createRateLimiter } from "../utils/rateLimiter";
import pLimit from "p-limit";
import pRetry from "p-retry";
import { ChatModelConfig, EmbeddingModelConfig } from "../config/types";
import { batchChunks } from "../utils/batchChunks";
import type { ChatProvider, EmbedOptions, EmbeddingProvider, GenerateAnswerOptions, StructuredAnswerResult } from "./types";
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

        if(limits.maxTokensPerMinute && Number.isFinite(limits.maxTokensPerMinute)) {
            const tokenConcurrency = Math.max(
                this.concurrencyLimit,
                Math.ceil(limits.maxTokensPerMinute)
            );
            this.tokenLimiter = createRateLimiter(tokenConcurrency, limits.maxTokensPerMinute);
        }
    }

    async embedDocuments(chunks: string[], options?: EmbedOptions): Promise<number[][]> {
        if(chunks.length === 0) {
            return [];
        }

        const effectiveBatchSize = this.batchSize * 2;
        const batches = batchChunks(chunks, effectiveBatchSize)
            .map((batch, idx) => ({
                idx, batch, tokens: countTokensInBatch(batch, this.config.model)
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
            pRetry(task, { retries: this.retries, signal, onFailedAttempt: (error: any) => {
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

        if(limits.maxTokensPerMinute && Number.isFinite(limits.maxTokensPerMinute)) {
            const tokenConcurrency = Math.max(
                this.concurrencyLimit,
                Math.ceil(limits.maxTokensPerMinute)
            );
            this.tokenLimiter = createRateLimiter(tokenConcurrency, limits.maxTokensPerMinute);
        }
    }

    async generateAnswer(options: GenerateAnswerOptions & { stream?: false }): Promise<StructuredAnswerResult>;
    async generateAnswer(options: GenerateAnswerOptions & { stream: true }): Promise<AsyncIterable<StructuredAnswerResult>>;
    async generateAnswer(options: GenerateAnswerOptions): Promise<StructuredAnswerResult | AsyncIterable<StructuredAnswerResult>> {
        const tokens = this.estimateChatTokens(options);
        return this.scheduleWithRateLimits(tokens, () => this.complete(options), {
            logPrefix: `${this.config.provider}:chat`,
            signal: options.signal,
        })
    }

    async generateFileChunkContexts(chunks: string[], fileContent: string): Promise<string[]> {
        if(chunks.length === 0) {
            return [];
        }

        const systemPrompt = "Please give a short succinct context (150-250 tokens) to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else.";

        const userPrompt = "Summarize how this chunk fits into the broader file. Highlight the chunk's role, upstream dependencies, and any follow-on sections a reader should review."

        const limit = pLimit(Math.max(1, this.concurrencyLimit));
        const response = await Promise.all(
            chunks.map((chunk) => limit(() => this.generateAnswer({
                prompt: userPrompt,
                context: {
                    chunkContent: chunk,
                    fileContent: fileContent,
                },
                systemPrompt,
                maxTokens: Math.min(250, this.config.maxOutputTokens ?? 250),
                temperature: this.config.temperature
            })))
        );

        return response.map((result) => result.answer.trim());
    }

    protected estimateChatTokens(options: GenerateAnswerOptions): number {
        const model = this.config.model;
        let tokens = countTokens(options.prompt, model);

        if(options.systemPrompt) {
            tokens += countTokens(options.systemPrompt, model);
        }

        if(Array.isArray(options.context)) {
            tokens += options.context.reduce((sum, chunk) => sum + countTokens(chunk.contextualText, model), 0);
        } else {
            tokens += countTokens(options.context.chunkContent + options.context.fileContent, model);
        }

        tokens += options.maxTokens ?? this.config.maxOutputTokens ?? 2000;
        return tokens;
    }

    protected abstract complete(options: GenerateAnswerOptions): Promise<StructuredAnswerResult | AsyncIterable<StructuredAnswerResult>>;

    private async scheduleWithRateLimits<T>(tokens: number, task: () => Promise<T>, { logPrefix, signal }: ScheduleOptions): Promise<T> {
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
                            error: error.message
                        },
                        `${logPrefix} failed attempt`
                    );
                }
            })
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
