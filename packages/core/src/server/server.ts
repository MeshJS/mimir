import type { Server } from "node:http";
import express from "express";
import type { AppConfig } from "../config/types";
import { loadAppConfig, resolveConfigPath } from "../config/loadConfig";
import { configureLogger, getLogger } from "../utils/logger";
import { createLLMClient } from "../llm/factory";
import type { LLMClientBundle } from "../llm/types";
import { createSupabaseStore, type SupabaseVectorStore } from "../supabase/client";
import { runIngestionPipeline } from "../ingest/pipeline";
import { askAi } from "../query/askAi";

export interface ServerOptions {
    configPath?: string;
    port?: number;
}

interface ServerContext {
    config: AppConfig;
    llm: LLMClientBundle;
    store: SupabaseVectorStore;
    ingestionBusy: boolean;
}

type ExpressApp = ReturnType<typeof express>;

export interface RunningServer {
    app: ExpressApp;
    port: number;
    close(): Promise<void>;
}

async function createContext(configPath?: string): Promise<ServerContext> {
    const resolvedPath = resolveConfigPath(configPath);
    const config = await loadAppConfig(resolvedPath);

    configureLogger(config.logging);
    const logger = getLogger();
    logger.info({ resolvedPath }, "Loaded server configuration.");

    const llm = createLLMClient(config.llm, logger);
    const store = createSupabaseStore(config);
    await store.verifyConnection();

    return {
        config,
        llm,
        store,
        ingestionBusy: false,
    };
}

function applyCors(req: any, res: any, next: any): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
    }
    next();
}

export async function createServer(options: ServerOptions = {}): Promise<{ app: ExpressApp; context: ServerContext }> {
    const context = await createContext(options.configPath);
    const logger = getLogger();

    const app = express();
    app.use(express.json());
    app.use(applyCors);

    app.get("/health", (_req: any, res: any) => {
        res.json({ status: "ok", ingestionBusy: context.ingestionBusy });
    });

    app.post("/ingest", async (_req: any, res: any) => {
        if (context.ingestionBusy) {
            res.status(409).json({ status: "error", message: "Ingestion already running." });
            return;
        }

        context.ingestionBusy = true;
        const startedAt = Date.now();

        try {
            const result = await runIngestionPipeline(context.config, context.llm, context.store, logger);
            res.json({
                status: "ok",
                durationMs: Date.now() - startedAt,
                stats: result.stats,
            });
        } catch (error) {
            logger.error({ err: error }, "Ingestion failed.");
            res.status(500).json({ status: "error", message: (error as Error).message });
        } finally {
            context.ingestionBusy = false;
        }
    });

    app.post("/ask", async (req: any, res: any) => {
        const { question, matchCount, similarityThreshold, systemPrompt } = req.body ?? {};

        if (typeof question !== "string" || question.trim().length === 0) {
            res.status(400).json({ status: "error", message: "Request body must include a non-empty 'question' field." });
            return;
        }

        try {
            const response = await askAi(context.llm, context.store, {
                question,
                matchCount,
                similarityThreshold,
                systemPrompt,
            }, {
                logger,
                config: context.config,
            });

            res.json({
                status: "ok",
                answer: response.answer,
                sources: response.sources,
            });
        } catch (error) {
            logger.error({ err: error }, "Ask endpoint failed.");
            res.status(500).json({ status: "error", message: (error as Error).message });
        }
    });

    return { app, context };
}

export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
    const { app } = await createServer(options);
    const logger = getLogger();
    const port = options.port ?? Number(process.env.PORT ?? 3000);

    const server: Server = await new Promise((resolve, reject) => {
        const listener = app
            .listen(port, () => {
                listener.off("error", reject);
                resolve(listener);
            })
            .on("error", reject);
    });

    logger.info({ port }, "Server listening.");

    return {
        app,
        port,
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.close((error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                });
            }),
    };
}
