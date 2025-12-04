import type { Server } from "node:http";
import express from "express";
import { loadAppConfig } from "../config/loadConfig";
import { configureLogger, getLogger } from "../utils/logger";
import { createLLMClient } from "../llm/factory";
import { createSupabaseStore } from "../supabase/client";
import { createApiKeyMiddleware } from "./middleware/apiKey";
import { type RequestWithRawBody } from "./routes/githubWebhook";
import { createApiRouter } from "./routers/api";
import { createMcpRouter } from "./routers/mcp";
import { createWebhookRouter } from "./routers/webhook";
import { applyCors } from "./utils/cors";
import { type ServerContext, createRouterContext } from "./utils/context";

export interface ServerOptions {
    configPath?: string;
    port?: number;
}

type ExpressApp = ReturnType<typeof express>;

export interface RunningServer {
    app: ExpressApp;
    port: number;
    close(): Promise<void>;
}

async function createContext(configPath?: string): Promise<ServerContext> {
    const config = await loadAppConfig(configPath);

    configureLogger(config.logging);
    const logger = getLogger();
    logger.info("Loaded server configuration.");

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

    // Apply API key middleware to all routes except /mcp/*, /webhook/*, and /health endpoints
    const apiKeyMiddleware = createApiKeyMiddleware(context.config.server.apiKey);
    app.use((req: any, res: any, next: any) => {
        if (req.path.startsWith('/mcp/') || req.path.startsWith('/webhook/') || req.path === '/health') {
            next();
        } else {
            apiKeyMiddleware(req, res, next);
        }
    });

    // Prepare router context
    const routerContext = createRouterContext(context);

    // API routes (require API key)
    app.use(createApiRouter(routerContext, logger));

    // MCP routes (no API key required)
    app.use('/mcp', createMcpRouter(routerContext, logger));

    // Webhook routes (no API key required)
    app.use('/webhook', createWebhookRouter(routerContext, logger));

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
