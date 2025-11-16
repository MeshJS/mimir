import { Logger } from "pino";
import { BaseChatProvider, BaseEmbeddingProvider, type ProviderRateLimits } from "../base";
import type { ChatModelConfig, EmbeddingModelConfig, ProviderLimitsConfig } from "../../config/types";
import type { EmbedOptions, GenerateAnswerOptions } from "../types";
import { buildPromptMessages } from "../prompt";
import { readEventStream } from "../../utils/sse";

interface GeminiEmbeddingValues {
    values?: number[];
}

interface GeminiBatchEmbedResponse {
    embeddings?: GeminiEmbeddingValues[];
    responses?: Array<{
        embedding?: GeminiEmbeddingValues;
    }>;
    error?: {
        message?: string;
    };
}

interface GeminiCandidate {
    finishReason?: string;
    content?: {
        parts?: Array<{
            text?: string;
        }>;
    };
}

interface GeminiGenerateContentResponse {
    candidates?: GeminiCandidate[];
    error?: {
        message?: string;
    };
}

interface GeminiStreamChunk {
    candidates?: GeminiCandidate[];
    error?: {
        message?: string;
    };
}

const GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/";

function resolveBaseUrl(url?: string): string {
    if (!url) {
        return GEMINI_DEFAULT_BASE_URL;
    }

    return url.endsWith("/") ? url : `${url}/`;
}

function toModelPath(model: string): string {
    if (model.startsWith("models/")) {
        return model;
    }

    return `models/${model}`;
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

async function parseGeminiError(response: Response, fallback: string): Promise<never> {
    let details = fallback;

    try {
        const body = (await response.json()) as GeminiBatchEmbedResponse | GeminiGenerateContentResponse;
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

function extractEmbeddingVectors(payload: GeminiBatchEmbedResponse): number[][] {
    const rawEmbeddings =
        payload.embeddings ??
        payload.responses?.map((entry) => entry?.embedding) ??
        [];

    if (!Array.isArray(rawEmbeddings) || rawEmbeddings.length === 0) {
        throw new Error("Gemini embedding response is missing vector data.");
    }

    return rawEmbeddings.map((item) => {
        if (!Array.isArray(item?.values)) {
            throw new Error("Gemini embedding vector is malformed.");
        }

        return item.values;
    });
}

function extractCandidateText(payload: GeminiGenerateContentResponse): string {
    const candidate = payload.candidates?.[0];
    if (!candidate?.content?.parts?.length) {
        throw new Error("Gemini returned an empty response.");
    }

    const text = candidate.content.parts
        .map((part) => part?.text ?? "")
        .join("")
        .trim();

    if (!text) {
        throw new Error("Gemini returned an empty response.");
    }

    return text;
}

function extractCandidateChunkText(payload: GeminiStreamChunk): string {
    const candidate = payload.candidates?.[0];
    if (!candidate?.content?.parts?.length) {
        return "";
    }

    return candidate.content.parts
        .map((part) => part?.text ?? "")
        .join("");
}

export class GoogleEmbeddingProvider extends BaseEmbeddingProvider {
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly modelPath: string;

    constructor(config: EmbeddingModelConfig, logger?: Logger) {
        if (!config.apiKey) {
            throw new Error("Google Generative AI API key is required for embeddings.");
        }

        const modelPath = toModelPath(config.model);

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

        this.apiKey = config.apiKey;
        this.baseUrl = resolveBaseUrl(config.baseUrl);
        this.modelPath = modelPath;
    }

    protected async sendEmbeddingRequest(chunks: string[], options?: EmbedOptions): Promise<number[][]> {
        const url = new URL(`/v1beta/${this.modelPath}:batchEmbedContents`, this.baseUrl);
        url.searchParams.set("key", this.apiKey);

        const payload = {
            requests: chunks.map((text) => ({
                model: this.modelPath,
                content: {
                    parts: [{ text }],
                },
            })),
        };

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
            signal: options?.signal,
        });

        if (!response.ok) {
            await parseGeminiError(response, `Gemini embedding request failed with status ${response.status}.`);
        }

        const body = (await response.json()) as GeminiBatchEmbedResponse;
        return extractEmbeddingVectors(body);
    }
}

export class GoogleChatProvider extends BaseChatProvider {
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly modelPath: string;

    constructor(config: ChatModelConfig, logger?: Logger) {
        if (!config.apiKey) {
            throw new Error("Google Generative AI API key is required for chat completions.");
        }

        const modelPath = toModelPath(config.model);

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

        this.apiKey = config.apiKey;
        this.baseUrl = resolveBaseUrl(config.baseUrl);
        this.modelPath = modelPath;
    }

    protected async complete(options: GenerateAnswerOptions): Promise<string> {
        const { system, user } = buildPromptMessages(options);
        const shouldStream = typeof options.onToken === "function";
        const endpoint = shouldStream ? "streamGenerateContent" : "generateContent";
        const url = new URL(`/v1beta/${this.modelPath}:${endpoint}`, this.baseUrl);
        url.searchParams.set("key", this.apiKey);

        const generationConfig: Record<string, number> = {};
        const temperature = options.temperature ?? this.config.temperature;
        if (typeof temperature === "number") {
            generationConfig.temperature = temperature;
        }

        const maxTokens = options.maxTokens ?? this.config.maxOutputTokens;
        if (typeof maxTokens === "number") {
            generationConfig.maxOutputTokens = maxTokens;
        }

        const requestBody: Record<string, unknown> = {
            model: this.modelPath,
            contents: [
                {
                    role: "user",
                    parts: [{ text: user }],
                },
            ],
        };

        if (system) {
            const systemContent = {
                role: "system",
                parts: [{ text: system }],
            };

            requestBody.systemInstruction = systemContent;
        }

        if (Object.keys(generationConfig).length > 0) {
            requestBody.generationConfig = generationConfig;
        }

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: shouldStream ? "text/event-stream" : "application/json",
            },
            body: JSON.stringify(requestBody),
            signal: options.signal,
        });

        if (!response.ok) {
            await parseGeminiError(response, `Gemini chat completion failed with status ${response.status}.`);
        }

        if (shouldStream) {
            return this.streamCompletion(response, options.onToken!);
        }

        const payload = (await response.json()) as GeminiGenerateContentResponse;
        return extractCandidateText(payload);
    }

    private async streamCompletion(response: Response, onToken: (chunk: string) => void): Promise<string> {
        let fullText = "";

        await readEventStream(response, (event) => {
            try {
                const payload = JSON.parse(event.data) as GeminiStreamChunk;
                const text = extractCandidateChunkText(payload);
                if (text) {
                    fullText += text;
                    onToken(text);
                }
            } catch (error) {
                this.logger?.warn({ err: error, data: event.data }, "Failed to parse Gemini stream chunk.");
            }

            return true;
        });

        return fullText.trim();
    }
}
