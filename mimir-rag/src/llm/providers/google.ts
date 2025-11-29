import { Logger } from "pino";
import { BaseChatProvider, BaseEmbeddingProvider, type ProviderRateLimits } from "../base";
import type { ChatModelConfig, EmbeddingModelConfig, ProviderLimitsConfig } from "../../config/types";
import type { EmbedOptions, GenerateAnswerOptions } from "../types";
import { buildPromptMessages } from "../prompt";
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { embedMany, generateText, streamText } from 'ai';

const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/";

function resolveBaseUrl(url?: string): string {
    if (!url) {
        return GEMINI_DEFAULT_BASE_URL;
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

export class GoogleEmbeddingProvider extends BaseEmbeddingProvider {
    private readonly sdk: ReturnType<typeof createGoogleGenerativeAI>;

    constructor(config: EmbeddingModelConfig, logger?: Logger) {
        if (!config.apiKey) {
            throw new Error("Google Generative AI API key is required for embeddings.");
        }

        super(
            config,
            mergeLimits(
                {
                    batchSize: 16,
                    concurrency: 3,
                    maxRequestsPerMinute: 300,
                    maxTokensPerMinute: 1_000_000,
                    retries: 5,
                },
                config.limits
            ),
            logger
        );

        this.sdk = createGoogleGenerativeAI({
            apiKey: config.apiKey,
            baseURL: resolveBaseUrl(config.baseUrl),
        });
    }

    protected async sendEmbeddingRequest(chunks: string[], options?: EmbedOptions): Promise<number[][]> {
        const model = this.sdk.textEmbeddingModel(this.config.model);
        const { embeddings } = await embedMany({
            model,
            values: chunks,
            abortSignal: options?.signal,
        });

        return embeddings;
    }
}

export class GoogleChatProvider extends BaseChatProvider {
    private readonly sdk: ReturnType<typeof createGoogleGenerativeAI>;

    constructor(config: ChatModelConfig, logger?: Logger) {
        if (!config.apiKey) {
            throw new Error("Google Generative AI API key is required for chat completions.");
        }

        super(
            config,
            mergeLimits(
                {
                    concurrency: 3,
                    maxRequestsPerMinute: 90,
                    maxTokensPerMinute: 300_000,
                    retries: 5,
                },
                config.limits
            ),
            logger
        );

        this.sdk = createGoogleGenerativeAI({
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
