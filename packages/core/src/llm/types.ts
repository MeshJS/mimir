import type { DocumentChunk } from "../supabase/types";
import type { ChatModelConfig, LLMModelConfig } from "../config/types";

export interface EmbedOptions {
    batchSize?: number;
    signal?: AbortSignal;
}

export type contextualChunkInput = {
    chunkContent: string;
    fileContent: string;
}

export interface GenerateAnswerOptions {
    prompt: string;
    context: DocumentChunk[] | contextualChunkInput;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    systemPrompt?: string;
}

export interface EmbeddingProvider {
    readonly config: LLMModelConfig;
    embedDocuments(chunks: string[], options?: EmbedOptions): Promise<number[][]>;
    embedQuery(query: string, options?: EmbedOptions): Promise<number[]>;
}

export interface ChatProvider {
    readonly config: ChatModelConfig;
    generateAnswer(options: GenerateAnswerOptions): Promise<string>;
    generateFileChunkContexts(chunks: string[], fileContent: string): Promise<string[]>;
}

export interface LLMClientBundle {
    embedding: EmbeddingProvider;
    chat: ChatProvider;
}