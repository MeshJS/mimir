import dotenv from "dotenv";
import type { AppConfig, LLMProviderName } from "./types";

dotenv.config();

function requiredEnv(key: string): string {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}

function optionalEnv(key: string, defaultValue?: string): string | undefined {
    return process.env[key] ?? defaultValue;
}

function parseNumber(value: string | undefined, defaultValue: number): number {
    if (!value) return defaultValue;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? defaultValue : parsed;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
    if (!value) return defaultValue;
    return value.toLowerCase() === "true" || value === "1";
}

export function loadConfig(): AppConfig {
    const embeddingProvider = (optionalEnv("EMBEDDING_PROVIDER", "openai") as LLMProviderName);
    const chatProvider = (optionalEnv("CHAT_PROVIDER", "openai") as LLMProviderName);

    return {
        server: {
            apiKey: requiredEnv("API_KEY"),
            port: parseNumber(optionalEnv("PORT"), 3000),
        },
        supabase: {
            url: requiredEnv("SUPABASE_URL"),
            serviceRoleKey: requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
            table: optionalEnv("SUPABASE_TABLE", "autodocs_chunks") ?? "autodocs_chunks",
            similarityThreshold: parseNumber(optionalEnv("SIMILARITY_THRESHOLD"), 0.5),
            matchCount: parseNumber(optionalEnv("MATCH_COUNT"), 10),
        },
        logging: {
            level: (optionalEnv("LOG_LEVEL", "info") as AppConfig["logging"]["level"]),
            pretty: parseBoolean(optionalEnv("LOG_PRETTY"), true),
        },
        github: {
            githubUrl: requiredEnv("GITHUB_URL"),
            directory: optionalEnv("GITHUB_DIRECTORY"),
            branch: optionalEnv("GITHUB_BRANCH"),
            token: optionalEnv("GITHUB_TOKEN"),
            outputDir: optionalEnv("GITHUB_OUTPUT_DIR"),
            includeDirectories: optionalEnv("GITHUB_INCLUDE_DIRECTORIES")?.split(",").map(d => d.trim()).filter(Boolean),
        },
        parser: {
            extractVariables: parseBoolean(optionalEnv("EXTRACT_VARIABLES"), false),
            extractMethods: parseBoolean(optionalEnv("EXTRACT_METHODS"), true),
            excludePatterns: optionalEnv("EXCLUDE_PATTERNS")?.split(",").map(p => p.trim()),
        },
        llm: {
            embedding: {
                provider: embeddingProvider,
                model: optionalEnv("EMBEDDING_MODEL", "text-embedding-3-small") ?? "text-embedding-3-small",
                apiKey: optionalEnv(`${embeddingProvider.toUpperCase()}_API_KEY`),
                limits: {
                    batchSize: parseNumber(optionalEnv("EMBEDDING_BATCH_SIZE"), 100),
                    concurrency: parseNumber(optionalEnv("EMBEDDING_CONCURRENCY"), 5),
                    maxRequestsPerMinute: parseNumber(optionalEnv("EMBEDDING_RPM"), 500),
                    maxTokensPerMinute: parseNumber(optionalEnv("EMBEDDING_TPM"), 1000000),
                    retries: parseNumber(optionalEnv("EMBEDDING_RETRIES"), 3),
                },
            },
            chat: {
                provider: chatProvider,
                model: optionalEnv("CHAT_MODEL", "gpt-4o-mini") ?? "gpt-4o-mini",
                apiKey: optionalEnv(`${chatProvider.toUpperCase()}_API_KEY`),
                maxOutputTokens: parseNumber(optionalEnv("CHAT_MAX_TOKENS"), 500),
                temperature: parseNumber(optionalEnv("CHAT_TEMPERATURE"), 0.3),
                limits: {
                    concurrency: parseNumber(optionalEnv("CHAT_CONCURRENCY"), 5),
                    maxRequestsPerMinute: parseNumber(optionalEnv("CHAT_RPM"), 500),
                    retries: parseNumber(optionalEnv("CHAT_RETRIES"), 3),
                },
            },
        },
    };
}

