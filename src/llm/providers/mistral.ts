import { Logger } from "pino";
import { BaseChatProvider, BaseEmbeddingProvider, type ProviderRateLimits } from "../base";
import type { ChatModelConfig, EmbeddingModelConfig, ProviderLimitsConfig } from "../../config/types";
import type { EmbedOptions, GenerateAnswerOptions } from "../types";
import { buildPromptMessages } from "../prompt";

interface MistralEmbeddingItem {
    embedding?: number[];
}

interface MistralEmbeddingResponse {
    data?: MistralEmbeddingItem[];
    error?: {
        message?: string;
    };
}

interface MistralChatChoice {
    message?: {
        content?: string;
    };
}

interface MistralChatResponse {
    choices?: MistralChatChoice[];
    error?: {
        message?: string;
    };
}

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

async function parseMistralError(response: Response, fallback: string): Promise<never> {
    let details = fallback;

    try {
        const body = (await response.json()) as MistralEmbeddingResponse | MistralChatResponse;
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

function extractEmbeddingVectors(payload: MistralEmbeddingResponse): number[][] {
    if (!Array.isArray(payload.data) || payload.data.length === 0) {
        throw new Error("Mistral embedding response is missing vector data.");
    }

    return payload.data.map((item) => {
        if (!Array.isArray(item.embedding)) {
            throw new Error("Mistral embedding vector is malformed.");
        }
        return item.embedding;
    });
}

function extractChatText(payload: MistralChatResponse): string {
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
        throw new Error("Mistral returned an empty chat completion response.");
    }
    return content;
}

export class MistralEmbeddingProvider extends BaseEmbeddingProvider {
    private readonly apiKey: string;
    private readonly baseUrl: string;

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

        this.apiKey = config.apiKey;
        this.baseUrl = resolveBaseUrl(config.baseUrl);
    }

    protected async sendEmbeddingRequest(chunks: string[], options?: EmbedOptions): Promise<number[][]> {
        const url = new URL("v1/embeddings", this.baseUrl);
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
            await parseMistralError(response, `Mistral embedding request failed with status ${response.status}.`);
        }

        const payload = (await response.json()) as MistralEmbeddingResponse;
        return extractEmbeddingVectors(payload);
    }
}

export class MistralChatProvider extends BaseChatProvider {
    private readonly apiKey: string;
    private readonly baseUrl: string;

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

        this.apiKey = config.apiKey;
        this.baseUrl = resolveBaseUrl(config.baseUrl);
    }

    protected async complete(options: GenerateAnswerOptions): Promise<string> {
        const { system, user } = buildPromptMessages(options);
        const url = new URL("v1/chat/completions", this.baseUrl);

        const temperature = options.temperature ?? this.config.temperature;
        const maxTokens = options.maxTokens ?? this.config.maxOutputTokens;

        const messages: Array<Record<string, string>> = [];
        if (system) {
            messages.push({ role: "system", content: system });
        }
        messages.push({ role: "user", content: user });

        const body: Record<string, unknown> = {
            model: this.config.model,
            messages,
        };

        if (typeof temperature === "number") {
            body.temperature = temperature;
        }

        if (typeof maxTokens === "number") {
            body.max_tokens = maxTokens;
        }

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: options.signal,
        });

        if (!response.ok) {
            await parseMistralError(response, `Mistral chat completion failed with status ${response.status}.`);
        }

        const payload = (await response.json()) as MistralChatResponse;
        return extractChatText(payload);
    }
}
