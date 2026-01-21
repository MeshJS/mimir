import type { DocumentChunk, RetrievedChunk } from "../supabase/types";

export interface PostgresDocRow {
    id: number;
    content: string;
    contextual_text: string;
    embedding: number[];
    filepath: string;
    chunk_id: number;
    chunk_title: string;
    checksum: string;
    github_url?: string;
    docs_url?: string;
    final_url?: string;
    source_type?: string;
    entity_type?: string;
    start_line?: number;
    end_line?: number;
    similarity?: number;
    bm25_rank?: number;
}

export interface ExistingChunkInfo {
    id: number;
    checksum: string;
    filepath: string;
    chunkId: number;
    sourceType?: 'doc' | 'code' | 'mdx' | 'typescript';
}

export type { DocumentChunk, RetrievedChunk };
