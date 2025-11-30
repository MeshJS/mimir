import type { Request, Response } from "express";
import type { Logger } from "pino";
import { askAi } from "../../query/askAi";
import { createLLMClient } from "../../llm/factory";
import type { AppConfig } from "../../config/types";
import type { SupabaseVectorStore } from "../../supabase/client";

export interface McpAskRouteContext {
    config: AppConfig;
    store: SupabaseVectorStore;
}

export async function handleMcpAskRequest(
    req: Request,
    res: Response,
    context: McpAskRouteContext,
    logger: Logger
): Promise<void> {
    const { question, matchCount, similarityThreshold, systemPrompt, provider, model, apiKey } = req.body ?? {};

    if (typeof question !== "string" || question.trim().length === 0) {
        res.status(400).json({
            status: "error",
            message: "Request body must include a non-empty 'question' field.",
        });
        return;
    }

    // Validate MCP parameters
    if (!provider || !model || !apiKey) {
        res.status(400).json({
            status: "error",
            message: "Request body must include 'provider', 'model', and 'apiKey' fields.",
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
                },
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
}
