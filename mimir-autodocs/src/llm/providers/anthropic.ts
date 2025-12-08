import { Logger } from "pino";
import { BaseChatProvider } from "../base";
import type { ChatModelConfig } from "../../config/types";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
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

    protected async complete(systemPrompt: string, userPrompt: string): Promise<string> {
        const model = this.sdk(this.config.model);

        const { text } = await generateText({
            model,
            system: systemPrompt,
            prompt: userPrompt,
            temperature: this.config.temperature,
            maxTokens: this.config.maxOutputTokens,
        });

        return text;
    }
}

