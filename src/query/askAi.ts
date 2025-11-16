import type { AppConfig } from "../config/types";
import {
    DEFAULT_BRANCH,
    buildSourceUrl,
    joinRepoPaths,
    parseGithubUrl,
} from "../github/utils";
import type { LLMClientBundle } from "../llm/types";
import type { SupabaseVectorStore } from "../supabase/client";
import type { Logger } from "pino";
import { getLogger } from "../utils/logger";
import { slugifyHeading } from "../utils/slugify";

export interface AskAiOptions {
    question: string;
    matchCount?: number;
    similarityThreshold?: number;
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

    if (!trimmedQuestion) {
        throw new Error("Question cannot be empty.");
    }

    activeLogger.info({ question: trimmedQuestion }, "Embedding query.");
    const queryEmbedding = await llm.embedding.embedQuery(trimmedQuestion, { signal: options.signal });

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

    const sources: AskAiSource[] = matches.map((match) => {
        const { githubUrl, docsUrl, baseUrl } = resolveSourceLinks(match.filepath, context?.config);
        const slug = slugifyHeading(match.chunkTitle);

        let finalUrl = baseUrl;
        if (finalUrl && slug) {
            finalUrl = `${finalUrl}#${slug}`;
        }

        if (!finalUrl) {
            finalUrl = githubUrl ?? docsUrl ?? match.filepath;
        }

        return {
            filepath: match.filepath,
            chunkTitle: match.chunkTitle,
            githubUrl,
            docsUrl,
            finalUrl,
        };
    });

    activeLogger.info({ matchCount: matches.length }, "Generating answer with retrieved context.");

    const answer = await llm.chat.generateAnswer({
        prompt: trimmedQuestion,
        context: matches,
        systemPrompt: options.systemPrompt,
        onToken: options.onToken,
        signal: options.signal,
    });

    activeLogger.info({ answer }, "answer from the AI");

    return { answer, sources };
}

function resolveSourceLinks(
    filepath: string,
    config?: AppConfig
): { githubUrl?: string; docsUrl?: string; baseUrl?: string } {
    const githubUrl = computeGithubUrl(filepath, config);
    const docsUrl = computeDocsUrl(filepath, config);

    return {
        githubUrl,
        docsUrl,
        baseUrl: docsUrl ?? githubUrl,
    };
}

function computeGithubUrl(filepath: string, config?: AppConfig): string | undefined {
    const githubConfig = config?.github;
    if (!githubConfig?.githubUrl) {
        return undefined;
    }

    try {
        const parsed = parseGithubUrl(githubConfig.githubUrl);
        const branch = githubConfig.branch ?? parsed.branch ?? DEFAULT_BRANCH;
        const scopedPath = joinRepoPaths(parsed.path, githubConfig.directory);
        const repoPath = joinRepoPaths(scopedPath, filepath);
        return buildSourceUrl(parsed.owner, parsed.repo, branch, repoPath);
    } catch {
        return undefined;
    }
}

function computeDocsUrl(filepath: string, config?: AppConfig): string | undefined {
    const docsConfig = config?.docs;
    const baseUrl = docsConfig?.baseUrl;

    if (!baseUrl) {
        return undefined;
    }

    if (!/\.(md|mdx)$/i.test(filepath)) {
        return undefined;
    }

    const contentPrefix = docsConfig.contentPath ?? "content/docs";
    let relativePath = filepath;

    if (relativePath.startsWith(`${contentPrefix}/`)) {
        relativePath = relativePath.slice(contentPrefix.length + 1);
    }

    relativePath = relativePath.replace(/\.(md|mdx)$/i, "");

    if (relativePath.endsWith("/index")) {
        relativePath = relativePath.slice(0, -"/index".length);
    }

    const normalizedBase =
        baseUrl === ""
            ? ""
            : baseUrl.endsWith("/")
            ? baseUrl.slice(0, -1)
            : baseUrl;

    if (!relativePath) {
        return normalizedBase || "/";
    }

    const encodedRelative = relativePath
        .split("/")
        .filter((segment) => segment.length > 0)
        .map((segment) => encodeURIComponent(segment))
        .join("/");

    if (!normalizedBase) {
        return `/${encodedRelative}`;
    }

    return `${normalizedBase}/${encodedRelative}`;
}
