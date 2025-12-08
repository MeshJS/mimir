import { Logger } from "pino";
import { BaseChatProvider, BaseEmbeddingProvider } from "../base";
import type { ChatModelConfig, EmbeddingModelConfig } from "../../config/types";
import type { EmbedOptions, GenerateAnswerOptions, StructuredAnswerResult } from "../types";
import { createMistral } from "@ai-sdk/mistral";
import { embedMany, generateText, generateObject, streamObject } from "ai";
import { resolveBaseUrl, mergeLimits } from "../../utils/providerUtils";
import { buildPromptMessages, answerWithSourcesSchema } from "../prompt";

const MISTRAL_DEFAULT_BASE_URL = "https://api.mistral.ai/";

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
            baseURL: resolveBaseUrl(config.baseUrl, MISTRAL_DEFAULT_BASE_URL),
        });
    }

    protected async sendEmbeddingRequest(chunks: string[], options?: EmbedOptions): Promise<number[][]> {
        const model = this.sdk.textEmbedding(this.config.model);
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
            baseURL: resolveBaseUrl(config.baseUrl, MISTRAL_DEFAULT_BASE_URL),
        });
    }

    protected async complete(systemPrompt: string, userPrompt: string): Promise<string> {
        const model = this.sdk(this.config.model);

        const { text } = await generateText({
            model,
            system: systemPrompt,
            prompt: userPrompt,
            temperature: this.config.temperature,
            maxOutputTokens: this.config.maxOutputTokens,
        });

        return text;
    }

    protected async completeAnswer(options: GenerateAnswerOptions): Promise<StructuredAnswerResult | AsyncIterable<StructuredAnswerResult>> {
        const { system, user } = buildPromptMessages(options);
        const model = this.sdk(this.config.model);

        const baseOptions = {
            model,
            system,
            prompt: user,
            temperature: options.temperature ?? this.config.temperature,
            maxOutputTokens: options.maxTokens ?? this.config.maxOutputTokens,
            abortSignal: options.signal,
        };

        if (options.stream) {
            const { partialObjectStream } = streamObject({
                ...baseOptions,
                schema: answerWithSourcesSchema,
            });
            return partialObjectStream as AsyncIterable<StructuredAnswerResult>;
        }

        const { object } = await generateObject({
            ...baseOptions,
            schema: answerWithSourcesSchema,
        });
        return object as StructuredAnswerResult;
    }
}

