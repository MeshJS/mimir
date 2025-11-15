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

export interface ExistingChunkInfo {
    id: number;
    checksum: string;
}

export class SupabaseVectorStore {
    private readonly logger: Logger;
    private readonly client;
    private readonly config: SupabaseConfig;

    constructor(config: SupabaseConfig) {
        this.config = config;
        this.logger = getLogger();
        this.client = createClient(this.config.url, this.config.serviceRoleKey, {
            auth: {
                persistSession: false,
            },
            global: {
                headers: {
                    "X-Client-Info": "rag-core/1.0.0"
                },
            },
        });
    }

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

            return;
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

    async deleteChunksByIds(ids: number[]): Promise<void> {
        if(ids.length === 0) {
            return;
        }

        const { error } = await this.client
            .from(this.config.table)
            .delete()
            .in("id", ids);

        if(error) {
            this.logger.error(`Failed to delete chunks by id: ${error.message}`);
            throw new Error(`Failed to delete chunks by id: ${error.message}`);
        }

        this.logger.info(`Deleted ${ids.length} chunk${ids.length === 1 ? "" : "s"} by id.`);
    }

    async updateChunkOrders(updates: Array<{ id: number; chunkId: number }>): Promise<void> {
        if(updates.length === 0) {
            return;
        }

        const TEMP_OFFSET = 1_000_000;

        const phaseUpdate = async (applyOffset: boolean) => {
            for(const update of updates) {
                const nextValue = applyOffset ? TEMP_OFFSET + update.id : update.chunkId;
                const { error } = await this.client
                    .from(this.config.table)
                    .update({ chunk_id: nextValue })
                    .eq("id", update.id);

                if(error) {
                    const phase = applyOffset ? "temporary" : "final";
                    this.logger.error(`Failed to apply ${phase} chunk order update: ${error.message}`);
                    throw new Error(`Failed to apply chunk order update: ${error.message}`);
                }
            }
        };

        await phaseUpdate(true);
        await phaseUpdate(false);

        this.logger.info(`Reordered ${updates.length} chunk${updates.length === 1 ? "" : "s"}.`);
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
