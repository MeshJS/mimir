export interface LoggingConfig {
    level: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
    pretty: boolean;
}

export interface ServerConfig {
    apiKey: string;
    githubWebhookSecret?: string;
    fallbackIngestIntervalMinutes?: number;
}

export interface DatabaseConfig {
    databaseUrl: string;
    table: string;
    similarityThreshold: number;
    matchCount: number;
     bm25MatchCount?: number;
     enableHybridSearch?: boolean;
}

export interface GithubConfig {
    githubUrl: string;
    directory?: string; // Directory for main repo (fallback if separate not set)
    includeDirectories?: string[]; // Include directories for main repo (fallback if separate not set)
    codeUrl?: string;
    codeDirectory?: string;
    codeIncludeDirectories?: string[];
    docsUrl?: string;
    docsDirectory?: string;
    docsIncludeDirectories?: string[];
    codeRepos?: CodeRepoConfig[]; // Multiple code repositories with per-repo configuration
    docsRepos?: DocsRepoConfig[]; // Multiple docs repositories with per-repo configuration
    branch?: string;
    token?: string;
    outputDir?: string;
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

export interface CodeRepoConfig {
    url: string;
    directory?: string;
    includeDirectories?: string[];
    excludePatterns?: string[];
}

export interface DocsRepoConfig {
    url: string;
    directory?: string;
    includeDirectories?: string[];
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
    database: DatabaseConfig;
    logging: LoggingConfig;
    github: GithubConfig;
    docs?: DocumentationConfig;
    parser?: ParserConfig;
    llm: LLMConfig;
}
