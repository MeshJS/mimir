import { Logger } from "pino";
import { BaseChatProvider, type ProviderRateLimits } from "../base";
import type { ChatModelConfig, ProviderLimitsConfig } from "../../config/types";
import type { GenerateAnswerOptions } from "../types";
import { buildPromptMessages } from "../prompt";

interface AnthropicMessageContent {
    type?: string;
    text?: string;
}

interface AnthropicMessageResponse {
    content?: AnthropicMessageContent[];
    error?: {
        message?: string;
    };
}

const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com/";
const ANTHROPIC_DEFAULT_VERSION = "2023-06-01";

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

async function parseAnthropicError(response: Response, fallback: string): Promise<never> {
    let details = fallback;

    try {
        const body = (await response.json()) as AnthropicMessageResponse;
        const message = body?.error?.message ?? fallback;
        details = message;
    } catch {
        try {
            details = await response.text();
        } catch {
            // fall through with existing details
        }
    }

    throw new Error(details);
}

function extractContentText(payload: AnthropicMessageResponse): string {
    if (!Array.isArray(payload.content) || payload.content.length === 0) {
        throw new Error("Anthropic returned an empty response.");
    }

    const text = payload.content
        .map((entry) => entry?.text ?? "")
        .join("")
        .trim();

    if (!text) {
        throw new Error("Anthropic returned an empty response.");
    }

    return text;
}

export class AnthropicChatProvider extends BaseChatProvider {
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly apiVersion: string;

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

        this.apiKey = config.apiKey;
        this.baseUrl = resolveBaseUrl(config.baseUrl);
        this.apiVersion = process.env.ANTHROPIC_API_VERSION ?? ANTHROPIC_DEFAULT_VERSION;
    }

    protected async complete(options: GenerateAnswerOptions): Promise<string> {
        const { system, user } = buildPromptMessages(options);
        const url = new URL("v1/messages", this.baseUrl);

        const maxTokens = Math.max(1, Math.floor(options.maxTokens ?? this.config.maxOutputTokens ?? 1000));
        const temperature = options.temperature ?? this.config.temperature;

        const payload: Record<string, unknown> = {
            model: this.config.model,
            max_tokens: maxTokens,
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: user,
                        },
                    ],
                },
            ],
        };

        if (typeof temperature === "number") {
            payload.temperature = temperature;
        }

        const trimmedSystem = system?.trim();
        if (trimmedSystem) {
            payload.system = trimmedSystem;
        }

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": this.apiKey,
                "anthropic-version": this.apiVersion,
            },
            body: JSON.stringify(payload),
            signal: options.signal,
        });

        if (!response.ok) {
            await parseAnthropicError(response, `Anthropic chat completion failed with status ${response.status}.`);
        }

        const body = (await response.json()) as AnthropicMessageResponse;
        return extractContentText(body);
    }
}
