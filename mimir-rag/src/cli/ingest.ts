import { configureLogger, getLogger } from "../utils/logger";
import { createLLMClient } from "../llm/factory";
import { createSupabaseStore } from "../supabase/client";
import { runIngestionPipeline, type IngestionPipelineStats } from "../ingest/pipeline";
import { loadAppConfig, resolveConfigPath } from "../config/loadConfig";

interface CliOptions {
    configPath: string;
}

function printHelp(): void {
    const lines = [
        "Usage: ingest [--config <path-to-env>]",
        "",
        "Options:",
        "  -c, --config   Path to the .env configuration file (defaults to .env in package root).",
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

    return { configPath: resolveConfigPath(configPath) };
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
    const config = await loadAppConfig(options.configPath);

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
