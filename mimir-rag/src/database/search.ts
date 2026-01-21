import type { Pool } from "pg";
import type { Logger } from "pino";
import type { RetrievedChunk, PostgresDocRow } from "./types";

export async function matchDocuments(
    pool: Pool,
    logger: Logger,
    table: string,
    embedding: number[],
    matchCount: number,
    similarityThreshold?: number
): Promise<RetrievedChunk[]> {
    const threshold = similarityThreshold ?? 0.75;
    const embeddingArray = `[${embedding.join(",")}]`;
    const result = await pool.query(
        `SELECT * FROM match_docs($1::vector, $2, $3)`,
        [embeddingArray, matchCount, threshold]
    );

    return result.rows.map((row: PostgresDocRow) => ({
        content: row.content,
        contextualText: row.contextual_text,
        embedding: row.embedding,
        chunkId: row.chunk_id,
        chunkTitle: row.chunk_title,
        filepath: row.filepath,
        checksum: row.checksum,
        githubUrl: row.github_url ?? undefined,
        docsUrl: row.docs_url ?? undefined,
        finalUrl: row.final_url ?? undefined,
        sourceType: (row.source_type as 'doc' | 'code' | 'mdx' | 'typescript' | undefined) ?? 'mdx',
        entityType: row.entity_type ?? undefined,
        startLine: row.start_line ?? undefined,
        endLine: row.end_line ?? undefined,
        similarity: row.similarity,
    }));
}

export async function searchDocumentsFullText(
    pool: Pool,
    logger: Logger,
    table: string,
    query: string,
    matchCount: number
): Promise<RetrievedChunk[]> {
    const result = await pool.query(
        `SELECT * FROM match_docs_bm25($1, $2)`,
        [query, matchCount]
    );

    return result.rows.map((row: PostgresDocRow) => ({
        content: row.content,
        contextualText: row.contextual_text,
        embedding: row.embedding,
        chunkId: row.chunk_id,
        chunkTitle: row.chunk_title,
        filepath: row.filepath,
        checksum: row.checksum,
        githubUrl: row.github_url ?? undefined,
        docsUrl: row.docs_url ?? undefined,
        finalUrl: row.final_url ?? undefined,
        sourceType: (row.source_type as 'doc' | 'code' | 'mdx' | 'typescript' | undefined) ?? 'mdx',
        entityType: row.entity_type ?? undefined,
        startLine: row.start_line ?? undefined,
        endLine: row.end_line ?? undefined,
        bm25Rank: row.bm25_rank,
    }));
}
