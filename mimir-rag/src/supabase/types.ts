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
    /**
     * High-level source classification.
     * - 'doc'  : documentation content (e.g., MD/MDX)
     * - 'code' : source code content (any language)
     *
     * Older rows may still use 'mdx' | 'typescript' | 'python' for backward compatibility.
     */
    sourceType?: 'doc' | 'code' | 'mdx' | 'typescript' | 'python';
    /** Optional language identifier for code/doc chunks (e.g., 'typescript', 'python', 'mdx'). */
    language?: string;
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
