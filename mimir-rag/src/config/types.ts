export interface LoggingConfig {
    level: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
    pretty: boolean;
}

export interface ServerConfig {
    apiKey: string;
    githubWebhookSecret?: string;
    fallbackIngestIntervalMinutes?: number;
}

export interface SupabaseConfig {
    url: string;
    anonKey?: string;
    serviceRoleKey: string;
    table: string;
    similarityThreshold: number;
    matchCount: number;
     bm25MatchCount?: number;
     enableHybridSearch?: boolean;
}

export interface GithubConfig {
    githubUrl: string;
    directory?: string;
    branch?: string;
    token?: string;
    outputDir?: string;
    includeDirectories?: string[];
}

export interface ParserConfig {
    extractVariables?: boolean;
    extractMethods?: boolean;
    excludePatterns?: string[];
    includeDirectories?: string[];
}

export interface DocumentationConfig {
    baseUrl?: string;
    contentPath?: string;
}

export type LLMProviderName = 
    | "openai"
    | "google"
    | "anthropic"
    | "mistral"

export interface ProviderLimitsConfig {
    batchSize?: number;
    concurrency?: number;
    maxRequestsPerMinute?: number;
    maxTokensPerMinute?: number;
    maxTokensPerRequest?: number;
    retries?: number;
}

interface BaseModelConfig {
    provider: LLMProviderName;
    apiKey?: string;
    baseUrl?: string;
    limits?: ProviderLimitsConfig;
}

export interface EmbeddingModelConfig extends BaseModelConfig {
    model: string;
}

export interface ChatModelConfig extends BaseModelConfig {
    model: string;
    maxOutputTokens?: number;
    temperature: number;
}

export interface LLMConfig {
    embedding: EmbeddingModelConfig;
    chat: ChatModelConfig;
}

export interface AppConfig {
    server: ServerConfig;
    supabase: SupabaseConfig;
    logging: LoggingConfig;
    github: GithubConfig;
    docs?: DocumentationConfig;
    parser?: ParserConfig;
    llm: LLMConfig;
}
