import { AppConfig, SupabaseConfig } from "../config/types";
import { Logger } from "pino";
import { createClient } from "@supabase/supabase-js";
import type { DocumentChunk, RetrievedChunk } from "./types";
import { getLogger } from "../utils/logger";
import type { EntityType } from "../ingest/astParser";

interface SupabaseDocRow {
    id: number;
    content: string;
    contextual_text: string;
    embedding: number[];
    filepath: string;
    chunk_id: number;
    chunk_title: string;
    checksum: string;
    entity_type: string;
    github_url?: string;
    start_line?: number;
    end_line?: number;
    similarity?: number;
}

export interface ExistingChunkInfo {
    id: number;
    checksum: string;
    filepath: string;
    chunkId: number;
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
                    "X-Client-Info": "mimir-code-rag/1.0.0",
                },
            },
        });
    }

    async verifyConnection(): Promise<void> {
        const { error } = await this.client.from(this.config.table).select("id").limit(1);

        if (error && error.code !== "PGRST116") {
            this.logger.error(
                `Failed to connect to Supabase table "${this.config.table}": ${error.message}`
            );
            throw new Error(
                `Failed to connect to Supabase table "${this.config.table}": ${error.message}`
            );
        }

        this.logger.info(`Connected to the table "${this.config.table}"`);
    }

    async fetchChunksByChecksums(checksums: string[]): Promise<Map<string, ExistingChunkInfo[]>> {
        if (checksums.length === 0) {
            return new Map();
        }

        const map = new Map<string, ExistingChunkInfo[]>();

        // Supabase/PostgREST has URL length limits. SHA-256 checksums are 64 chars each,
        // so we use a small batch size to stay well under the limit.
        const BATCH_SIZE = 50;
        for (let i = 0; i < checksums.length; i += BATCH_SIZE) {
            const batch = checksums.slice(i, i + BATCH_SIZE);

            const { data, error } = await this.client
                .from(this.config.table)
                .select("id, chunk_id, checksum, filepath")
                .in("checksum", batch);

            if (error) {
                this.logger.error(
                    { err: error, batchSize: batch.length },
                    `Failed to fetch chunks by checksums: ${error.message}`
                );
                throw new Error(`Failed to fetch chunks by checksums: ${error.message}`);
            }

            (data ?? []).forEach((row) => {
                const info: ExistingChunkInfo = {
                    id: row.id,
                    checksum: row.checksum,
                    filepath: row.filepath,
                    chunkId: row.chunk_id,
                };
                const existing = map.get(row.checksum);
                if (existing) {
                    existing.push(info);
                } else {
                    map.set(row.checksum, [info]);
                }
            });
        }

        return map;
    }

    async upsertChunks(chunks: DocumentChunk[]): Promise<void> {
        if (chunks.length === 0) {
            return;
        }

        const payload = chunks.map((chunk) => ({
            content: chunk.content,
            contextual_text: chunk.contextualText,
            embedding: chunk.embedding,
            filepath: chunk.filepath,
            chunk_id: chunk.chunkId,
            chunk_title: chunk.chunkTitle,
            checksum: chunk.checksum,
            entity_type: chunk.entityType,
            github_url: chunk.githubUrl,
            start_line: chunk.startLine,
            end_line: chunk.endLine,
        }));

        const { error } = await this.client
            .from(this.config.table)
            .upsert(payload, { onConflict: "filepath, chunk_id" });

        if (error) {
            this.logger.error(`Failed to upsert chunks: ${error.message}`);
            throw new Error(`Failed to upsert chunks: ${error.message}`);
        }

        this.logger.info(`Upserted ${chunks.length} chunk${chunks.length === 1 ? "" : "s"}`);
    }

    async deleteChunksByIds(ids: number[]): Promise<void> {
        if (ids.length === 0) {
            return;
        }

        const { error } = await this.client.from(this.config.table).delete().in("id", ids);

        if (error) {
            this.logger.error(`Failed to delete chunks by id: ${error.message}`);
            throw new Error(`Failed to delete chunks by id: ${error.message}`);
        }

        this.logger.info(`Deleted ${ids.length} chunk${ids.length === 1 ? "" : "s"} by id.`);
    }

    async moveChunksAtomic(
        moves: Array<{ id: number; filepath: string; chunkId: number }>
    ): Promise<void> {
        if (moves.length === 0) {
            return;
        }

        // Phase 1: Move all chunks to temporary filepaths to avoid unique constraint conflicts
        for (const move of moves) {
            const tempFilepath = `__moving__${move.id}`;
            const { error } = await this.client
                .from(this.config.table)
                .update({ filepath: tempFilepath, chunk_id: move.chunkId })
                .eq("id", move.id);

            if (error) {
                this.logger.error(
                    `Failed to move chunk ${move.id} to temp filepath: ${error.message}`
                );
                throw new Error(`Failed to move chunk to temp filepath: ${error.message}`);
            }
        }

        // Phase 2: Move all chunks to their final filepaths
        for (const move of moves) {
            const { error } = await this.client
                .from(this.config.table)
                .update({ filepath: move.filepath })
                .eq("id", move.id);

            if (error) {
                this.logger.error(
                    `Failed to move chunk ${move.id} to final filepath: ${error.message}`
                );
                throw new Error(`Failed to move chunk to final filepath: ${error.message}`);
            }
        }

        this.logger.info(`Moved ${moves.length} chunk${moves.length === 1 ? "" : "s"} to new locations.`);
    }

    async findOrphanedChunkIds(activeChecksums: Set<string>): Promise<number[]> {
        if (activeChecksums.size === 0) {
            // If no active checksums, all chunks are orphaned
            const { data, error } = await this.client.from(this.config.table).select("id");

            if (error) {
                this.logger.error(`Failed to fetch all chunk ids: ${error.message}`);
                throw new Error(`Failed to fetch all chunk ids: ${error.message}`);
            }

            return (data ?? []).map((row) => row.id);
        }

        // Fetch all chunks and filter out those with active checksums
        const { data, error } = await this.client
            .from(this.config.table)
            .select("id, checksum");

        if (error) {
            this.logger.error(`Failed to fetch chunks for orphan detection: ${error.message}`);
            throw new Error(`Failed to fetch chunks for orphan detection: ${error.message}`);
        }

        const orphanedIds: number[] = [];
        (data ?? []).forEach((row) => {
            if (!activeChecksums.has(row.checksum)) {
                orphanedIds.push(row.id);
            }
        });

        return orphanedIds;
    }

    async matchDocuments(
        embedding: number[],
        options?: { matchCount?: number; similarityThreshold?: number }
    ): Promise<RetrievedChunk[]> {
        const matchCount = options?.matchCount ?? this.config.matchCount;
        const similarityThreshold = options?.similarityThreshold ?? this.config.similarityThreshold;

        const { data, error } = await this.client.rpc("match_code", {
            query_embedding: embedding,
            match_count: matchCount,
            similarity_threshold: similarityThreshold,
        });

        if (error) {
            this.logger.error(`Failed to execute match_code RPC: ${error.message}`);
            throw new Error(`Failed to execute match_code RPC: ${error.message}`);
        }

        return ((data ?? []) as SupabaseDocRow[]).map((row) => ({
            id: row.id,
            content: row.content,
            contextualText: row.contextual_text,
            embedding: row.embedding,
            chunkId: row.chunk_id,
            chunkTitle: row.chunk_title,
            filepath: row.filepath,
            checksum: row.checksum,
            entityType: row.entity_type as EntityType,
            githubUrl: row.github_url ?? undefined,
            startLine: row.start_line ?? undefined,
            endLine: row.end_line ?? undefined,
            similarity: row.similarity,
        }));
    }
}

export function createSupabaseStore(config: AppConfig): SupabaseVectorStore {
    return new SupabaseVectorStore(config.supabase);
}

