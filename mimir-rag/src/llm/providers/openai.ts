import { Logger } from "pino";
import { BaseChatProvider, BaseEmbeddingProvider } from "../base";
import type { ChatModelConfig, EmbeddingModelConfig } from "../../config/types";
import type { EmbedOptions, GenerateAnswerOptions, StructuredAnswerResult } from "../types";
import { buildPromptMessages, answerWithSourcesSchema } from "../prompt";
import { createOpenAI } from '@ai-sdk/openai';
import { embedMany, generateObject, streamObject, generateText } from 'ai';
import { resolveBaseUrl, mergeLimits } from "../../utils/providerUtils";

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1/";

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
            baseURL: resolveBaseUrl(config.baseUrl, OPENAI_DEFAULT_BASE_URL),
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
            baseURL: resolveBaseUrl(config.baseUrl, OPENAI_DEFAULT_BASE_URL),
        });
    }

    protected async complete(options: GenerateAnswerOptions): Promise<StructuredAnswerResult | AsyncIterable<StructuredAnswerResult>> {
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

    protected async completeEntityContext(systemPrompt: string, userPrompt: string): Promise<string> {
        const model = this.sdk(this.config.model);

        const { text } = await generateText({
            model,
            system: systemPrompt,
            prompt: userPrompt,
            temperature: this.config.temperature,
            maxTokens: this.config.maxOutputTokens ?? 500,
        });

        return text;
    }
}
