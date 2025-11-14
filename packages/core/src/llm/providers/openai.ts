import { Logger } from "pino";
import { BaseChatProvider, BaseEmbeddingProvider } from "../base";
import type { ChatModelConfig, LLMModelConfig } from "../../config/types";
import type { EmbedOptions, GenerateAnswerOptions } from "../types";
import { buildPromptMessages } from "../prompt";

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

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1/";

function resolveBaseUrl(url?: string): string {
    if (!url) {
        return OPENAI_DEFAULT_BASE_URL;
    }
    return url.endsWith("/") ? url : `${url}/`;
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

    constructor(config: LLMModelConfig, logger?: Logger) {
        if (!config.apiKey) {
            throw new Error("OpenAI API key is required for embeddings.");
        }

        super(
            config,
            {
                batchSize: 100,
                concurrency: 4,
                maxRequestsPerMinute: 1_500,
                maxTokensPerMinute: 6_250_000,
                retries: 6,
            },
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
                model: this.config.embeddingModel,
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
            {
                concurrency: 3,
                maxRequestsPerMinute: 500,
                maxTokensPerMinute: 90_000,
                retries: 5,
            },
            logger
        );

        this.apiKey = config.apiKey;
        this.baseUrl = resolveBaseUrl(config.baseUrl);
    }

    protected async complete(options: GenerateAnswerOptions): Promise<string> {
        const { system, user } = buildPromptMessages(options);
        const url = new URL("chat/completions", this.baseUrl);
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.config.chatModel,
                temperature: options.temperature ?? this.config.temperature,
                max_tokens: options.maxTokens ?? this.config.maxOutputTokens,
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
            }),
            signal: options.signal,
        });

        if (!response.ok) {
            await parseOpenAIError(response, `OpenAI chat completion failed with status ${response.status}.`);
        }

        const payload = (await response.json()) as OpenAIChatCompletionResponse;
        const content = payload.choices?.[0]?.message?.content?.trim();
        if (!content) {
            throw new Error("OpenAI returned an empty chat completion response.");
        }

        return content;
    }
}
