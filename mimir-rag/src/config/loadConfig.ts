import { config as loadDotenv } from "dotenv";
import path from "node:path";
import type { AppConfig, LLMProviderName, CodeRepoConfig, DocsRepoConfig } from "./types";

const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");

function getEnv(key: string, required = true): string | undefined {
    const value = process.env[key];
    if (required && !value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}

function getEnvNumber(key: string): number | undefined;
function getEnvNumber(key: string, defaultValue: number): number;
function getEnvNumber(key: string, defaultValue?: number): number | undefined {
    const value = process.env[key];
    if (!value) {
        return defaultValue;
    }
    const parsed = Number.parseFloat(value);
    if (Number.isNaN(parsed)) {
        throw new Error(`Environment variable ${key} must be a valid number, got: ${value}`);
    }
    return parsed;
}

function getEnvBoolean(key: string, defaultValue = false): boolean {
    const value = process.env[key];
    if (!value) {
        return defaultValue;
    }
    const lowered = value.toLowerCase().trim();
    return lowered === "true" || lowered === "1" || lowered === "yes";
}

export function resolveConfigPath(providedPath?: string): string {
    if (providedPath) {
        return path.resolve(process.cwd(), providedPath);
    }

    if (process.env.MIMIR_CONFIG_PATH) {
        return path.resolve(process.cwd(), process.env.MIMIR_CONFIG_PATH);
    }

    return path.join(PACKAGE_ROOT, ".env");
}

/**
 * Parse numbered code repository environment variables
 * Scans for MIMIR_GITHUB_CODE_REPO_{N}_URL patterns and collects all related config
 */
function parseCodeRepos(): CodeRepoConfig[] {
    const repos: CodeRepoConfig[] = [];
    const repoNumbers = new Set<number>();

    // Find all repo numbers by scanning for _REPO_{N}_URL patterns
    for (const key in process.env) {
        const match = key.match(/^MIMIR_GITHUB_CODE_REPO_(\d+)_URL$/);
        if (match) {
            repoNumbers.add(parseInt(match[1], 10));
        }
    }

    // Sort repo numbers to process in order
    const sortedNumbers = Array.from(repoNumbers).sort((a, b) => a - b);

    // Build config for each repo
    for (const num of sortedNumbers) {
        const url = getEnv(`MIMIR_GITHUB_CODE_REPO_${num}_URL`, false);
        if (!url) {
            continue; // Skip if URL is missing
        }

        const directory = getEnv(`MIMIR_GITHUB_CODE_REPO_${num}_DIRECTORY`, false);
        const includeDirsStr = getEnv(`MIMIR_GITHUB_CODE_REPO_${num}_INCLUDE_DIRECTORIES`, false);
        const excludePatternsStr = getEnv(`MIMIR_GITHUB_CODE_REPO_${num}_EXCLUDE_PATTERNS`, false);

        const repo: CodeRepoConfig = {
            url,
        };

        if (directory) {
            repo.directory = directory;
        }

        if (includeDirsStr) {
            repo.includeDirectories = includeDirsStr.split(",").map(p => p.trim()).filter(Boolean);
        }

        if (excludePatternsStr) {
            repo.excludePatterns = excludePatternsStr.split(",").map(p => p.trim()).filter(Boolean);
        }

        repos.push(repo);
    }

    return repos;
}

/**
 * Parse numbered docs repository environment variables
 * Scans for MIMIR_GITHUB_DOCS_REPO_{N}_URL patterns and collects all related config
 */
function parseDocsRepos(): DocsRepoConfig[] {
    const repos: DocsRepoConfig[] = [];
    const repoNumbers = new Set<number>();

    // Find all repo numbers by scanning for _REPO_{N}_URL patterns
    for (const key in process.env) {
        const match = key.match(/^MIMIR_GITHUB_DOCS_REPO_(\d+)_URL$/);
        if (match) {
            repoNumbers.add(parseInt(match[1], 10));
        }
    }

    // Sort repo numbers to process in order
    const sortedNumbers = Array.from(repoNumbers).sort((a, b) => a - b);

    // Build config for each repo
    for (const num of sortedNumbers) {
        const url = getEnv(`MIMIR_GITHUB_DOCS_REPO_${num}_URL`, false);
        if (!url) {
            continue; // Skip if URL is missing
        }

        const directory = getEnv(`MIMIR_GITHUB_DOCS_REPO_${num}_DIRECTORY`, false);
        const includeDirsStr = getEnv(`MIMIR_GITHUB_DOCS_REPO_${num}_INCLUDE_DIRECTORIES`, false);
        const baseUrl = getEnv(`MIMIR_GITHUB_DOCS_REPO_${num}_BASE_URL`, false);
        const contentPath = getEnv(`MIMIR_GITHUB_DOCS_REPO_${num}_CONTENT_PATH`, false);

        const repo: DocsRepoConfig = {
            url,
        };

        if (directory) {
            repo.directory = directory;
        }

        if (includeDirsStr) {
            repo.includeDirectories = includeDirsStr.split(",").map(p => p.trim()).filter(Boolean);
        }

        if (baseUrl) {
            repo.baseUrl = baseUrl;
        }

        if (contentPath) {
            repo.contentPath = contentPath;
        }

        repos.push(repo);
    }

    return repos;
}

export async function loadAppConfig(configPath?: string): Promise<AppConfig> {
    const envPath = configPath ?? resolveConfigPath();
    const result = loadDotenv({ path: envPath });

    if (result.error) {
        // Only fail if an explicit path was provided, otherwise env vars may already be loaded
        if (configPath) {
            throw new Error(`Failed to load environment file from "${configPath}": ${result.error.message}`);
        }
    }

    // Build configuration from environment variables
    const apiKey = getEnv("MIMIR_SERVER_API_KEY");
    if (!apiKey) {
        throw new Error("Server configuration must include MIMIR_SERVER_API_KEY.");
    }

    const supabaseUrl = getEnv("MIMIR_SUPABASE_URL");
    const supabaseServiceRoleKey = getEnv("MIMIR_SUPABASE_SERVICE_ROLE_KEY");
    const supabaseTable = getEnv("MIMIR_SUPABASE_TABLE", false) ?? "docs";

    if (!supabaseUrl || !supabaseServiceRoleKey) {
        throw new Error("Supabase configuration requires MIMIR_SUPABASE_URL and MIMIR_SUPABASE_SERVICE_ROLE_KEY.");
    }

    const embeddingProvider = getEnv("MIMIR_LLM_EMBEDDING_PROVIDER") as LLMProviderName;
    const embeddingModel = getEnv("MIMIR_LLM_EMBEDDING_MODEL");
    const chatProvider = getEnv("MIMIR_LLM_CHAT_PROVIDER") as LLMProviderName;
    const chatModel = getEnv("MIMIR_LLM_CHAT_MODEL");

    if (!embeddingProvider || !embeddingModel) {
        throw new Error("LLM embedding configuration requires MIMIR_LLM_EMBEDDING_PROVIDER and MIMIR_LLM_EMBEDDING_MODEL.");
    }

    if (!chatProvider || !chatModel) {
        throw new Error("LLM chat configuration requires MIMIR_LLM_CHAT_PROVIDER and MIMIR_LLM_CHAT_MODEL.");
    }

    const config: AppConfig = {
        logging: {
            level: (getEnv("MIMIR_LOGGING_LEVEL", false) ?? "info") as AppConfig["logging"]["level"],
            pretty: getEnvBoolean("MIMIR_LOGGING_PRETTY", true),
        },
        server: {
            apiKey,
            githubWebhookSecret: getEnv("MIMIR_SERVER_GITHUB_WEBHOOK_SECRET", false),
            fallbackIngestIntervalMinutes: getEnvNumber("MIMIR_SERVER_FALLBACK_INGEST_INTERVAL_MINUTES"),
        },
        supabase: {
            url: supabaseUrl,
            anonKey: getEnv("MIMIR_SUPABASE_ANON_KEY", false),
            serviceRoleKey: supabaseServiceRoleKey,
            table: supabaseTable,
            similarityThreshold: getEnvNumber("MIMIR_SUPABASE_SIMILARITY_THRESHOLD", 0.2),
            matchCount: getEnvNumber("MIMIR_SUPABASE_MATCH_COUNT", 10),
            bm25MatchCount: getEnvNumber("MIMIR_SUPABASE_BM25_MATCH_COUNT", 10),
            enableHybridSearch: getEnvBoolean("MIMIR_SUPABASE_ENABLE_HYBRID_SEARCH", true),
        },
        github: (() => {
            const githubUrl = getEnv("MIMIR_GITHUB_URL", false) ?? "";
            const codeUrl = getEnv("MIMIR_GITHUB_CODE_URL", false);
            const docsUrl = getEnv("MIMIR_GITHUB_DOCS_URL", false);

            // Check for single-repo config (backward compatibility)
            const hasSingleCodeRepo = !!codeUrl;
            const hasSingleDocsRepo = !!docsUrl;

            // Parse multiple repos if single-repo vars are not set
            let codeRepos: CodeRepoConfig[] | undefined;
            let docsRepos: DocsRepoConfig[] | undefined;

            if (!hasSingleCodeRepo) {
                const parsedCodeRepos = parseCodeRepos();
                if (parsedCodeRepos.length > 0) {
                    codeRepos = parsedCodeRepos;
                }
            } else {
                // Convert single-repo config to array format for consistency
                const codeDirectory = getEnv("MIMIR_GITHUB_CODE_DIRECTORY", false);
                const codeIncludeDirs = getEnv("MIMIR_GITHUB_CODE_INCLUDE_DIRECTORIES", false);
                codeRepos = [{
                    url: codeUrl,
                    directory: codeDirectory,
                    includeDirectories: codeIncludeDirs?.split(",").map(p => p.trim()).filter(Boolean),
                }];
            }

            if (!hasSingleDocsRepo) {
                const parsedDocsRepos = parseDocsRepos();
                if (parsedDocsRepos.length > 0) {
                    docsRepos = parsedDocsRepos;
                }
            } else {
                // Convert single-repo config to array format for consistency
                const docsDirectory = getEnv("MIMIR_GITHUB_DOCS_DIRECTORY", false);
                const docsIncludeDirs = getEnv("MIMIR_GITHUB_DOCS_INCLUDE_DIRECTORIES", false);
                docsRepos = [{
                    url: docsUrl,
                    directory: docsDirectory,
                    includeDirectories: docsIncludeDirs?.split(",").map(p => p.trim()).filter(Boolean),
                }];
            }

            return {
                githubUrl,
                directory: getEnv("MIMIR_GITHUB_DIRECTORY", false),
                includeDirectories: getEnv("MIMIR_GITHUB_INCLUDE_DIRECTORIES", false)?.split(",").map(p => p.trim()).filter(Boolean),
                // Backward compatibility: keep single-repo fields
                codeUrl,
                codeDirectory: getEnv("MIMIR_GITHUB_CODE_DIRECTORY", false),
                codeIncludeDirectories: getEnv("MIMIR_GITHUB_CODE_INCLUDE_DIRECTORIES", false)?.split(",").map(p => p.trim()).filter(Boolean),
                docsUrl,
                docsDirectory: getEnv("MIMIR_GITHUB_DOCS_DIRECTORY", false),
                docsIncludeDirectories: getEnv("MIMIR_GITHUB_DOCS_INCLUDE_DIRECTORIES", false)?.split(",").map(p => p.trim()).filter(Boolean),
                // Multiple repos support
                codeRepos,
                docsRepos,
                branch: getEnv("MIMIR_GITHUB_BRANCH", false) ?? "main",
                token: getEnv("MIMIR_GITHUB_TOKEN", false),
                outputDir: getEnv("MIMIR_GITHUB_OUTPUT_DIR", false) ?? "./tmp/github-cache",
            };
        })(),
        parser: {
            extractVariables: getEnvBoolean("MIMIR_EXTRACT_VARIABLES", false),
            extractMethods: getEnvBoolean("MIMIR_EXTRACT_METHODS", true),
            excludePatterns: [
                // TypeScript/JavaScript test patterns
                "*.test.ts",
                "*.test.tsx",
                "*.spec.ts",
                "*.spec.tsx",
                "*.test.js",
                "*.test.jsx",
                "*.spec.js",
                "*.spec.jsx",
                "test/",
                "__tests__/",
                "tests/",
                // Python test patterns
                "test_*.py",
                "*_test.py",
                "*_tests.py",
                "tests/",
                "test/",
                "__tests__/",
                // Rust test patterns
                "*_test.rs",
                "*_tests.rs",
                "tests/",
                "test/",
                "benches/",
                // User-defined patterns from env (appended to allow overrides)
                ...(getEnv("MIMIR_EXCLUDE_PATTERNS", false)?.split(",").map(p => p.trim()).filter(Boolean) ?? []),
            ],
            includeDirectories: getEnv("MIMIR_GITHUB_INCLUDE_DIRECTORIES", false)?.split(",").map(p => p.trim()).filter(Boolean),
        },
        docs: {
            baseUrl: getEnv("MIMIR_DOCS_BASE_URL", false),
            contentPath: getEnv("MIMIR_DOCS_CONTENT_PATH", false),
        },
        llm: {
            embedding: {
                provider: embeddingProvider,
                model: embeddingModel,
                apiKey: getEnv("MIMIR_LLM_EMBEDDING_API_KEY", false),
                baseUrl: getEnv("MIMIR_LLM_EMBEDDING_BASE_URL", false),
                limits: {
                    batchSize: getEnvNumber("MIMIR_LLM_EMBEDDING_LIMITS_BATCH_SIZE", 100),
                    concurrency: getEnvNumber("MIMIR_LLM_EMBEDDING_LIMITS_CONCURRENCY", 8),
                    maxRequestsPerMinute: getEnvNumber("MIMIR_LLM_EMBEDDING_LIMITS_MAX_REQUESTS_PER_MINUTE", 1500),
                    maxTokensPerMinute: getEnvNumber("MIMIR_LLM_EMBEDDING_LIMITS_MAX_TOKENS_PER_MINUTE", 6250000),
                    retries: getEnvNumber("MIMIR_LLM_EMBEDDING_LIMITS_RETRIES", 1),
                },
            },
            chat: {
                provider: chatProvider,
                model: chatModel,
                apiKey: getEnv("MIMIR_LLM_CHAT_API_KEY", false),
                baseUrl: getEnv("MIMIR_LLM_CHAT_BASE_URL", false),
                temperature: getEnvNumber("MIMIR_LLM_CHAT_TEMPERATURE", 0),
                maxOutputTokens: getEnvNumber("MIMIR_LLM_CHAT_MAX_OUTPUT_TOKENS", 8000),
                limits: {
                    concurrency: getEnvNumber("MIMIR_LLM_CHAT_LIMITS_CONCURRENCY", 8),
                    maxRequestsPerMinute: getEnvNumber("MIMIR_LLM_CHAT_LIMITS_MAX_REQUESTS_PER_MINUTE", 500),
                    maxTokensPerMinute: getEnvNumber("MIMIR_LLM_CHAT_LIMITS_MAX_TOKENS_PER_MINUTE", 90000),
                    retries: getEnvNumber("MIMIR_LLM_CHAT_LIMITS_RETRIES", 5),
                },
            },
        },
    };

    // Resolve relative paths
    if (config.github?.outputDir) {
        config.github.outputDir = path.resolve(PACKAGE_ROOT, config.github.outputDir);
    }

    return config;
}
