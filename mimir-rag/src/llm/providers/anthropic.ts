import { Logger } from "pino";
import { BaseChatProvider } from "../base";
import type { ChatModelConfig } from "../../config/types";
import type { GenerateAnswerOptions, StructuredAnswerResult } from "../types";
import { buildPromptMessages, answerWithSourcesSchema } from "../prompt";
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateObject, streamObject } from 'ai';
import { resolveBaseUrl, mergeLimits } from "../../utils/providerUtils";

const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com/";

export class AnthropicChatProvider extends BaseChatProvider {
    private readonly sdk: ReturnType<typeof createAnthropic>;

    constructor(config: ChatModelConfig, logger?: Logger) {
        if (!config.apiKey) {
            throw new Error("Anthropic API key is required for chat completions.");
        }

        super(
            config,
            mergeLimits(
                {
                    concurrency: 4,
                    maxRequestsPerMinute: 200,
                    maxTokensPerMinute: 200_000,
                    retries: 5,
                },
                config.limits
            ),
            logger
        );

        this.sdk = createAnthropic({
            apiKey: config.apiKey,
            baseURL: resolveBaseUrl(config.baseUrl, ANTHROPIC_DEFAULT_BASE_URL),
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
}
