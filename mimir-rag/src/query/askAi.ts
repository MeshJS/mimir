import type { AppConfig } from "../config/types";
import type { LLMClientBundle } from "../llm/types";
import type { SupabaseVectorStore } from "../supabase/client";
import type { RetrievedChunk } from "../supabase/types";
import type { Logger } from "pino";
import { getLogger } from "../utils/logger";

export interface AskAiOptions {
    question: string;
    matchCount?: number;
    similarityThreshold?: number;
    bm25MatchCount?: number;
    enableHybridSearch?: boolean;
    systemPrompt?: string;
    stream?: boolean;
    signal?: AbortSignal;
}

export interface AskAiSource {
    filepath: string;
    chunkTitle: string;
    githubUrl?: string;
    docsUrl?: string;
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

function buildSourcesFromChunks(chunks: RetrievedChunk[]): AskAiSource[] {
    return chunks.map((chunk) => {
        const {
            filepath,
            chunkTitle,
            githubUrl,
            docsUrl,
            finalUrl,
            sourceType,
            entityType,
            startLine,
            endLine,
        } = chunk;

        const isDocFile =
            sourceType === "doc" ||
            sourceType === "mdx" ||
            /\.(md|mdx)$/i.test(filepath);

        const hasLineInfo =
            typeof startLine === "number" &&
            typeof endLine === "number";

        let effectiveGithubUrl = githubUrl;
        let effectiveDocsUrl = docsUrl;
        let effectiveFinalUrl = finalUrl ?? docsUrl ?? githubUrl ?? filepath;

        if (!isDocFile && effectiveGithubUrl && hasLineInfo) {
            // Build a line-anchored GitHub URL for code entities
            // Strip any existing anchor (slug) from githubUrl before appending line anchor
            const baseUrl = effectiveGithubUrl.split('#')[0];
            const anchor =
                startLine === endLine
                    ? `#L${startLine}`
                    : `#L${startLine}-L${endLine}`;
            effectiveFinalUrl = `${baseUrl}${anchor}`;
        } else if (isDocFile && effectiveDocsUrl) {
            // For docs, prefer the hosted docs URL
            effectiveFinalUrl = effectiveDocsUrl;
        }

        return {
            filepath,
            chunkTitle,
            githubUrl: effectiveGithubUrl,
            docsUrl: effectiveDocsUrl,
            finalUrl: effectiveFinalUrl,
            entityType,
            startLine,
            endLine,
        };
    });
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

    const vectorMatches = await store.matchDocuments(queryEmbedding, {
        matchCount: desiredMatchCount,
        similarityThreshold,
    });

    let keywordMatches: RetrievedChunk[] = [];
    const hybridConfigEnabled = supabaseConfig?.enableHybridSearch ?? true;
    const shouldUseHybrid = options.enableHybridSearch ?? hybridConfigEnabled;

    if (shouldUseHybrid) {
        const bm25MatchCount = options.bm25MatchCount ?? supabaseConfig?.bm25MatchCount ?? desiredMatchCount;
        try {
            keywordMatches = await store.searchDocumentsFullText(trimmedQuestion, {
                matchCount: bm25MatchCount,
            });
        } catch (error) {
            activeLogger.error(
                { err: error },
                "BM25 search failed; continuing with vector results only."
            );
        }
    }

    const matches = mergeAndRankMatches(vectorMatches, keywordMatches, desiredMatchCount);

    if (matches.length === 0) {
        activeLogger.warn("No similar chunks found for query.");
        return {
            answer: "I could not find relevant context to answer that question.",
            sources: [],
        };
    }

    activeLogger.info({ matchCount: matches.length }, "Generating answer with retrieved context.");

    if (options.stream) {
        // Streaming mode
        const resultStream = await llm.chat.generateAnswer({
            prompt: trimmedQuestion,
            context: matches,
            systemPrompt: options.systemPrompt,
            stream: true,
            signal: options.signal,
        });

        // Convert structured stream to text stream and collect sources
        // partialObjectStream sends cumulative updates, so we need to track what we've sent
        let previousAnswer = "";
        const collectedSources: AskAiSource[] = [];

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
                    // Replace any model-reported sources with canonical ones derived from retrieved chunks.
                    collectedSources.length = 0;
                    collectedSources.push(
                        ...buildSourcesFromChunks(matches)
                    );
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
    });

    // Build canonical sources directly from retrieved chunks (DB state),
    // instead of recomputing links from config at query time.
    const sources: AskAiSource[] = buildSourcesFromChunks(matches);

    activeLogger.info({ answer: result.answer, sourcesCount: sources.length }, "answer from the AI");

    return { answer: result.answer, sources };
}

function mergeAndRankMatches(
    vectorMatches: RetrievedChunk[],
    keywordMatches: RetrievedChunk[],
    desiredCount: number
): RetrievedChunk[] {
    const keyFor = (chunk: RetrievedChunk): string => `${chunk.filepath}:${chunk.chunkId}`;
    const combined = new Map<string, RetrievedChunk>();
    const vectorOrder = new Map<string, number>();
    const keywordOrder = new Map<string, number>();

    vectorMatches.forEach((match, index) => {
        const key = keyFor(match);
        combined.set(key, match);
        vectorOrder.set(key, index);
    });

    keywordMatches.forEach((match, index) => {
        const key = keyFor(match);
        const existing = combined.get(key);
        if (existing) {
            existing.bm25Rank = match.bm25Rank ?? existing.bm25Rank;
        } else {
            combined.set(key, match);
        }
        keywordOrder.set(key, index);
    });

    const rankValue = (value?: number): number => (typeof value === "number" ? value : Number.NEGATIVE_INFINITY);

    const merged = Array.from(combined.values());
    merged.sort((a, b) => {
        const similarityDiff = rankValue(b.similarity) - rankValue(a.similarity);
        if (similarityDiff !== 0) {
            return similarityDiff;
        }

        const bm25Diff = rankValue(b.bm25Rank) - rankValue(a.bm25Rank);
        if (bm25Diff !== 0) {
            return bm25Diff;
        }

        const vectorRankDiff =
            (vectorOrder.get(keyFor(a)) ?? Number.MAX_SAFE_INTEGER) -
            (vectorOrder.get(keyFor(b)) ?? Number.MAX_SAFE_INTEGER);
        if (vectorRankDiff !== 0) {
            return vectorRankDiff;
        }

        return (keywordOrder.get(keyFor(a)) ?? Number.MAX_SAFE_INTEGER) -
            (keywordOrder.get(keyFor(b)) ?? Number.MAX_SAFE_INTEGER);
    });

    return merged.slice(0, desiredCount);
}