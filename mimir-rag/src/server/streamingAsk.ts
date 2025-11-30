import type { Logger } from "pino";
import { askAi } from "../query/askAi";
import type { AppConfig } from "../config/types";
import type { LLMClientBundle } from "../llm/types";
import type { SupabaseVectorStore } from "../supabase/client";

export interface StreamAskOptions {
    question: string;
    matchCount?: number;
    similarityThreshold?: number;
    systemPrompt?: string;
}

export interface StreamAskContext {
    config: AppConfig;
    llm: LLMClientBundle;
    store: SupabaseVectorStore;
}

export function isStreamingRequest(req: any): boolean {
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

export async function streamAskResponse(
    req: any,
    res: any,
    context: StreamAskContext,
    logger: Logger,
    options: StreamAskOptions
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

function initializeEventStream(res: any): void {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
    }
}

function pushStreamEvent(res: any, event: string, payload: unknown): void {
    if (res.writableEnded) {
        return;
    }

    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
}
