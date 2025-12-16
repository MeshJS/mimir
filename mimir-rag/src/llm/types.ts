import type { DocumentChunk } from "../supabase/types";
import type { ChatModelConfig, EmbeddingModelConfig } from "../config/types";
import type { EntityType } from "../ingest/astParser";

export interface EmbedOptions {
    batchSize?: number;
    signal?: AbortSignal;
}

export type contextualChunkInput = {
    chunkContent: string;
    fileContent: string;
}

export interface EntityContextInput {
    entityCode: string;
    entityType: EntityType;
    entityName: string;
    qualifiedName: string;
    fullFileContent: string;
    parentContext?: string;
    jsDoc?: string;
    imports?: string[];
    parameters?: string;
    returnType?: string;
}

export interface GenerateAnswerOptions {
    prompt: string;
    context: DocumentChunk[] | contextualChunkInput;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    systemPrompt?: string;
    stream?: boolean;
}

export interface SourceReference {
    filepath: string;
    chunkTitle: string;
    url?: string;
}

export interface StructuredAnswerResult {
    answer: string;
    sources: SourceReference[];
}

export interface EmbeddingProvider {
    readonly config: EmbeddingModelConfig;
    embedDocuments(chunks: string[], options?: EmbedOptions): Promise<number[][]>;
    embedQuery(query: string, options?: EmbedOptions): Promise<number[]>;
}

export interface ChatProvider {
    readonly config: ChatModelConfig;
    generateAnswer(options: GenerateAnswerOptions & { stream?: false }): Promise<StructuredAnswerResult>;
    generateAnswer(options: GenerateAnswerOptions & { stream: true }): Promise<AsyncIterable<StructuredAnswerResult>>;
    generateFileChunkContexts(chunks: string[], fileContent: string): Promise<string[]>;
    generateEntityContexts(entities: EntityContextInput[], fileContent: string, filepath?: string): Promise<string[]>;
}

export interface LLMClientBundle {
    embedding: EmbeddingProvider;
    chat: ChatProvider;
}
