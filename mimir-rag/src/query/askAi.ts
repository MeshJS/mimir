import type { AppConfig } from "../config/types";
import type { LLMClientBundle } from "../llm/types";
import type { SupabaseVectorStore } from "../supabase/client";
import type { RetrievedChunk } from "../supabase/types";
import type { Logger } from "pino";
import { getLogger } from "../utils/logger";
import { sanitizeSourceTitle } from "../utils/sourceLinks";

export interface AskAiOptions {
    question: string;
    matchCount?: number;
    similarityThreshold?: number;
    bm25MatchCount?: number;
    enableHybridSearch?: boolean;
    systemPrompt?: string;
    onToken?: (chunk: string) => void;
    signal?: AbortSignal;
}

export interface AskAiSource {
    filepath: string;
    chunkTitle: string;
    githubUrl?: string;
    docsUrl?: string;
    finalUrl: string;
}

export interface AskAiResult {
    answer: string;
    sources: AskAiSource[];
}

interface AskAiContextOptions {
    logger?: Logger;
    config?: AppConfig;
}

export async function askAi(
    llm: LLMClientBundle,
    store: SupabaseVectorStore,
    options: AskAiOptions,
    context?: AskAiContextOptions
): Promise<AskAiResult> {
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

    let answer: string;
    if (options.onToken) {
        // Streaming mode
        const stream = await llm.chat.generateAnswer({
            prompt: trimmedQuestion,
            context: matches,
            systemPrompt: options.systemPrompt,
            stream: true,
            signal: options.signal,
        });

        let fullText = "";
        for await (const chunk of stream) {
            fullText += chunk;
            options.onToken(chunk);
        }
        answer = fullText.trim();
    } else {
        // Non-streaming mode
        answer = await llm.chat.generateAnswer({
            prompt: trimmedQuestion,
            context: matches,
            systemPrompt: options.systemPrompt,
            stream: false,
            signal: options.signal,
        });
    }

    const citedIndexes = extractUsedSourceIndexes(answer);
    let citedMatches = selectMatchesByIndexes(matches, citedIndexes);
    if (citedIndexes.length > 0 && citedMatches.length === 0) {
        activeLogger.warn("Model referenced invalid source indexes; falling back to full match set.");
    }

    if (citedMatches.length === 0) {
        citedMatches = matches;
    }

    const sources = dedupeMatches(citedMatches).map((match) => ({
        filepath: match.filepath,
        chunkTitle: sanitizeSourceTitle(match.chunkTitle, match.filepath),
        githubUrl: match.githubUrl ?? undefined,
        docsUrl: match.docsUrl ?? undefined,
        finalUrl: match.finalUrl ?? match.githubUrl ?? match.docsUrl ?? match.filepath,
    }));
    const answerWithSources = appendSourcesSection(answer, sources);
    activeLogger.info({ answer: answerWithSources }, "answer from the AI");

    return { answer: answerWithSources, sources };
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

function dedupeMatches(matches: RetrievedChunk[]): RetrievedChunk[] {
    const seen = new Set<string>();
    const unique: RetrievedChunk[] = [];
    matches.forEach((match) => {
        const key = `${match.filepath}:${match.chunkId}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        unique.push(match);
    });
    return unique;
}

function extractUsedSourceIndexes(answer: string): number[] {
    if (!answer) {
        return [];
    }

    const indexes: number[] = [];
    const seen = new Set<number>();
    const citationRegex = /\[S\s*(\d+)\]/gi;
    let match: RegExpExecArray | null;

    const addIndex = (value?: number) => {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            return;
        }
        const normalized = Math.floor(value);
        if (normalized > 0 && !seen.has(normalized)) {
            seen.add(normalized);
            indexes.push(normalized);
        }
    };

    while ((match = citationRegex.exec(answer)) !== null) {
        addIndex(Number.parseInt(match[1], 10));
    }

    const summaryRegex = /Sources?:\s*([^\n]+)/gi;
    while ((match = summaryRegex.exec(answer)) !== null) {
        const segment = match[1];
        const tokens = segment.match(/S\s*(\d+)/gi) ?? [];
        tokens.forEach((token) => {
            const value = token.match(/\d+/);
            if (value) {
                addIndex(Number.parseInt(value[0], 10));
            }
        });
    }

    return indexes;
}

function selectMatchesByIndexes(matches: RetrievedChunk[], indexes: number[]): RetrievedChunk[] {
    if (indexes.length === 0) {
        return [];
    }

    const selected: RetrievedChunk[] = [];
    const seenKeys = new Set<string>();

    indexes.forEach((index) => {
        const pointer = index - 1;
        if (pointer < 0 || pointer >= matches.length) {
            return;
        }
        const candidate = matches[pointer];
        const key = `${candidate.filepath}:${candidate.chunkId}`;
        if (!seenKeys.has(key)) {
            seenKeys.add(key);
            selected.push(candidate);
        }
    });

    return selected;
}

function appendSourcesSection(answer: string, sources: AskAiSource[]): string {
    if (!sources.length) {
        return answer;
    }

    const SOURCE_TRAILER_REGEX = /(?:\r?\n)*Sources?:\s*(?:S\d+(?:\s*,\s*S\d+)*)\s*$/i;
    let sanitizedAnswer = answer?.trimEnd() ?? "";
    sanitizedAnswer = sanitizedAnswer.replace(SOURCE_TRAILER_REGEX, "").trimEnd();

    const lines = sources.map((source, index) => {
        const label = sanitizeSourceTitle(source.chunkTitle, source.filepath) || `Source ${index + 1}`;
        const href = source.finalUrl || source.githubUrl || source.docsUrl || source.filepath;

        if (href) {
            return `- [${label}](${href})`;
        }
        return `- ${label}`;
    });

    const section = ["", "Sources:", ...lines].join("\n");
    return `${sanitizedAnswer}${section}`;
}
