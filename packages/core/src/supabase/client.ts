import { AppConfig, SupabaseConfig } from "../config/types";
import { Logger } from "pino";
import { createClient } from "@supabase/supabase-js";
import type { DocumentChunk, RetrievedChunk } from "./types";
import { getLogger } from "../utils/logger";

interface SupabaseDocRow {
    id: number;
    content: string;
    contextual_text: string;
    embedding: number[];
    filepath: string;
    chunk_id: number;
    chunk_title: string;
    checksum: string;
    similarity: number;
}

interface ExistingChunkInfo {
    id: number;
    checksum: string;
}

export class SupabaseVectorStore {
    private readonly logger: Logger;

    constructor(private readonly config: SupabaseConfig) {
        this.logger = getLogger();
    }

    private readonly client = createClient(this.config.url, this.config.serviceRoleKey, {
        auth: {
            persistSession: false,
        },
        global: {
            headers: {
                "X-Client-Info": "rag-core/1.0.0"
            },
        },
    });

    async verifyConnection(): Promise<void> {
        const { error } = await this.client.from(this.config.table).select("id").limit(1);

        if(error && error.code !== "PGRST116") {
            this.logger.error(`Failed to connect to Supabase table "${this.config.table}": ${error.message}`);
            throw new Error(`Failed to connect to Supabase table "${this.config.table}": ${error.message}`);
        }

        this.logger.info(`Connected to the table "${this.config.table}"`)
    }

    async fetchExistingChunks(filepath: string): Promise<Map<number, ExistingChunkInfo>> {
        const { data, error } = await this.client
            .from(this.config.table)
            .select("id, chunk_id, checksum")
            .eq("filepath", filepath);
        
        if(error) {
            this.logger.error(`Failed to fetch existing chunks for ${filepath}: ${error.message}`);
            throw new Error(`Failed to fetch existing chunks for ${filepath}: ${error.message}`);
        }
        
        const map = new Map<number, ExistingChunkInfo>();
        (data ?? []).forEach((row) => {
            map.set(row.chunk_id, {
                id: row.id, checksum: row.checksum
            });
        });

        return map;
    }

    async upsertChunks(chunks: DocumentChunk[]): Promise<void> {
        const payload = chunks.map((chunk) => ({
            content: chunk.content,
            contextual_text: chunk.contextualText,
            embedding: chunk.embedding,
            filepath: chunk.filepath,
            chunk_id: chunk.chunkId,
            chunk_title: chunk.chunkTitle,
            checksum: chunk.checksum
        }));

        const { error } = await this.client
            .from(this.config.table)
            .upsert(payload, { onConflict: "filepath, chunk_id" }); // update if row with filepath with chunkId exists else insert

        if(error) {
            this.logger.error(`Failed to upsert chunks: ${error.message}`);
            throw new Error(`Failed to upsert chunks: ${error.message}`);
        }

        this.logger.info(`Upsert chunks successful`);
    }

    async deleteMissingChunks(filepath: string, validChunkIds: number[]): Promise<void> {
        if(validChunkIds.length === 0) {
            const { error } = await this.client
                .from(this.config.table)
                .delete()
                .eq("filepath", filepath);
            
            if(error) {
                this.logger.error(`Failed to delete chunks for ${filepath}: ${error.message}`);
                throw new Error(`Failed to delete chunks for ${filepath}: ${error.message}`);
            }
        }

        const { error } = await this.client
            .from(this.config.table)
            .delete()
            .eq("filepath", filepath)
            .not("chunk_id", "in", `${validChunkIds.join(",")}`);

        if(error) {
            this.logger.error(`Failed to delete stale chunks for ${filepath}: ${error.message}`);
            throw new Error(`Failed to delete stale chunks for ${filepath}: ${error.message}`);
        }

        this.logger.info(`Successfully deleted missing chunks from ${filepath}`);
    }

    async matchDocuments(
        embedding: number[],
        options?: { matchCount?: number, similarityThreshold?: number }
    ): Promise<RetrievedChunk[]> {
        const matchCount = options?.matchCount ?? this.config.matchCount;
        const similarityThreshold = options?.similarityThreshold ?? this.config.similarityThreshold;

        const { data, error } = await this.client.rpc("match_docs", {
            query_embedding: embedding,
            match_count: matchCount,
            similarity_threshold: similarityThreshold,
        });

        if(error) {
            this.logger.error(`Failed to execute match_docs RPC: ${error.message}`);
            throw new Error(`Failed to execute match_docs RPC: ${error.message}`);
        }

        return ((data ?? []) as SupabaseDocRow[]).map((row) => ({
            content: row.content,
            contextualText: row.contextual_text,
            embedding: row.embedding,
            chunkId: row.chunk_id,
            chunkTitle: row.chunk_title,
            filepath: row.filepath,
            checksum: row.checksum,
            similarity: row.similarity
        }));
    }

}

export function createSupabaseStore(config: AppConfig): SupabaseVectorStore {
    return new SupabaseVectorStore(config.supabase);
}