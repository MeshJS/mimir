import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "./types";

const DEFAULT_CONFIG_FILENAME = "packages/core/mimir.config.json";
const CONFIG_EXAMPLE_RELATIVE = "apps/mimir-rag/packages/core/mimir.config.example.json";

function assertConfigShape(value: Partial<AppConfig>): asserts value is AppConfig {
    if (!value.supabase) {
        throw new Error("Supabase configuration is missing in the config file.");
    }

    const requiredSupabaseFields: Array<keyof AppConfig["supabase"]> = [
        "url",
        "serviceRoleKey",
        "table",
        "similarityThreshold",
        "matchCount",
    ];

    for (const field of requiredSupabaseFields) {
        if (value.supabase[field] === undefined || value.supabase[field] === null) {
            throw new Error(`Supabase configuration is missing the "${field}" field.`);
        }
    }

    if (!value.llm) {
        throw new Error("LLM configuration is missing in the config file.");
    }

    const embeddingConfig = value.llm.embedding;
    if (!embeddingConfig) {
        throw new Error("LLM embedding configuration is missing.");
    }

    const chatConfig = value.llm.chat;
    if (!chatConfig) {
        throw new Error("LLM chat configuration is missing.");
    }

    const embeddingRequiredFields: Array<keyof AppConfig["llm"]["embedding"]> = ["provider", "model"];
    for (const field of embeddingRequiredFields) {
        if (embeddingConfig[field] === undefined || embeddingConfig[field] === null) {
            throw new Error(`Embedding configuration is missing the "${field}" field.`);
        }
    }

    const chatRequiredFields: Array<keyof AppConfig["llm"]["chat"]> = ["provider", "model", "temperature"];
    for (const field of chatRequiredFields) {
        if (chatConfig[field] === undefined || chatConfig[field] === null) {
            throw new Error(`Chat configuration is missing the "${field}" field.`);
        }
    }
}

export function resolveConfigPath(providedPath?: string): string {
    if (providedPath) {
        return path.resolve(process.cwd(), providedPath);
    }

    if (process.env.MIMIR_CONFIG_PATH) {
        return path.resolve(process.cwd(), process.env.MIMIR_CONFIG_PATH);
    }

    return path.resolve(process.cwd(), DEFAULT_CONFIG_FILENAME);
}

export async function loadAppConfig(configPath: string): Promise<AppConfig> {
    try {
        const raw = await fs.readFile(configPath, "utf8");
        const parsed = JSON.parse(raw) as Partial<AppConfig>;
        assertConfigShape(parsed);
        return parsed;
    } catch (error) {
        const err = error as NodeJS.ErrnoException;

        if (err.code === "ENOENT") {
            throw new Error(
                [
                    `Configuration file not found at "${configPath}".`,
                    `Copy ${CONFIG_EXAMPLE_RELATIVE} to ${DEFAULT_CONFIG_FILENAME} and fill in your project values,`,
                    "or pass a custom path via --config / MIMIR_CONFIG_PATH.",
                ].join(" ")
            );
        }

        throw new Error(`Failed to load configuration from "${configPath}": ${err.message}`);
    }
}
