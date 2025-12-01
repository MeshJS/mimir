import { Router } from "express";
import type { Logger } from "pino";
import type { AppConfig } from "../../config/types";
import type { LLMClientBundle } from "../../llm/types";
import type { SupabaseVectorStore } from "../../supabase/client";
import { handleMcpMatchRequest } from "../routes/mcpMatch";

interface McpRouterContext {
    config: AppConfig;
    llm: LLMClientBundle;
    store: SupabaseVectorStore;
}

export function createMcpRouter(context: McpRouterContext, logger: Logger): Router {
    const router = Router();

    router.post("/ask", async (req, res) => {
        await handleMcpMatchRequest(req, res, {
            config: context.config,
            llm: context.llm,
            store: context.store,
        }, logger);
    });

    return router;
}
