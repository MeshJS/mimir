import { Logger } from "pino";
import { BaseChatProvider, BaseEmbeddingProvider, type ProviderRateLimits } from "../base";
import type { ChatModelConfig, EmbeddingModelConfig, ProviderLimitsConfig } from "../../config/types";
import type { EmbedOptions, GenerateAnswerOptions } from "../types";
import { buildPromptMessages } from "../prompt";
import { readEventStream } from "../../utils/sse";

interface OpenAIEmbeddingResponse {
    data: Array<{
        embedding: number[];
    }>;
    error?: {
        message?: string;
    };
}

interface OpenAIChatCompletionResponse {
    choices?: Array<{
        message?: {
            content?: string;
        };
    }>;
    error?: {
        message?: string;
    };
}

interface OpenAIChatCompletionChunk {
    choices?: Array<{
        delta?: {
            content?: string;
        };
        finish_reason?: string | null;
    }>;
    error?: {
        message?: string;
    };
}

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

async function parseOpenAIError(response: Response, fallback: string): Promise<never> {
    let details = fallback;

    try {
        const body = (await response.json()) as OpenAIEmbeddingResponse | OpenAIChatCompletionResponse;
        const message = body?.error?.message ?? fallback;
        details = message;
    } catch {
        try {
            details = await response.text();
        } catch {
            
        }
    }

    throw new Error(details);
}

export class OpenAIEmbeddingProvider extends BaseEmbeddingProvider {
    private readonly apiKey: string;
    private readonly baseUrl: string;

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

        this.apiKey = config.apiKey;
        this.baseUrl = resolveBaseUrl(config.baseUrl);
    }

    protected async sendEmbeddingRequest(chunks: string[], options?: EmbedOptions): Promise<number[][]> {
        const url = new URL("embeddings", this.baseUrl);
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.config.model,
                input: chunks,
            }),
            signal: options?.signal,
        });

        if (!response.ok) {
            await parseOpenAIError(response, `OpenAI embedding request failed with status ${response.status}.`);
        }

        const payload = (await response.json()) as OpenAIEmbeddingResponse;
        if (!Array.isArray(payload.data)) {
            throw new Error("OpenAI embedding response is malformed.");
        }

        return payload.data.map((item) => {
            if (!Array.isArray(item.embedding)) {
                throw new Error("OpenAI embedding response is missing vector data.");
            }

            return item.embedding;
        });
    }
}

export class OpenAIChatProvider extends BaseChatProvider {
    private readonly apiKey: string;
    private readonly baseUrl: string;

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

        this.apiKey = config.apiKey;
        this.baseUrl = resolveBaseUrl(config.baseUrl);
    }

    protected async complete(options: GenerateAnswerOptions): Promise<string> {
        const { system, user } = buildPromptMessages(options);
        const shouldStream = typeof options.onToken === "function";
        const url = new URL("chat/completions", this.baseUrl);
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.config.model,
                temperature: options.temperature ?? this.config.temperature,
                max_tokens: options.maxTokens ?? this.config.maxOutputTokens,
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
                stream: shouldStream,
            }),
            signal: options.signal,
        });

        if (!response.ok) {
            await parseOpenAIError(response, `OpenAI chat completion failed with status ${response.status}.`);
        }

        if (shouldStream) {
            return this.streamCompletion(response, options.onToken!);
        }

        const payload = (await response.json()) as OpenAIChatCompletionResponse;
        const content = payload.choices?.[0]?.message?.content?.trim();
        if (!content) {
            throw new Error("OpenAI returned an empty chat completion response.");
        }

        return content;
    }

    private async streamCompletion(response: Response, onToken: (chunk: string) => void): Promise<string> {
        let fullText = "";

        await readEventStream(response, (event) => {
            const trimmed = event.data.trim();
            if (trimmed === "[DONE]") {
                return false;
            }

            try {
                const payload = JSON.parse(trimmed) as OpenAIChatCompletionChunk;
                const delta = payload.choices?.[0]?.delta?.content;
                if (delta) {
                    fullText += delta;
                    onToken(delta);
                }
            } catch (error) {
                this.logger?.warn({ err: error, data: trimmed }, "Failed to parse OpenAI stream chunk.");
            }

            return true;
        });

        return fullText.trim();
    }
}
