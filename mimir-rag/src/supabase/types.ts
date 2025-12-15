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
    sourceType?: 'mdx' | 'typescript' | 'python';
    entityType?: string;
    startLine?: number;
    endLine?: number;
    createdAt?: string;
    updatedAt?: string;
}

export interface RetrievedChunk extends DocumentChunk {
    similarity?: number;
    bm25Rank?: number;
}
