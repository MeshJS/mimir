import type { Request, Response } from "express";
import type { Logger } from "pino";
import { askAi } from "../../query/askAi";
import type { AppConfig } from "../../config/types";
import type { LLMClientBundle } from "../../llm/types";
import type { SupabaseVectorStore } from "../../supabase/client";

export interface AskRouteContext {
    config: AppConfig;
    llm: LLMClientBundle;
    store: SupabaseVectorStore;
}

function isStreamingRequest(req: Request): boolean {
    const acceptHeader = typeof req?.headers?.accept === "string" ? req.headers.accept.toLowerCase() : "";
    if (acceptHeader.includes("text/event-stream")) {
        return true;
    }

    const normalize = (value: unknown): boolean => {
        if (typeof value === "boolean") {
            return value;
        }

        if (typeof value === "string") {
            const lowered = value.trim().toLowerCase();
            return lowered === "1" || lowered === "true" || lowered === "yes" || lowered === "on";
        }

        return false;
    };

    return normalize(req?.query?.stream) || normalize(req?.body?.stream);
}

function initializeEventStream(res: Response): void {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
    }
}

function pushStreamEvent(res: Response, event: string, payload: unknown): void {
    if (res.writableEnded) {
        return;
    }

    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function handleStreamingAsk(
    req: Request,
    res: Response,
    context: AskRouteContext,
    logger: Logger,
    options: {
        question: string;
        matchCount?: number;
        similarityThreshold?: number;
        systemPrompt?: string;
    }
): Promise<void> {
    initializeEventStream(res);
    const abortController = new AbortController();

    const closeHandler = (): void => {
        if (res.writableEnded) {
            return;
        }
        abortController.abort();
    };

    res.on("close", closeHandler);
    pushStreamEvent(res, "status", { state: "started" });

    try {
        const response = await askAi(
            context.llm,
            context.store,
            {
                question: options.question,
                matchCount: options.matchCount,
                similarityThreshold: options.similarityThreshold,
                systemPrompt: options.systemPrompt,
                stream: true,
                signal: abortController.signal,
            },
            {
                logger,
                config: context.config,
            }
        );

        // Consume the stream and send tokens to client
        let fullAnswer = "";
        for await (const chunk of response.stream) {
            fullAnswer += chunk;
            pushStreamEvent(res, "token", { text: chunk });
        }

        pushStreamEvent(res, "final", {
            answer: fullAnswer.trim(),
            sources: response.sources,
        });
    } catch (error) {
        if (abortController.signal.aborted) {
            logger.warn("Streaming /ask request aborted by client.");
        } else {
            logger.error({ err: error }, "Streaming ask endpoint failed.");
            pushStreamEvent(res, "error", { message: (error as Error).message });
        }
    } finally {
        pushStreamEvent(res, "end", {});
        res.off("close", closeHandler);
        if (!res.writableEnded) {
            res.end();
        }
    }
}

export async function handleAskRequest(
    req: Request,
    res: Response,
    context: AskRouteContext,
    logger: Logger
): Promise<void> {
    const { question, matchCount, similarityThreshold, systemPrompt } = req.body ?? {};

    if (typeof question !== "string" || question.trim().length === 0) {
        res.status(400).json({
            status: "error",
            message: "Request body must include a non-empty 'question' field.",
        });
        return;
    }

    if (isStreamingRequest(req)) {
        await handleStreamingAsk(req, res, context, logger, {
            question,
            matchCount,
            similarityThreshold,
            systemPrompt,
        });
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
}
