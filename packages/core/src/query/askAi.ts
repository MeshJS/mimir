import type { LLMClientBundle } from "../llm/types";
import type { SupabaseVectorStore } from "../supabase/client";
import type { Logger } from "pino";
import { getLogger } from "../utils/logger";

export interface AskAiOptions {
    question: string;
    matchCount?: number;
    similarityThreshold?: number;
    systemPrompt?: string;
}

export interface AskAiSource {
    filepath: string;
    chunkTitle: string;
}

export interface AskAiResult {
    answer: string;
    sources: AskAiSource[];
}

export async function askAi(
    llm: LLMClientBundle,
    store: SupabaseVectorStore,
    options: AskAiOptions,
    logger?: Logger
): Promise<AskAiResult> {
    const activeLogger = logger ?? getLogger();
    const trimmedQuestion = options.question.trim();

    if (!trimmedQuestion) {
        throw new Error("Question cannot be empty.");
    }

    activeLogger.info({ question: trimmedQuestion }, "Embedding query.");
    const queryEmbedding = await llm.embedding.embedQuery(trimmedQuestion);

    activeLogger.info("Retrieving similar chunks from Supabase.");
    const matches = await store.matchDocuments(queryEmbedding, {
        matchCount: options.matchCount,
        similarityThreshold: options.similarityThreshold,
    });

    if (matches.length === 0) {
        activeLogger.warn("No similar chunks found for query.");
        return {
            answer: "I could not find relevant context to answer that question.",
            sources: [],
        };
    }

    activeLogger.info({ matchCount: matches.length }, "Generating answer with retrieved context.");

    const answer = await llm.chat.generateAnswer({
        prompt: trimmedQuestion,
        context: matches,
        systemPrompt: options.systemPrompt,
    });

    const sources: AskAiSource[] = matches.map((match) => ({
        filepath: match.filepath,
        chunkTitle: match.chunkTitle,
    }));

    activeLogger.info({ answer }, "answer from the AI")

    return { answer, sources };
}
