import type { Server } from "node:http";
import express from "express";
import type { AppConfig } from "../config/types";
import { loadAppConfig, resolveConfigPath } from "../config/loadConfig";
import { configureLogger, getLogger } from "../utils/logger";
import { createLLMClient } from "../llm/factory";
import type { LLMClientBundle } from "../llm/types";
import { createSupabaseStore, type SupabaseVectorStore } from "../supabase/client";
import { createApiKeyMiddleware } from "./middleware/apiKey";
import { handleMcpAskRequest } from "./routes/mcpAsk";
import { handleMcpMatchRequest } from "./routes/mcpMatch";
import { handleHealthRequest } from "./routes/health";
import { handleIngestRequest } from "./routes/ingest";
import { handleGithubWebhookRequest, type RequestWithRawBody } from "./routes/githubWebhook";
import { handleChatCompletions } from "./routes/chatCompletions";

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
    app.use(
        express.json({
            verify: (req, _res, buf) => {
                (req as RequestWithRawBody).rawBody = Buffer.from(buf);
            },
        })
    );
    app.use(applyCors);

    // Apply API key middleware to all routes except /mcp/* endpoints
    const apiKeyMiddleware = createApiKeyMiddleware(context.config.server.apiKey);
    app.use((req: any, res: any, next: any) => {
        if (req.path.startsWith('/mcp/')) {
            next();
        } else {
            apiKeyMiddleware(req, res, next);
        }
    });

    app.get("/health", (req: any, res: any) => {
        handleHealthRequest(req, res, { ingestionBusy: context.ingestionBusy });
    });

    app.post("/ingest", async (req: any, res: any) => {
        await handleIngestRequest(req, res, {
            config: context.config,
            llm: context.llm,
            store: context.store,
            ingestionBusy: context.ingestionBusy,
            setIngestionBusy: (busy: boolean) => {
                context.ingestionBusy = busy;
            },
        }, logger);
    });

    app.post("/v1/chat/completions", async (req: any, res: any) => {
        await handleChatCompletions(
            req,
            res,
            {
                config: context.config,
                llm: context.llm,
                store: context.store,
            },
            logger
        );
    });

    app.post("/mcp/ask", async (req: any, res: any) => {
        await handleMcpAskRequest(
            req,
            res,
            {
                config: context.config,
                store: context.store,
            },
            logger
        );
    });

    app.post("/mcp/match", async (req: any, res: any) => {
        await handleMcpMatchRequest(
            req,
            res,
            {
                config: context.config,
                llm: context.llm,
                store: context.store,
            },
            logger
        );
    });

    app.post("/webhook/github", async (req: RequestWithRawBody, res: any) => {
        await handleGithubWebhookRequest(req, res, {
            config: context.config,
            llm: context.llm,
            store: context.store,
            ingestionBusy: context.ingestionBusy,
            setIngestionBusy: (busy: boolean) => {
                context.ingestionBusy = busy;
            },
            githubWebhookSecret: context.config.server.githubWebhookSecret,
        }, logger);
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
