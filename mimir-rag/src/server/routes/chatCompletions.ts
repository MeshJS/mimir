import type { Request, Response } from "express";
import type { Logger } from "pino";
import { askAi } from "../../query/askAi";
import type { AppConfig } from "../../config/types";
import type { LLMClientBundle } from "../../llm/types";
import type { SupabaseVectorStore } from "../../supabase/client";

export interface ChatCompletionsContext {
    config: AppConfig;
    llm: LLMClientBundle;
    store: SupabaseVectorStore;
}

interface OpenAIMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

interface OpenAIChatRequest {
    model?: string;
    messages: OpenAIMessage[];
    stream?: boolean;
    temperature?: number;
    max_tokens?: number;
    // Custom parameters for RAG
    matchCount?: number;
    similarityThreshold?: number;
}

function extractQuestionAndSystem(messages: OpenAIMessage[]): {
    question: string;
    systemPrompt?: string;
} {
    // Find the last user message as the question
    const userMessages = messages.filter((m) => m.role === "user");
    const question = userMessages[userMessages.length - 1]?.content || "";

    // Find system message if exists
    const systemMessage = messages.find((m) => m.role === "system");
    const systemPrompt = systemMessage?.content;

    return { question, systemPrompt };
}

function createOpenAIResponse(content: string, model: string = "mimir-rag") {
    return {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
            {
                index: 0,
                message: {
                    role: "assistant",
                    content,
                },
                finish_reason: "stop",
            },
        ],
        usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        },
    };
}

function initializeStreamingResponse(res: Response): void {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
    if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
    }
}

function writeStreamChunk(res: Response, delta: string, model: string, isFirst: boolean = false): void {
    if (res.writableEnded) {
        return;
    }

    const chunk = {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
            {
                index: 0,
                delta: isFirst ? { role: "assistant", content: delta } : { content: delta },
                finish_reason: null,
            },
        ],
    };

    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

export async function handleChatCompletions(
    req: Request,
    res: Response,
    context: ChatCompletionsContext,
    logger: Logger
): Promise<void> {
    const body = req.body as OpenAIChatRequest;

    // Validate request
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
        res.status(400).json({
            error: {
                message: "Request body must include a non-empty 'messages' array.",
                type: "invalid_request_error",
                param: "messages",
                code: null,
            },
        });
        return;
    }

    const { question, systemPrompt } = extractQuestionAndSystem(body.messages);

    if (!question.trim()) {
        res.status(400).json({
            error: {
                message: "No user message found in messages array.",
                type: "invalid_request_error",
                param: "messages",
                code: null,
            },
        });
        return;
    }

    const model = body.model || "mimir-rag";
    const isStreaming = body.stream === true;

    if (isStreaming) {
        // Streaming response
        initializeStreamingResponse(res);
        const abortController = new AbortController();

        const closeHandler = (): void => {
            if (res.writableEnded) {
                return;
            }
            abortController.abort();
        };

        res.on("close", closeHandler);

        try {
            const response = await askAi(
                context.llm,
                context.store,
                {
                    question,
                    matchCount: body.matchCount,
                    similarityThreshold: body.similarityThreshold,
                    systemPrompt,
                    stream: true,
                    signal: abortController.signal,
                },
                {
                    logger,
                    config: context.config,
                }
            );

            let isFirstChunk = true;
            for await (const chunk of response.stream) {
                writeStreamChunk(res, chunk, model, isFirstChunk);
                isFirstChunk = false;
            }

            // Send final chunk with finish_reason
            const finalChunk = {
                id: `chatcmpl-${Date.now()}`,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [
                    {
                        index: 0,
                        delta: {},
                        finish_reason: "stop",
                    },
                ],
            };
            res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
            res.write("data: [DONE]\n\n");
        } catch (error) {
            if (abortController.signal.aborted) {
                logger.warn("Streaming chat completions request aborted by client.");
            } else {
                logger.error({ err: error }, "Streaming chat completions failed.");
            }
        } finally {
            res.off("close", closeHandler);
            if (!res.writableEnded) {
                res.end();
            }
        }
    } else {
        // Non-streaming response
        try {
            const response = await askAi(
                context.llm,
                context.store,
                {
                    question,
                    matchCount: body.matchCount,
                    similarityThreshold: body.similarityThreshold,
                    systemPrompt,
                },
                {
                    logger,
                    config: context.config,
                }
            );

            res.json(createOpenAIResponse(response.answer, model));
        } catch (error) {
            logger.error({ err: error }, "Chat completions endpoint failed.");
            res.status(500).json({
                error: {
                    message: (error as Error).message,
                    type: "internal_server_error",
                    param: null,
                    code: null,
                },
            });
        }
    }
}
