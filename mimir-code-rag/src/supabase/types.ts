import type { EntityType } from "../ingest/astParser";

export interface DocumentChunk {
    /** The code content */
    content: string;
    /** Contextual text (context header + code) */
    contextualText: string;
    /** Embedding vector */
    embedding: number[];
    /** Source file path */
    filepath: string;
    /** Chunk index within file */
    chunkId: number;
    /** Qualified entity name */
    chunkTitle: string;
    /** SHA-256 checksum of the code */
    checksum: string;
    /** Type of entity */
    entityType: EntityType;
    /** GitHub URL to source */
    githubUrl?: string;
    /** Start line in source file */
    startLine?: number;
    /** End line in source file */
    endLine?: number;
    /** Created timestamp */
    createdAt?: string;
    /** Updated timestamp */
    updatedAt?: string;
}

export interface RetrievedChunk extends DocumentChunk {
    /** Database ID */
    id: number;
    /** Similarity score from vector search */
    similarity?: number;
}

