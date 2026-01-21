import { Router } from "express";
import type { Logger } from "pino";
import type { AppConfig } from "../../config/types";
import type { LLMClientBundle } from "../../llm/types";
import type { PostgresVectorStore } from "../../database/client";
import { handleHealthRequest } from "../routes/health";
import { handleIngestRequest } from "../routes/ingest";
import { handleChatCompletions } from "../routes/chatCompletions";

interface ApiRouterContext {
    config: AppConfig;
    llm: LLMClientBundle;
    store: PostgresVectorStore;
    ingestionBusy: boolean;
    setIngestionBusy: (busy: boolean) => void;
}

export function createApiRouter(context: ApiRouterContext, logger: Logger): Router {
    const router = Router();

    router.get("/health", (req, res) => {
        handleHealthRequest(req, res, { ingestionBusy: context.ingestionBusy });
    });

    router.post("/ingest", async (req, res) => {
        await handleIngestRequest(req, res, {
            config: context.config,
            llm: context.llm,
            store: context.store,
            ingestionBusy: context.ingestionBusy,
            setIngestionBusy: context.setIngestionBusy,
        }, logger);
    });

    router.post("/v1/chat/completions", async (req, res) => {
        await handleChatCompletions(req, res, {
            config: context.config,
            llm: context.llm,
            store: context.store,
        }, logger);
    });

    return router;
}
