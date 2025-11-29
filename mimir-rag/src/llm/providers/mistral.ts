import { Logger } from "pino";
import { BaseChatProvider, BaseEmbeddingProvider, type ProviderRateLimits } from "../base";
import type { ChatModelConfig, EmbeddingModelConfig, ProviderLimitsConfig } from "../../config/types";
import type { EmbedOptions, GenerateAnswerOptions } from "../types";
import { buildPromptMessages } from "../prompt";
import { createMistral } from '@ai-sdk/mistral';
import { embedMany, generateText, streamText } from 'ai';

const MISTRAL_DEFAULT_BASE_URL = "https://api.mistral.ai/";

function resolveBaseUrl(url?: string): string {
    if (!url) {
        return MISTRAL_DEFAULT_BASE_URL;
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

export class MistralEmbeddingProvider extends BaseEmbeddingProvider {
    private readonly sdk: ReturnType<typeof createMistral>;

    constructor(config: EmbeddingModelConfig, logger?: Logger) {
        if (!config.apiKey) {
            throw new Error("Mistral API key is required for embeddings.");
        }

        super(
            config,
            mergeLimits(
                {
                    batchSize: 64,
                    concurrency: 3,
                    maxRequestsPerMinute: 600,
                    maxTokensPerMinute: 1_000_000,
                    retries: 5,
                },
                config.limits
            ),
            logger
        );

        this.sdk = createMistral({
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

export class MistralChatProvider extends BaseChatProvider {
    private readonly sdk: ReturnType<typeof createMistral>;

    constructor(config: ChatModelConfig, logger?: Logger) {
        if (!config.apiKey) {
            throw new Error("Mistral API key is required for chat completions.");
        }

        super(
            config,
            mergeLimits(
                {
                    concurrency: 4,
                    maxRequestsPerMinute: 200,
                    maxTokensPerMinute: 400_000,
                    retries: 5,
                },
                config.limits
            ),
            logger
        );

        this.sdk = createMistral({
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
