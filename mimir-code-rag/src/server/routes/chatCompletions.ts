import type { Request, Response } from "express";
import type { Logger } from "pino";
import { createUIMessageStream, pipeUIMessageStreamToResponse } from "ai";
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
    content?: string;
    parts?: Array<{ type: string; text?: string }>;
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

// Helper to extract text content from a message (supports both OpenAI and AI SDK formats)
function getMessageContent(message: OpenAIMessage): string {
    if (message.parts) {
        return message.parts
            .filter((part) => part.type === "text" && part.text)
            .map((part) => part.text)
            .join("");
    }
    return message.content || "";
}

function extractQuestionAndSystem(messages: OpenAIMessage[]): {
    question: string;
    systemPrompt?: string;
} {
    const userMessages = messages.filter((m) => m.role === "user");
    const lastUserMessage = userMessages[userMessages.length - 1];
    const question = lastUserMessage ? getMessageContent(lastUserMessage) : "";

    const systemMessage = messages.find((m) => m.role === "system");
    const systemPrompt = systemMessage ? getMessageContent(systemMessage) : undefined;

    return { question, systemPrompt };
}

function createOpenAIResponse(content: string, sources: any[], model: string = "mimir-code-rag") {
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

export async function handleChatCompletions(
    req: Request,
    res: Response,
    context: ChatCompletionsContext,
    logger: Logger
): Promise<void> {
    const body = req.body as OpenAIChatRequest;

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

    const model = body.model || "mimir-code-rag";
    const isStreaming = body.stream === true;

    if (isStreaming) {
        // Streaming response using AI SDK data stream protocol
        const abortController = new AbortController();

        const closeHandler = (): void => {
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

            // Create AI SDK UI Message Stream
            const stream = createUIMessageStream({
                execute: async ({ writer }) => {
                    try {
                        const textId = `text-${Date.now()}`;
                        let sentSourcesCount = 0;

                        writer.write({
                            type: "text-start",
                            id: textId,
                        });

                        for await (const textDelta of response.stream) {
                            writer.write({
                                type: "text-delta",
                                delta: textDelta,
                                id: textId,
                            });

                            if (response.sources.length > sentSourcesCount) {
                                const newSources = response.sources.slice(sentSourcesCount);
                                for (const source of newSources) {
                                    writer.write({
                                        type: "source-url",
                                        sourceId: source.finalUrl || source.filepath,
                                        url: source.finalUrl,
                                        title: source.chunkTitle,
                                    });
                                }
                                sentSourcesCount = response.sources.length;
                                logger.info({ sourcesCount: newSources.length }, "Sent sources during stream");
                            }
                        }

                        writer.write({
                            type: "text-end",
                            id: textId,
                        });

                        if (response.sources.length > sentSourcesCount) {
                            const remainingSources = response.sources.slice(sentSourcesCount);
                            for (const source of remainingSources) {
                                writer.write({
                                    type: "source-url",
                                    sourceId: source.finalUrl || source.filepath,
                                    url: source.finalUrl,
                                    title: source.chunkTitle,
                                });
                            }
                            logger.info({ sourcesCount: remainingSources.length }, "Sent remaining sources after stream");
                        }
                    } catch (error) {
                        logger.error({ err: error }, "Error in stream execution");
                        throw error;
                    }
                },
            });

            // Pipe the UI message stream to the response
            pipeUIMessageStreamToResponse({
                stream,
                response: res,
            });
        } catch (error) {
            res.off("close", closeHandler);
            if (abortController.signal.aborted) {
                logger.warn("Streaming chat completions request aborted by client.");
            } else {
                logger.error({ err: error }, "Streaming chat completions failed.");
                if (!res.writableEnded) {
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

            res.json(createOpenAIResponse(response.answer, response.sources, model));
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

