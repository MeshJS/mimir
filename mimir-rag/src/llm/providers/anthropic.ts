import { Logger } from "pino";
import { BaseChatProvider, type ProviderRateLimits } from "../base";
import type { ChatModelConfig, ProviderLimitsConfig } from "../../config/types";
import type { GenerateAnswerOptions } from "../types";
import { buildPromptMessages } from "../prompt";
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, streamText } from 'ai';

const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com/";

function resolveBaseUrl(url?: string): string {
    if (!url) {
        return ANTHROPIC_DEFAULT_BASE_URL;
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
