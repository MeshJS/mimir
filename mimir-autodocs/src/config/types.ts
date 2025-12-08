export interface LoggingConfig {
    level: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
    pretty: boolean;
}

export interface ServerConfig {
    apiKey: string;
    port?: number;
}

export interface SupabaseConfig {
    url: string;
    serviceRoleKey: string;
    table: string;
    similarityThreshold: number;
    matchCount: number;
}

export interface GithubConfig {
    githubUrl: string;
    directory?: string;
    branch?: string;
    token?: string;
    outputDir?: string;
}

export interface ParserConfig {
    /** Whether to extract top-level variable/constant declarations */
    extractVariables?: boolean;
    /** Whether to extract class methods as separate entities */
    extractMethods?: boolean;
    /** File patterns to exclude (e.g., ["*.test.ts", "*.spec.ts"]) */
    excludePatterns?: string[];
}

export type LLMProviderName = 
    | "openai"
    | "google"
    | "anthropic"
    | "mistral";

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
    parser?: ParserConfig;
    llm: LLMConfig;
}

