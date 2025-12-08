import type { ChatModelConfig, EmbeddingModelConfig } from "../config/types";
import type { EntityChunk, FlattenedChunk } from "../ingest/entityChunker";
import type { EntityType } from "../ingest/astParser";

export interface EmbedOptions {
    batchSize?: number;
    signal?: AbortSignal;
}

export interface EntityContextInput {
    /** The code content of the entity */
    entityCode: string;
    /** Type of the entity (function, class, etc.) */
    entityType: EntityType;
    /** Name of the entity */
    entityName: string;
    /** Full file content for context */
    fullFileContent: string;
    /** Parent class/interface if nested */
    parentContext?: string;
    /** File imports for understanding dependencies */
    imports?: string[];
    /** JSDoc if available */
    jsDoc?: string;
}

export interface GenerateContextOptions {
    entities: EntityContextInput[];
    signal?: AbortSignal;
}

export interface EmbeddingProvider {
    readonly config: EmbeddingModelConfig;
    embedDocuments(chunks: string[], options?: EmbedOptions): Promise<number[][]>;
    embedQuery(query: string, options?: EmbedOptions): Promise<number[]>;
}

export interface ChatProvider {
    readonly config: ChatModelConfig;
    generateEntityContexts(entities: EntityContextInput[], fileContent: string): Promise<string[]>;
}

export interface LLMClientBundle {
    embedding: EmbeddingProvider;
    chat: ChatProvider;
}

