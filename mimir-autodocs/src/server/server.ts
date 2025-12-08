import type { Server } from "node:http";
import express from "express";
import { loadConfig } from "../config/loadConfig";
import { configureLogger, getLogger } from "../utils/logger";
import { createLLMClient } from "../llm/factory";
import { createSupabaseStore } from "../supabase/client";
import { createApiKeyMiddleware } from "./middleware/apiKey";
import { createApiRouter } from "./routers/api";
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
    const config = loadConfig();

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

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(applyCors);

    // Apply API key middleware to all routes except /health endpoint
    const apiKeyMiddleware = createApiKeyMiddleware(context.config.server.apiKey);
    app.use((req: any, res: any, next: any) => {
        if (req.path === "/health") {
            next();
        } else {
            apiKeyMiddleware(req, res, next);
        }
    });

    // Prepare router context
    const routerContext = createRouterContext(context);

    // API routes (require API key)
    app.use(createApiRouter(routerContext, logger));

    return { app, context };
}

export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
    const { app, context } = await createServer(options);
    const logger = getLogger();
    const port = options.port ?? context.config.server.port ?? Number(process.env.PORT ?? 3001);

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

