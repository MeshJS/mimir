import { Logger } from "pino";
import { BaseChatProvider, BaseEmbeddingProvider, type ProviderRateLimits } from "../base";
import type { ChatModelConfig, EmbeddingModelConfig, ProviderLimitsConfig } from "../../config/types";
import type { EmbedOptions, GenerateAnswerOptions } from "../types";
import { buildPromptMessages } from "../prompt";
import { createOpenAI } from '@ai-sdk/openai';
import { embedMany, generateText, streamText } from 'ai';

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1/";

function resolveBaseUrl(url?: string): string {
    if (!url) {
        return OPENAI_DEFAULT_BASE_URL;
    }
    return url.endsWith("/") ? url : `${url}/`;
}

function mergeLimits(defaults: ProviderRateLimits, override?: ProviderLimitsConfig): ProviderRateLimits {
    if (!override) {
        return defaults;
    }

    return {
        ...defaults,
        ...override,
    };
}

export class OpenAIEmbeddingProvider extends BaseEmbeddingProvider {
    private readonly sdk: ReturnType<typeof createOpenAI>;

    constructor(config: EmbeddingModelConfig, logger?: Logger) {
        if (!config.apiKey) {
            throw new Error("OpenAI API key is required for embeddings.");
        }

        super(
            config,
            mergeLimits(
                {
                    batchSize: 100,
                    concurrency: 4,
                    maxRequestsPerMinute: 1_500,
                    maxTokensPerMinute: 6_250_000,
                    retries: 6,
                },
                config.limits
            ),
            logger
        );

        this.sdk = createOpenAI({
            apiKey: config.apiKey,
            baseURL: resolveBaseUrl(config.baseUrl),
        });
    }

    protected async sendEmbeddingRequest(chunks: string[], options?: EmbedOptions): Promise<number[][]> {
        const model = this.sdk.embedding(this.config.model);
        const { embeddings } = await embedMany({
            model,
            values: chunks,
            abortSignal: options?.signal,
        });

        return embeddings;
    }
}

export class OpenAIChatProvider extends BaseChatProvider {
    private readonly sdk: ReturnType<typeof createOpenAI>;

    constructor(config: ChatModelConfig, logger?: Logger) {
        if (!config.apiKey) {
            throw new Error("OpenAI API key is required for chat completions.");
        }

        super(
            config,
            mergeLimits(
                {
                    concurrency: 3,
                    maxRequestsPerMinute: 500,
                    maxTokensPerMinute: 90_000,
                    retries: 5,
                },
                config.limits
            ),
            logger
        );

        this.sdk = createOpenAI({
            apiKey: config.apiKey,
            baseURL: resolveBaseUrl(config.baseUrl),
        });
    }

    protected async complete(options: GenerateAnswerOptions): Promise<string | AsyncIterable<string>> {
        const { system, user } = buildPromptMessages(options);
        const model = this.sdk(this.config.model);

        const baseOptions = {
            model,
            system,
            prompt: user,
            temperature: options.temperature ?? this.config.temperature,
            maxTokens: options.maxTokens ?? this.config.maxOutputTokens,
            abortSignal: options.signal,
        };

        if (options.stream) {
            const { textStream } = await streamText(baseOptions);
            return textStream;
        }

        const { text } = await generateText(baseOptions);
        return text.trim();
    }
}
