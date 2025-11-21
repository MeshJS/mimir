export interface DocumentChunk {
    content: string;
    contextualText: string;
    embedding: number[];
    filepath: string;
    chunkId: number;
    chunkTitle: string;
    checksum: string;
    githubUrl?: string;
    docsUrl?: string;
    finalUrl?: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface RetrievedChunk extends DocumentChunk {
    similarity?: number;
    bm25Rank?: number;
}
