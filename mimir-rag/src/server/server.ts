import type { Server } from "node:http";
import express from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config/types";
import { loadAppConfig, resolveConfigPath } from "../config/loadConfig";
import { configureLogger, getLogger } from "../utils/logger";
import { createLLMClient } from "../llm/factory";
import type { LLMClientBundle } from "../llm/types";
import { createSupabaseStore, type SupabaseVectorStore } from "../supabase/client";
import { runIngestionPipeline } from "../ingest/pipeline";
import { askAi } from "../query/askAi";
import { createApiKeyMiddleware } from "./middleware/apiKey";
import { isStreamingRequest, streamAskResponse } from "./streamingAsk";

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
type RequestWithRawBody = express.Request & { rawBody?: Buffer };

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

    const triggerIngestion = async (
        res: any,
        trigger: string,
        options?: { busyStatus?: number; busyMessage?: string; busyState?: "error" | "pending" }
    ) => {
        if (context.ingestionBusy) {
            res
                .status(options?.busyStatus ?? 409)
                .json({
                    status: options?.busyState ?? "error",
                    message: options?.busyMessage ?? "Ingestion already running.",
                });
            return;
        }

        context.ingestionBusy = true;
        const startedAt = Date.now();

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
            context.ingestionBusy = false;
        }
    };

    app.get("/health", (_req: any, res: any) => {
        res.json({ status: "ok", ingestionBusy: context.ingestionBusy });
    });

    app.post("/ingest", async (_req: any, res: any) => {
        await triggerIngestion(res, "manual-request");
    });

    app.post("/ask", async (req: any, res: any) => {
        const { question, matchCount, similarityThreshold, systemPrompt } = req.body ?? {};

        if (typeof question !== "string" || question.trim().length === 0) {
            res.status(400).json({ status: "error", message: "Request body must include a non-empty 'question' field." });
            return;
        }

        if (isStreamingRequest(req)) {
            await streamAskResponse(
                req,
                res,
                {
                    config: context.config,
                    llm: context.llm,
                    store: context.store,
                },
                logger,
                {
                    question,
                    matchCount,
                    similarityThreshold,
                    systemPrompt,
                }
            );
            return;
        }

        try {
            const response = await askAi(
                context.llm,
                context.store,
                {
                    question,
                    matchCount,
                    similarityThreshold,
                    systemPrompt,
                },
                {
                    logger,
                    config: context.config,
                }
            );

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

    app.post("/mcp/ask", async (req: any, res: any) => {
        const { question, matchCount, similarityThreshold, systemPrompt, provider, model, apiKey } = req.body ?? {};

        if (typeof question !== "string" || question.trim().length === 0) {
            res.status(400).json({ status: "error", message: "Request body must include a non-empty 'question' field." });
            return;
        }

        // Validate MCP parameters
        if (!provider || !model || !apiKey) {
            res.status(400).json({
                status: "error",
                message: "Request body must include 'provider', 'model', and 'apiKey' fields."
            });
            return;
        }

        try {
            // Create a temporary LLM client with the provided credentials
            const mcpLlm = createLLMClient(
                {
                    embedding: context.config.llm.embedding, // Use default embedding
                    chat: {
                        provider: provider as any,
                        model: model,
                        apiKey: apiKey,
                        temperature: context.config.llm.chat.temperature,
                        maxOutputTokens: context.config.llm.chat.maxOutputTokens,
                    }
                },
                logger
            );

            const response = await askAi(
                mcpLlm,
                context.store,
                {
                    question,
                    matchCount,
                    similarityThreshold,
                    systemPrompt,
                },
                {
                    logger,
                    config: context.config,
                }
            );

            res.json({
                status: "ok",
                answer: response.answer,
                sources: response.sources,
            });
        } catch (error) {
            logger.error({ err: error }, "MCP Ask endpoint failed.");
            res.status(500).json({ status: "error", message: (error as Error).message });
        }
    });

    app.post("/webhook/github", async (req: RequestWithRawBody, res: any) => {
        const secret = context.config.server.githubWebhookSecret;

        if (!secret) {
            res.status(501).json({
                status: "error",
                message: "GitHub webhook secret is not configured on the server.",
            });
            return;
        }

        const signatureHeader = getHeaderValue(req.headers["x-hub-signature-256"]);
        const rawBody = req.rawBody;

        if (!verifyGithubSignature(secret, signatureHeader, rawBody)) {
            res.status(401).json({ status: "error", message: "Invalid GitHub signature." });
            return;
        }

        const eventType = getHeaderValue(req.headers["x-github-event"]) ?? "unknown";

        if (eventType === "ping") {
            res.json({ status: "ok", message: "pong" });
            return;
        }

        const repoName = req.body?.repository?.full_name ?? "unknown-repo";

        await triggerIngestion(res, `github-webhook:${repoName}:${eventType}`, {
            busyStatus: 202,
            busyState: "pending",
            busyMessage: "Ingestion already running. Webhook acknowledged.",
        });
    });

    return { app, context };
}

function getHeaderValue(header: string | string[] | undefined): string | undefined {
    if (Array.isArray(header)) {
        return header[0];
    }
    return header;
}

function verifyGithubSignature(secret: string, signature: string | undefined, rawBody?: Buffer): boolean {
    if (!secret || !signature || !rawBody) {
        return false;
    }

    const hmac = createHmac("sha256", secret);
    hmac.update(rawBody);
    const expected = `sha256=${hmac.digest("hex")}`;

    const expectedBuffer = Buffer.from(expected);
    const signatureBuffer = Buffer.from(signature);

    if (expectedBuffer.length !== signatureBuffer.length) {
        return false;
    }

    try {
        return timingSafeEqual(expectedBuffer, signatureBuffer);
    } catch {
        return false;
    }
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
