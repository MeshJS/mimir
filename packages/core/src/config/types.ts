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

export interface AppConfig {
    supabase: SupabaseConfig;
    logging: LoggingConfig;
}

export interface GithubConfig {
    githubUrl: string;
    directory?: string;
    branch?: string;
    token?: string;
    outputDir?: string;
}