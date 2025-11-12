export interface DocumentChunk {
    content: string;
    contextualText: string;
    embedding: number[];
    filepath: string;
    chunkId: number;
    chunkTitle: string;
    checksum: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface RetrievedChunk extends DocumentChunk {
    similarity: number;
}