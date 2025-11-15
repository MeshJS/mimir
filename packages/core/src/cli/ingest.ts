import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config/types";
import { configureLogger, getLogger } from "../utils/logger";
import { createLLMClient } from "../llm/factory";
import { createSupabaseStore } from "../supabase/client";
import { runIngestionPipeline, type IngestionPipelineStats } from "../ingest/pipeline";

interface CliOptions {
    configPath: string;
}

const DEFAULT_CONFIG_FILENAME = "mimir.config.json";
const CONFIG_EXAMPLE_RELATIVE = "apps/mimir-rag/packages/core/mimir.config.example.json";

function printHelp(): void {
    const lines = [
        "Usage: ingest --config <path-to-config.json>",
        "",
        "Options:",
        "  -c, --config   Path to the JSON configuration file.",
        "  -h, --help     Show this help message.",
    ];
    console.log(lines.join("\n"));
}

function parseArgs(argv: string[]): CliOptions {
    let configPath: string | undefined;

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];

        if (arg === "-h" || arg === "--help") {
            printHelp();
            process.exit(0);
        }

        if (arg === "-c" || arg === "--config") {
            configPath = argv[i + 1];
            i += 1;
            continue;
        }

        if (!configPath) {
            configPath = arg;
        }
    }

    const providedPath = configPath ?? process.env.MIMIR_CONFIG_PATH;
    const finalPath = providedPath
        ? path.resolve(process.cwd(), providedPath)
        : path.resolve(process.cwd(), DEFAULT_CONFIG_FILENAME);

    return { configPath: finalPath };
}

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

    const llmConfig = value.llm;

    if (!llmConfig) {
        throw new Error("LLM configuration is missing in the config file.");
    }

    const embeddingConfig = llmConfig.embedding;

    if (!embeddingConfig) {
        throw new Error("LLM embedding configuration is missing.");
    }

    const chatConfig = llmConfig.chat;

    if (!chatConfig) {
        throw new Error("LLM chat configuration is missing.");
    }

    const embeddingRequiredFields: Array<keyof AppConfig["llm"]["embedding"]> = ["provider", "model"];
    embeddingRequiredFields.forEach((field) => {
        if (embeddingConfig[field] === undefined || embeddingConfig[field] === null) {
            throw new Error(`Embedding configuration is missing the "${field}" field.`);
        }
    });

    const chatRequiredFields: Array<keyof AppConfig["llm"]["chat"]> = ["provider", "model", "temperature"];
    chatRequiredFields.forEach((field) => {
        if (chatConfig[field] === undefined || chatConfig[field] === null) {
            throw new Error(`Chat configuration is missing the "${field}" field.`);
        }
    });
}

async function loadConfig(configPath: string): Promise<AppConfig> {
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

function logStats(stats: IngestionPipelineStats): void {
    const logger = getLogger();
    logger.info(`Processed documents: ${stats.processedDocuments}`);
    logger.info(`Skipped documents: ${stats.skippedDocuments}`);
    logger.info(`Chunks upserted: ${stats.upsertedChunks}`);
    logger.info(`Chunks reordered: ${stats.reorderedChunks}`);
    logger.info(`Chunks deleted: ${stats.deletedChunks}`);
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const config = await loadConfig(options.configPath);

    configureLogger(config.logging);
    const logger = getLogger();

    logger.info(`Loaded configuration from ${options.configPath}`);

    const llm = createLLMClient(config.llm, logger);
    const store = createSupabaseStore(config);

    await store.verifyConnection();

    logger.info("Starting ingestion pipeline.");

    const result = await runIngestionPipeline(config, llm, store, logger);

    logStats(result.stats);

    logger.info("Ingestion pipeline completed.");
}

main().catch((error) => {
    const logger = getLogger();
    logger.error({ err: error }, "Ingestion pipeline failed.");
    process.exitCode = 1;
});
