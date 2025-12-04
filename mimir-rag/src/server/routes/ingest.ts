import type { Request, Response } from "express";
import type { Logger } from "pino";
import type { AppConfig } from "../../config/types";
import type { LLMClientBundle } from "../../llm/types";
import type { SupabaseVectorStore } from "../../supabase/client";
import { runIngestionPipeline } from "../../ingest/pipeline";

export interface IngestRouteContext {
    config: AppConfig;
    llm: LLMClientBundle;
    store: SupabaseVectorStore;
    ingestionBusy: boolean;
    setIngestionBusy: (busy: boolean) => void;
}

interface TriggerIngestionOptions {
    busyStatus?: number;
    busyMessage?: string;
    busyState?: "error" | "pending";
}

async function triggerIngestion(
    res: Response,
    context: IngestRouteContext,
    logger: Logger,
    trigger: string,
    options?: TriggerIngestionOptions
): Promise<void> {
    if (context.ingestionBusy) {
        res.status(options?.busyStatus ?? 409).json({
            status: options?.busyState ?? "error",
            message: options?.busyMessage ?? "Ingestion already running.",
        });
        return;
    }

    context.setIngestionBusy(true);
    const startedAt = Date.now();

    const isWebhook = trigger.startsWith('github-webhook');

    if (isWebhook) {
        res.status(202).json({
            status: "accepted",
            message: "Ingestion started in background.",
            trigger,
        });

        runIngestionPipeline(context.config, context.llm, context.store, logger)
            .then((result) => {
                logger.info({ trigger, durationMs: Date.now() - startedAt, stats: result.stats }, "Ingestion completed.");
            })
            .catch((error) => {
                logger.error({ err: error, trigger }, "Ingestion failed.");
            })
            .finally(() => {
                context.setIngestionBusy(false);
            });
    } else {
        try {
            logger.info({ trigger }, "Starting ingestion.");
            const result = await runIngestionPipeline(context.config, context.llm, context.store, logger);
            res.json({
                status: "ok",
                trigger,
                durationMs: Date.now() - startedAt,
                stats: result.stats,
            });
        } catch (error) {
            logger.error({ err: error, trigger }, "Ingestion failed.");
            res.status(500).json({ status: "error", message: (error as Error).message });
        } finally {
            context.setIngestionBusy(false);
        }
    }
}

export async function handleIngestRequest(
    _req: Request,
    res: Response,
    context: IngestRouteContext,
    logger: Logger
): Promise<void> {
    await triggerIngestion(res, context, logger, "manual-request");
}

export { triggerIngestion };
