import type { EmbeddingModelConfig } from "../config/types";

const DEFAULT_EMBEDDING_TOKEN_LIMIT = 8_192;

const EMBEDDING_MODEL_TOKEN_LIMITS: Record<string, number> = {
    "text-embedding-3-large": 8_192,
    "text-embedding-3-small": 8_192,
    "text-embedding-ada-002": 8_192,
    "text-embedding-ada-002-v2": 8_192,
};

function normalizeModelName(name?: string): string | undefined {
    const normalized = name?.trim().toLowerCase();
    return normalized && normalized.length > 0 ? normalized : undefined;
}

export function resolveEmbeddingInputTokenLimit(config: EmbeddingModelConfig): number {
    const explicitLimit = config.limits?.maxTokensPerRequest;
    if (typeof explicitLimit === "number" && Number.isFinite(explicitLimit) && explicitLimit > 0) {
        return Math.floor(explicitLimit);
    }

    const normalizedModel = normalizeModelName(config.model);
    if (normalizedModel) {
        if (EMBEDDING_MODEL_TOKEN_LIMITS[normalizedModel]) {
            return EMBEDDING_MODEL_TOKEN_LIMITS[normalizedModel];
        }

        const matched = Object.entries(EMBEDDING_MODEL_TOKEN_LIMITS).find(([key]) =>
            normalizedModel.startsWith(key)
        );

        if (matched) {
            return matched[1];
        }
    }

    return DEFAULT_EMBEDDING_TOKEN_LIMIT;
}
