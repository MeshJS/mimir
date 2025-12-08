import { loadConfig } from "../config/loadConfig";
import { configureLogger, getLogger } from "../utils/logger";
import { createLLMClient } from "../llm/factory";
import { createSupabaseStore } from "../supabase/client";
import { runIngestionPipeline, IngestionPipelineStats } from "../ingest/pipeline";

function logStats(stats: IngestionPipelineStats): void {
    const logger = getLogger();
    logger.info("=== Ingestion Statistics ===");
    logger.info(`Files processed:    ${stats.processedFiles}`);
    logger.info(`Files skipped:      ${stats.skippedFiles}`);
    logger.info(`Parse errors:       ${stats.parseErrors}`);
    logger.info(`Total entities:     ${stats.totalEntities}`);
    logger.info(`Chunks upserted:    ${stats.upsertedChunks}`);
    logger.info(`Chunks moved:       ${stats.movedChunks}`);
    logger.info(`Chunks deleted:     ${stats.deletedChunks}`);
    logger.info("============================");
}

async function main(): Promise<void> {
    const config = loadConfig();
    configureLogger(config.logging);

    const logger = getLogger();
    logger.info("Starting TypeScript autodocs ingestion...");

    const llm = createLLMClient(config.llm, logger);
    const store = createSupabaseStore(config);

    logger.info("Verifying Supabase connection...");
    await store.verifyConnection();

    const startTime = Date.now();

    const result = await runIngestionPipeline(config, llm, store, logger);

    const durationMs = Date.now() - startTime;
    const durationSec = (durationMs / 1000).toFixed(2);

    logger.info(`Ingestion completed in ${durationSec}s`);
    logStats(result.stats);

    process.exit(0);
}

main().catch((error) => {
    console.error("Fatal error during ingestion:", error);
    process.exit(1);
});

