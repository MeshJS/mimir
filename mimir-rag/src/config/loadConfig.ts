import fs from "node:fs";
import path from "node:path";
import type {
    AppConfig,
    ChatModelConfig,
    DocumentationConfig,
    EmbeddingModelConfig,
    GithubConfig,
    LLMConfig,
    LLMProviderName,
    LoggingConfig,
    ProviderLimitsConfig,
    ServerConfig,
    SupabaseConfig,
} from "./types";

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_ENV_RELATIVE = ".env";
const ENV_EXAMPLE_RELATIVE = ".env.example";
const DEFAULT_ENV_PATH = path.join(PROJECT_ROOT, DEFAULT_ENV_RELATIVE);

const LOG_LEVELS = new Set<LoggingConfig["level"]>(["fatal", "error", "warn", "info", "debug", "trace"]);
const PROVIDERS: LLMProviderName[] = ["openai", "google", "anthropic", "mistral"];

const loadedEnvFiles = new Map<string, boolean>();

export interface LoadConfigOptions {
    envPath?: string;
}

export function resolveEnvPath(providedPath?: string): string {
    if (providedPath) {
        return path.resolve(process.cwd(), providedPath);
    }

    if (process.env.MIMIR_ENV_PATH) {
        return path.resolve(process.cwd(), process.env.MIMIR_ENV_PATH);
    }

    return DEFAULT_ENV_PATH;
}

export async function loadAppConfig(options: LoadConfigOptions = {}): Promise<AppConfig> {
    const explicitEnvPath = Boolean(options.envPath ?? process.env.MIMIR_ENV_PATH);
    const envPath = resolveEnvPath(options.envPath);
    const envLoaded = loadEnvFile(envPath, explicitEnvPath);
    const baseDir = envLoaded ? path.dirname(envPath) : process.cwd();

    return buildConfigFromEnv(baseDir);
}

function loadEnvFile(envPath: string, required: boolean): boolean {
    if (loadedEnvFiles.has(envPath)) {
        return loadedEnvFiles.get(envPath) ?? false;
    }

    if (!fs.existsSync(envPath)) {
        if (required) {
            throw new Error(
                [
                    `Environment file not found at "${envPath}".`,
                    `Copy ${ENV_EXAMPLE_RELATIVE} to ${DEFAULT_ENV_RELATIVE} and fill in your project values,`,
                    "or pass --env / MIMIR_ENV_PATH to point at a valid .env file.",
                ].join(" ")
            );
        }

        loadedEnvFiles.set(envPath, false);
        return false;
    }

    try {
        const content = fs.readFileSync(envPath, "utf8");
        const parsed = parseEnvContent(content);
        for (const [key, value] of Object.entries(parsed)) {
            if (process.env[key] === undefined) {
                process.env[key] = value;
            }
        }

        loadedEnvFiles.set(envPath, true);
        return true;
    } catch (error) {
        throw new Error(`Failed to load environment file at "${envPath}": ${(error as Error).message}`);
    }
}

function parseEnvContent(content: string): Record<string, string> {
    const result: Record<string, string> = {};
    const lines = content.split(/\r?\n/);

    for (const originalLine of lines) {
        if (!originalLine || originalLine.trim().length === 0) {
            continue;
        }

        const line = originalLine.replace(/\r$/, "");
        const trimmed = line.trim();

        if (trimmed.startsWith("#")) {
            continue;
        }

        const normalized = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : line;
        const equalsIndex = normalized.indexOf("=");
        if (equalsIndex === -1) {
            continue;
        }

        const key = normalized.slice(0, equalsIndex).trim();
        if (!key) {
            continue;
        }

        let value = normalized.slice(equalsIndex + 1);
        value = value.trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        } else {
            const hashIndex = value.indexOf(" #");
            if (hashIndex !== -1) {
                value = value.slice(0, hashIndex).trim();
            }
        }

        result[key] = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
    }

    return result;
}

