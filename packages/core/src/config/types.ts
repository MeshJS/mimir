export interface LoggingConfig {
    level: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
    pretty: boolean;
}

export interface SupabaseConfig {
    url: string;
    anonKey?: string;
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

export type LLMProviderName = 
    | "openai"
    | "google"
    | "anthropic"

export interface LLMModelConfig {
    provider: LLMProviderName;
    embeddingModel: string;
    chatModel: string;
    apiKey?: string;
    baseUrl?: string;
}

export interface ChatModelConfig extends LLMModelConfig {
    maxOutputTokens?: number;
    temperature: number;
}

export interface LLMConfig {
    embedding: LLMModelConfig;
    chat: ChatModelConfig;
}

export interface AppConfig {
    supabase: SupabaseConfig;
    logging: LoggingConfig;
    github: GithubConfig;
    llm: LLMConfig;
}