import { Router } from "express";
import type { Logger } from "pino";
import type { AppConfig } from "../../config/types";
import type { LLMClientBundle } from "../../llm/types";
import type { SupabaseVectorStore } from "../../supabase/client";
import { handleGithubWebhookRequest, type RequestWithRawBody } from "../routes/githubWebhook";

interface WebhookRouterContext {
    config: AppConfig;
    llm: LLMClientBundle;
    store: SupabaseVectorStore;
    ingestionBusy: boolean;
    setIngestionBusy: (busy: boolean) => void;
}

export function createWebhookRouter(context: WebhookRouterContext, logger: Logger): Router {
    const router = Router();

    router.post("/github", async (req: RequestWithRawBody, res) => {
        await handleGithubWebhookRequest(req, res, {
            config: context.config,
            llm: context.llm,
            store: context.store,
            ingestionBusy: context.ingestionBusy,
            setIngestionBusy: context.setIngestionBusy,
            githubWebhookSecret: context.config.server.githubWebhookSecret,
        }, logger);
    });

    return router;
}