function buildConfigFromEnv(baseDir: string): AppConfig {
    const logging = buildLoggingConfig();
    const server = buildServerConfig();
    const supabase = buildSupabaseConfig();
    const github = buildGithubConfig(baseDir);
    const docs = buildDocsConfig();
    const llm = buildLLMConfig();

    return {
        logging,
        server,
        supabase,
        github,
        docs,
        llm,
    };
}

function buildLoggingConfig(): LoggingConfig {
    const level = (process.env.MIMIR_LOGGING_LEVEL ?? "info").toLowerCase() as LoggingConfig["level"];
    if (!LOG_LEVELS.has(level)) {
        throw new Error(
            `Invalid logging level "${level}". Supported levels: ${Array.from(LOG_LEVELS).join(", ")}.`
        );
    }

    const pretty = parseBoolean("MIMIR_LOGGING_PRETTY", true);

    return {
        level,
        pretty,
    };
}

function buildServerConfig(): ServerConfig {
    const apiKey = requireEnv("MIMIR_SERVER_API_KEY");
    const githubWebhookSecret = optionalString("MIMIR_SERVER_GITHUB_WEBHOOK_SECRET");
    const fallbackIngestIntervalMinutes = optionalNumber("MIMIR_SERVER_FALLBACK_INGEST_INTERVAL_MINUTES");

    return {
        apiKey,
        githubWebhookSecret: githubWebhookSecret || undefined,
        fallbackIngestIntervalMinutes: fallbackIngestIntervalMinutes ?? undefined,
    };
}

function buildSupabaseConfig(): SupabaseConfig {
    return {
        url: requireEnv("MIMIR_SUPABASE_URL"),
        anonKey: optionalString("MIMIR_SUPABASE_ANON_KEY"),
        serviceRoleKey: requireEnv("MIMIR_SUPABASE_SERVICE_ROLE_KEY"),
        table: requireEnv("MIMIR_SUPABASE_TABLE"),
        similarityThreshold: parseNumber("MIMIR_SUPABASE_SIMILARITY_THRESHOLD", 0.2),
        matchCount: parseNumber("MIMIR_SUPABASE_MATCH_COUNT", 10),
        bm25MatchCount: optionalNumber("MIMIR_SUPABASE_BM25_MATCH_COUNT"),
        enableHybridSearch: parseBoolean("MIMIR_SUPABASE_ENABLE_HYBRID_SEARCH", true),
    };
}

function buildGithubConfig(baseDir: string): GithubConfig {
    const outputDir = optionalString("MIMIR_GITHUB_OUTPUT_DIR");
    return {
        githubUrl: requireEnv("MIMIR_GITHUB_URL"),
        directory: optionalString("MIMIR_GITHUB_DIRECTORY") || undefined,
        branch: optionalString("MIMIR_GITHUB_BRANCH") || undefined,
        token: optionalString("MIMIR_GITHUB_TOKEN") || undefined,
        outputDir: outputDir ? path.resolve(baseDir, outputDir) : undefined,
    };
}

function buildDocsConfig(): DocumentationConfig | undefined {
    const baseUrl = optionalString("MIMIR_DOCS_BASE_URL");
    const contentPath = optionalString("MIMIR_DOCS_CONTENT_PATH");

    if (!baseUrl && !contentPath) {
        return undefined;
    }

    return {
        baseUrl: baseUrl || undefined,
        contentPath: contentPath || undefined,
    };
}

function buildLLMConfig(): LLMConfig {
    return {
        embedding: buildEmbeddingConfig(),
        chat: buildChatConfig(),
    };
}

function buildEmbeddingConfig(): EmbeddingModelConfig {
    return {
        provider: parseProvider("MIMIR_LLM_EMBEDDING_PROVIDER"),
        model: requireEnv("MIMIR_LLM_EMBEDDING_MODEL"),
        apiKey: optionalString("MIMIR_LLM_EMBEDDING_API_KEY") || undefined,
        baseUrl: optionalString("MIMIR_LLM_EMBEDDING_BASE_URL") || undefined,
        limits: parseProviderLimits("MIMIR_LLM_EMBEDDING_LIMITS"),
    };
}

