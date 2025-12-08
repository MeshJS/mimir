import type { AppConfig } from "../config/types";
import type { LLMClientBundle, GenerateAnswerOptions } from "../llm/types";
import type { SupabaseVectorStore } from "../supabase/client";
import type { RetrievedChunk } from "../supabase/types";
import type { Logger } from "pino";
import { getLogger } from "../utils/logger";

export interface AskAiOptions {
    question: string;
    matchCount?: number;
    similarityThreshold?: number;
    systemPrompt?: string;
    stream?: boolean;
    signal?: AbortSignal;
}

export interface AskAiSource {
    filepath: string;
    chunkTitle: string;
    githubUrl?: string;
    finalUrl: string;
    entityType?: string;
    startLine?: number;
    endLine?: number;
}

export interface AskAiResult {
    answer: string;
    sources: AskAiSource[];
}

export interface AskAiStreamResult {
    stream: AsyncIterable<string>;
    sources: AskAiSource[];
}

interface AskAiContextOptions {
    logger?: Logger;
    config?: AppConfig;
}

export async function askAi(
    llm: LLMClientBundle,
    store: SupabaseVectorStore,
    options: AskAiOptions & { stream?: false },
    context?: AskAiContextOptions
): Promise<AskAiResult>;

export async function askAi(
    llm: LLMClientBundle,
    store: SupabaseVectorStore,
    options: AskAiOptions & { stream: true },
    context?: AskAiContextOptions
): Promise<AskAiStreamResult>;

export async function askAi(
    llm: LLMClientBundle,
    store: SupabaseVectorStore,
    options: AskAiOptions,
    context?: AskAiContextOptions
): Promise<AskAiResult | AskAiStreamResult> {
    const activeLogger = context?.logger ?? getLogger();
    const trimmedQuestion = options.question.trim();
    const supabaseConfig = context?.config?.supabase;

    if (!trimmedQuestion) {
        throw new Error("Question cannot be empty.");
    }

    activeLogger.info({ question: trimmedQuestion }, "Embedding query.");
    const queryEmbedding = await llm.embedding.embedQuery(trimmedQuestion, { signal: options.signal });

    activeLogger.info("Retrieving similar chunks from Supabase.");
    const desiredMatchCount = options.matchCount ?? supabaseConfig?.matchCount ?? 10;
    const similarityThreshold = options.similarityThreshold ?? supabaseConfig?.similarityThreshold;

    const matches = await store.matchDocuments(queryEmbedding, {
        matchCount: desiredMatchCount,
        similarityThreshold,
    });

    if (matches.length === 0) {
        activeLogger.warn("No similar chunks found for query.");
        return {
            answer: "I could not find relevant code to answer that question.",
            sources: [],
        };
    }

    activeLogger.info({ matchCount: matches.length }, "Generating answer with retrieved context.");

    if (options.stream) {
        // Streaming mode - simplified for autodocs (no hybrid search)
        const resultStream = await llm.chat.generateAnswer({
            prompt: trimmedQuestion,
            context: matches,
            systemPrompt: options.systemPrompt,
            stream: true,
            signal: options.signal,
        });

        // Convert structured stream to text stream and collect sources
        let previousAnswer = "";
        const collectedSources: AskAiSource[] = [];
        const sourceMap = new Map(matches.map(m => [`${m.filepath}:${m.chunkId}`, m]));

        async function* textStreamGenerator() {
            for await (const chunk of resultStream) {
                if (chunk.answer && chunk.answer !== previousAnswer) {
                    const delta = chunk.answer.slice(previousAnswer.length);
                    previousAnswer = chunk.answer;
                    if (delta) {
                        yield delta;
                    }
                }
                if (chunk.sources && chunk.sources.length > 0) {
                    // Map sources from matches (which have entityType, startLine, endLine)
                    collectedSources.length = 0;
                    collectedSources.push(...chunk.sources.map((src) => {
                        // Find matching chunk by filepath and chunkTitle
                        const match = matches.find(m => m.filepath === src.filepath && m.chunkTitle === src.chunkTitle);
                        return {
                            filepath: src.filepath,
                            chunkTitle: src.chunkTitle,
                            githubUrl: match?.githubUrl,
                            finalUrl: src.url || match?.githubUrl || src.filepath,
                            entityType: match?.entityType,
                            startLine: match?.startLine,
                            endLine: match?.endLine,
                        };
                    }));
                }
            }
        }

        return { stream: textStreamGenerator(), sources: collectedSources };
    }

    // Non-streaming mode
    const result = await llm.chat.generateAnswer({
        prompt: trimmedQuestion,
        context: matches,
        systemPrompt: options.systemPrompt,
        stream: false,
        signal: options.signal,
    } as GenerateAnswerOptions & { stream?: false });

    // Map sources from matches to include entity metadata
    const sources: AskAiSource[] = result.sources.map((src) => {
        // Find matching chunk by filepath and chunkTitle
        const match = matches.find(m => m.filepath === src.filepath && m.chunkTitle === src.chunkTitle);
        return {
            filepath: src.filepath,
            chunkTitle: src.chunkTitle,
            githubUrl: match?.githubUrl,
            finalUrl: src.url || match?.githubUrl || src.filepath,
            entityType: match?.entityType,
            startLine: match?.startLine,
            endLine: match?.endLine,
        };
    });

    activeLogger.info({ answer: result.answer, sourcesCount: sources.length }, "Answer generated from code context.");

    return { answer: result.answer, sources };
}

