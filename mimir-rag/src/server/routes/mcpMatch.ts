import type { Request, Response } from "express";
import type { Logger } from "pino";
import type { AppConfig } from "../../config/types";
import type { LLMClientBundle } from "../../llm/types";
import type { PostgresVectorStore } from "../../database/client";

export interface McpMatchRouteContext {
    config: AppConfig;
    llm: LLMClientBundle;
    store: PostgresVectorStore;
}

interface MatchDocumentResult {
    chunkTitle: string;
    chunkContent: string;
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

        logger.info({ question: trimmedQuestion }, "Embedding query for document matching.");
        const queryEmbedding = await context.llm.embedding.embedQuery(trimmedQuestion);

        const databaseConfig = context.config.database;
        const desiredMatchCount = matchCount ?? databaseConfig?.matchCount ?? 10;
        const threshold = similarityThreshold ?? databaseConfig?.similarityThreshold;

        const matches = await context.store.matchDocuments(queryEmbedding, {
            matchCount: desiredMatchCount,
            similarityThreshold: threshold,
        });

        const results: MatchDocumentResult[] = matches.map((match) => ({
            chunkTitle: match.chunkTitle,
            chunkContent: match.content,
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