function buildChatConfig(): ChatModelConfig {
    return {
        provider: parseProvider("MIMIR_LLM_CHAT_PROVIDER"),
        model: requireEnv("MIMIR_LLM_CHAT_MODEL"),
        apiKey: optionalString("MIMIR_LLM_CHAT_API_KEY") || undefined,
        baseUrl: optionalString("MIMIR_LLM_CHAT_BASE_URL") || undefined,
        temperature: parseNumber("MIMIR_LLM_CHAT_TEMPERATURE", 0),
        maxOutputTokens: optionalNumber("MIMIR_LLM_CHAT_MAX_OUTPUT_TOKENS"),
        limits: parseProviderLimits("MIMIR_LLM_CHAT_LIMITS"),
    };
}

function parseProviderLimits(prefix: string): ProviderLimitsConfig | undefined {
    const entries: Array<[keyof ProviderLimitsConfig, string]> = [
        ["batchSize", "BATCH_SIZE"],
        ["concurrency", "CONCURRENCY"],
        ["maxRequestsPerMinute", "MAX_REQUESTS_PER_MINUTE"],
        ["maxTokensPerMinute", "MAX_TOKENS_PER_MINUTE"],
        ["maxTokensPerRequest", "MAX_TOKENS_PER_REQUEST"],
        ["retries", "RETRIES"],
    ];

    const limits: ProviderLimitsConfig = {};
    for (const [field, suffix] of entries) {
        const key = `${prefix}_${suffix}`;
        const value = optionalNumber(key);
        if (typeof value === "number" && !Number.isNaN(value)) {
            limits[field] = value;
        }
    }

    return Object.keys(limits).length > 0 ? limits : undefined;
}

function parseProvider(key: string): LLMProviderName {
    const value = requireEnv(key).toLowerCase();
    if (!PROVIDERS.includes(value as LLMProviderName)) {
        throw new Error(
            `Invalid provider "${value}" for ${key}. Supported providers: ${PROVIDERS.join(", ")}.`
        );
    }
    return value as LLMProviderName;
}

function optionalString(key: string): string | undefined {
    const value = process.env[key];
    if (value === undefined || value === null) {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
}

function requireEnv(key: string): string {
    const value = optionalString(key);
    if (!value) {
        throw new Error(
            [
                `Missing required environment variable "${key}".`,
                `Copy ${ENV_EXAMPLE_RELATIVE} to ${DEFAULT_ENV_RELATIVE} and fill in your project values,`,
                "or export the variables before starting the process.",
            ].join(" ")
        );
    }
    return value;
}

function parseNumber(key: string, defaultValue?: number): number {
    const raw = process.env[key];
    if (raw === undefined || raw === null || raw.trim() === "") {
        if (defaultValue === undefined) {
            throw new Error(`Missing required numeric environment variable "${key}".`);
        }
        return defaultValue;
    }

    const value = Number(raw);
    if (Number.isNaN(value)) {
        throw new Error(`Environment variable "${key}" must be a valid number.`);
    }
    return value;
}

function optionalNumber(key: string, defaultValue?: number): number | undefined {
    const raw = process.env[key];
    if (raw === undefined || raw === null || raw.trim() === "") {
        return defaultValue;
    }

    const value = Number(raw);
    if (Number.isNaN(value)) {
        throw new Error(`Environment variable "${key}" must be a valid number.`);
    }

    return value;
}

function parseBoolean(key: string, defaultValue?: boolean): boolean {
    const raw = process.env[key];
    if (raw === undefined || raw === null || raw.trim() === "") {
        if (defaultValue === undefined) {
            throw new Error(`Missing required boolean environment variable "${key}".`);
        }
        return defaultValue;
    }

    const normalized = raw.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
        return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
        return false;
    }
    throw new Error(`Environment variable "${key}" must be a boolean (true/false).`);
}
