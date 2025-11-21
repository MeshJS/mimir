import { configureLogger, getLogger } from "../utils/logger";
import { createLLMClient } from "../llm/factory";
import { createSupabaseStore } from "../supabase/client";
import { runIngestionPipeline, type IngestionPipelineStats } from "../ingest/pipeline";
import { loadAppConfig, resolveEnvPath } from "../config/loadConfig";

interface CliOptions {
    envPath?: string;
}

function printHelp(): void {
    const lines = [
        "Usage: ingest [--env <path-to-env>]",
        "",
        "Options:",
        "  -e, --env      Path to a .env file (defaults to resolver logic).",
        "  -h, --help     Show this help message.",
    ];
    console.log(lines.join("\n"));
}

function parseArgs(argv: string[]): CliOptions {
    let envPath: string | undefined;

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];

        if (arg === "-h" || arg === "--help") {
            printHelp();
            process.exit(0);
        }

        if (arg === "-e" || arg === "--env") {
            envPath = argv[i + 1];
            i += 1;
            continue;
        }

        if (!envPath) {
            envPath = arg;
        }
    }

    return { envPath };
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
    const envPathHint = options.envPath ?? process.env.MIMIR_ENV_PATH;
    const resolvedEnvPath = resolveEnvPath(options.envPath);
    const config = await loadAppConfig({ envPath: options.envPath });

    configureLogger(config.logging);
    const logger = getLogger();

    if (envPathHint) {
        logger.info(`Loaded configuration from ${resolvedEnvPath}`);
    } else {
        logger.info("Loaded configuration from environment variables.");
    }

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
