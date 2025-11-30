import type { Request, Response } from "express";
import type { Logger } from "pino";
import type { AppConfig } from "../../config/types";
import type { LLMClientBundle } from "../../llm/types";
import type { SupabaseVectorStore } from "../../supabase/client";

export interface McpMatchRouteContext {
    config: AppConfig;
    llm: LLMClientBundle;
    store: SupabaseVectorStore;
}

interface MatchDocumentResult {
    chunkTitle: string;
    similarity?: number;
    githubUrl?: string;
    docsUrl?: string;
}

export async function handleMcpMatchRequest(
    req: Request,
    res: Response,
    context: McpMatchRouteContext,
    logger: Logger
): Promise<void> {
    const { question, matchCount, similarityThreshold } = req.body ?? {};

    if (typeof question !== "string" || question.trim().length === 0) {
        res.status(400).json({
            status: "error",
            message: "Request body must include a non-empty 'question' field.",
        });
        return;
    }

    try {
        const trimmedQuestion = question.trim();

        // Embed the query
        logger.info({ question: trimmedQuestion }, "Embedding query for document matching.");
        const queryEmbedding = await context.llm.embedding.embedQuery(trimmedQuestion);

        // Get configuration values
        const supabaseConfig = context.config.supabase;
        const desiredMatchCount = matchCount ?? supabaseConfig?.matchCount ?? 10;
        const threshold = similarityThreshold ?? supabaseConfig?.similarityThreshold;

        // Match documents using vector search
        const matches = await context.store.matchDocuments(queryEmbedding, {
            matchCount: desiredMatchCount,
            similarityThreshold: threshold,
        });

        // Transform results to safe format (no content, only metadata)
        const results: MatchDocumentResult[] = matches.map((match) => ({
            chunkTitle: match.chunkTitle,
            similarity: match.similarity,
            githubUrl: match.githubUrl ?? undefined,
            docsUrl: match.docsUrl ?? undefined,
        }));

        res.json({
            status: "ok",
            matches: results,
            count: results.length,
        });
    } catch (error) {
        logger.error({ err: error }, "MCP Match endpoint failed.");
        res.status(500).json({ status: "error", message: (error as Error).message });
    }
}
