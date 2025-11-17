import { Buffer } from "node:buffer";
import { extractTitle } from "../utils/extractTitle";
import { calculateChecksum } from "../utils/calculateChecksum";
import { countTokens, getEncoder } from "../utils/tokenEncoder";

export interface MdxChunk {
    chunkTitle: string;
    chunkContent: string;
    checksum: string;
}

export function chunkMdxFile(mdxFileContent: string): MdxChunk[] {
    const lines = mdxFileContent.split(/\r?\n/);
    const chunks: MdxChunk[] = []
    let currentChunk = { heading: "", lines: [] as string[], hasContent: false };

    const flushChunk = () => {
        if(!currentChunk.hasContent) return;
        const lines = currentChunk.lines.join("\n");
        chunks.push({
            chunkTitle: currentChunk.heading,
            chunkContent: lines,
            checksum: calculateChecksum(lines)
        })
        currentChunk = { heading: "", lines: [], hasContent: false };
    }

    for(const line of lines) {
        const trimmed = line.trim();
        const isHeading = trimmed.startsWith("#") && !trimmed.endsWith("[!toc]");
        const isFrontmatterTitle = trimmed.startsWith("title");

        if(isHeading) {
            flushChunk();
            currentChunk.heading = extractTitle(trimmed);
            currentChunk.lines.push(trimmed);
        } else if(isFrontmatterTitle) {
            currentChunk.heading = extractTitle(trimmed, { isFrontmatter: true })
            currentChunk.lines.push(trimmed);
        } else {
            currentChunk.lines.push(trimmed);
            if(trimmed && !currentChunk.hasContent) currentChunk.hasContent = true;
        }
    }
    flushChunk();

    return chunks;
}

interface ChunkTokenLimitOptions {
    tokenLimit: number;
    model?: string;
}

interface SplitChunkOptions {
    tokenLimit: number;
    model?: string;
    newlineTokens: number;
}

export function enforceChunkTokenLimit(chunks: MdxChunk[], options: ChunkTokenLimitOptions): MdxChunk[] {
    const limit = Math.floor(options.tokenLimit);
    if (!Number.isFinite(limit) || limit <= 0) {
        return chunks;
    }

    const newlineTokens = countTokens("\n", options.model);
    const sizedChunks: MdxChunk[] = [];

    for (const chunk of chunks) {
        const totalTokens = countTokens(chunk.chunkContent, options.model);
        if (totalTokens <= limit) {
            sizedChunks.push(chunk);
            continue;
        }

        const parts = splitChunkContent(chunk.chunkContent, {
            tokenLimit: limit,
            model: options.model,
            newlineTokens,
        });

        parts.forEach((content, index) => {
            sizedChunks.push({
                chunkTitle: buildChunkTitle(chunk.chunkTitle, index),
                chunkContent: content,
                checksum: calculateChecksum(content),
            });
        });
    }

    return sizedChunks;
}

function buildChunkTitle(baseTitle: string, index: number): string {
    const safeTitle = baseTitle?.trim() || "chunk";
    return `${safeTitle}_${index + 1}`;
}

function splitChunkContent(content: string, options: SplitChunkOptions): string[] {
    const { tokenLimit, model, newlineTokens } = options;
    const lines = content.split("\n");
    const parts: string[] = [];
    let currentLines: string[] = [];
    let currentTokens = 0;

    const flush = () => {
        if (currentLines.length === 0) {
            return;
        }
        const joined = currentLines.join("\n");
        if (joined.trim().length > 0) {
            parts.push(joined);
        }
        currentLines = [];
        currentTokens = 0;
    };

    for (const rawLine of lines) {
        const line = rawLine;
        const lineTokens = countTokens(line, model);

        if (lineTokens > tokenLimit) {
            flush();
            const oversizedPieces = hardSplitByTokens(line, tokenLimit, model);
            parts.push(...oversizedPieces);
            continue;
        }

        if (currentLines.length === 0 && line.trim().length === 0) {
            continue;
        }

        let additionalTokens = lineTokens + (currentLines.length === 0 ? 0 : newlineTokens);
        if (currentLines.length > 0 && currentTokens + additionalTokens > tokenLimit) {
            flush();
            additionalTokens = lineTokens;
        }

        currentLines.push(line);
        currentTokens += lineTokens + (currentLines.length === 1 ? 0 : newlineTokens);
    }

    flush();

    if (parts.length === 0) {
        return [content];
    }

    return parts;
}

function hardSplitByTokens(text: string, tokenLimit: number, model?: string): string[] {
    const encoder = getEncoder(model);
    const tokens = encoder.encode(text);
    const limit = Math.max(1, tokenLimit);

    if (tokens.length === 0) {
        return [];
    }

    const pieces: string[] = [];
    for (let start = 0; start < tokens.length; start += limit) {
        const slice = tokens.slice(start, Math.min(tokens.length, start + limit));
        const decodedBytes = encoder.decode(slice);
        const decodedText = Buffer.from(decodedBytes).toString("utf8");
        if (decodedText.trim().length > 0) {
            pieces.push(decodedText);
        }
    }

    return pieces;
}
