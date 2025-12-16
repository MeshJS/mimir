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
    github_url?: string;
    docs_url?: string;
    final_url?: string;
    source_type?: string;
    entity_type?: string;
    start_line?: number;
    end_line?: number;
    similarity?: number;
    bm25_rank?: number;
}

export interface ExistingChunkInfo {
    id: number;
    checksum: string;
    filepath: string;
    chunkId: number;
    /** High-level source classification, plus legacy values for backward compatibility. */
    sourceType?: 'doc' | 'code' | 'mdx' | 'typescript';
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
            .select("id, chunk_id, checksum, filepath")
            .eq("filepath", filepath);
        
        if(error) {
            this.logger.error(`Failed to fetch existing chunks for ${filepath}: ${error.message}`);
            throw new Error(`Failed to fetch existing chunks for ${filepath}: ${error.message}`);
        }
        
        const map = new Map<number, ExistingChunkInfo>();
        (data ?? []).forEach((row) => {
            map.set(row.chunk_id, {
                id: row.id,
                checksum: row.checksum,
                filepath: row.filepath,
                chunkId: row.chunk_id,
            });
        });

        return map;
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
                .select("id, chunk_id, checksum, filepath, source_type")
                .in("checksum", batch);
            
            if (error) {
                this.logger.error({ err: error, batchSize: batch.length }, `Failed to fetch chunks by checksums: ${error.message}`);
                throw new Error(`Failed to fetch chunks by checksums: ${error.message}`);
            }

            (data ?? []).forEach((row) => {
                const info: ExistingChunkInfo = {
                    id: row.id,
                    checksum: row.checksum,
                    filepath: row.filepath,
                    chunkId: row.chunk_id,
                    sourceType: row.source_type as 'doc' | 'code' | 'mdx' | 'typescript' | undefined,
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
        const payload = chunks.map((chunk) => ({
            content: chunk.content,
            contextual_text: chunk.contextualText,
            embedding: chunk.embedding,
            filepath: chunk.filepath,
            chunk_id: chunk.chunkId,
            chunk_title: chunk.chunkTitle,
            checksum: chunk.checksum,
            github_url: chunk.githubUrl,
            docs_url: chunk.docsUrl,
            final_url: chunk.finalUrl,
            source_type: chunk.sourceType ?? 'mdx',
            entity_type: chunk.entityType ?? null,
            start_line: chunk.startLine ?? null,
            end_line: chunk.endLine ?? null,
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

    async moveChunksAtomic(moves: Array<{ id: number; filepath: string; chunkId: number; sourceType?: 'doc' | 'code' | 'mdx' | 'typescript' }>): Promise<void> {
        if (moves.length === 0) {
            return;
        }

        const moveIds = moves.map(m => m.id);

        // Phase 1: Move all chunks to temporary filepaths to avoid unique constraint conflicts
        // Each chunk needs a unique temp filepath, so we must update individually
        // But we can process them in parallel batches for better performance
        const BATCH_SIZE = 50;
        for (let i = 0; i < moves.length; i += BATCH_SIZE) {
            const batch = moves.slice(i, i + BATCH_SIZE);
            await Promise.all(
                batch.map(async (move) => {
                    const tempFilepath = `__moving__${move.id}`;
                    const updateData: any = { filepath: tempFilepath, chunk_id: move.chunkId };
                    if (move.sourceType) {
                        updateData.source_type = move.sourceType;
                    }
                    const { error } = await this.client
                        .from(this.config.table)
                        .update(updateData)
                        .eq("id", move.id);

                    if (error) {
                        this.logger.error(`Failed to move chunk ${move.id} to temp filepath: ${error.message}`);
                        throw new Error(`Failed to move chunk to temp filepath: ${error.message}`);
                    }
                })
            );
        }

        // Phase 2: Move all chunks to their final filepaths
        // IMPORTANT: Only one chunk can occupy each (filepath, chunkId) combination due to unique constraint.
        // If multiple chunks target the same location, only move the first one.
        // The pipeline should prevent this, but we handle it defensively here.
        const movesByTarget = new Map<string, typeof moves>();
        for (const move of moves) {
            // Key includes sourceType to allow same (filepath, chunkId) with different sourceType
            // But the unique constraint is only on (filepath, chunkId), so we need to deduplicate
            const uniqueKey = `${move.filepath}:${move.chunkId}`;
            if (!movesByTarget.has(uniqueKey)) {
                movesByTarget.set(uniqueKey, []);
            }
            movesByTarget.get(uniqueKey)!.push(move);
        }

        let successfullyMoved = 0;
        const strandedChunkIds: number[] = [];

        for (const [uniqueKey, targetMoves] of movesByTarget.entries()) {
            // If multiple chunks target the same (filepath, chunkId), only move the first one
            // This should not happen if the pipeline logic is correct, but we handle it defensively
            if (targetMoves.length > 1) {
                this.logger.warn(
                    `Multiple chunks (${targetMoves.length}) targeting same location ${uniqueKey}. Only moving first chunk.`
                );
                // Track stranded chunks (those that won't be moved)
                for (let i = 1; i < targetMoves.length; i++) {
                    strandedChunkIds.push(targetMoves[i].id);
                }
            }
            
            const move = targetMoves[0]; // Only move the first one
            
            // Check if target location is already occupied by a different chunk
            const { data: existingChunk } = await this.client
                .from(this.config.table)
                .select("id")
                .eq("filepath", move.filepath)
                .eq("chunk_id", move.chunkId)
                .maybeSingle();
            
            if (existingChunk && existingChunk.id !== move.id) {
                // Target location is already occupied by a different chunk
                // This shouldn't happen if pipeline logic is correct, but handle defensively
                this.logger.warn(
                    `Target location ${uniqueKey} already occupied by chunk ${existingChunk.id}. Skipping move for chunk ${move.id}.`
                );
                // Mark this chunk as stranded since it won't be moved
                strandedChunkIds.push(move.id);
                continue;
            }
            
            const updateData: any = { 
                filepath: move.filepath,
                chunk_id: move.chunkId 
            };
            if (move.sourceType) {
                updateData.source_type = move.sourceType;
            }

            const { error } = await this.client
                .from(this.config.table)
                .update(updateData)
                .eq("id", move.id);

            if (error) {
                this.logger.error(`Failed to move chunk ${move.id} to final filepath: ${error.message}`);
                throw new Error(`Failed to move chunk to final filepath: ${error.message}`);
            }
            
            successfullyMoved++;
        }

        // Log the actual number moved, and warn about stranded chunks
        if (strandedChunkIds.length > 0) {
            this.logger.warn(
                `${strandedChunkIds.length} chunk${strandedChunkIds.length === 1 ? "" : "s"} left in temporary locations due to duplicate target locations. This indicates a bug in the pipeline logic.`
            );
        }

        this.logger.info(`Moved ${successfullyMoved} of ${moves.length} chunk${moves.length === 1 ? "" : "s"} to new locations.`);
    }

    async findOrphanedChunkIds(activeChecksums: Set<string>): Promise<number[]> {
        if (activeChecksums.size === 0) {
            // If no active checksums, all chunks are orphaned
            const { data, error } = await this.client
                .from(this.config.table)
                .select("id");

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
            githubUrl: row.github_url ?? undefined,
            docsUrl: row.docs_url ?? undefined,
            finalUrl: row.final_url ?? undefined,
            sourceType: (row.source_type as 'doc' | 'code' | 'mdx' | 'typescript' | undefined) ?? 'mdx',
            entityType: row.entity_type ?? undefined,
            startLine: row.start_line ?? undefined,
            endLine: row.end_line ?? undefined,
            similarity: row.similarity,
        }));
    }

    async searchDocumentsFullText(
        query: string,
        options?: { matchCount?: number }
    ): Promise<RetrievedChunk[]> {
        const matchCount = options?.matchCount ?? this.config.bm25MatchCount ?? this.config.matchCount;

        const { data, error } = await this.client.rpc("match_docs_bm25", {
            query,
            match_count: matchCount,
        });

        if (error) {
            this.logger.error(`Failed to execute match_docs_bm25 RPC: ${error.message}`);
            throw new Error(`Failed to execute match_docs_bm25 RPC: ${error.message}`);
        }

        return ((data ?? []) as SupabaseDocRow[]).map((row) => ({
            content: row.content,
            contextualText: row.contextual_text,
            embedding: row.embedding,
            chunkId: row.chunk_id,
            chunkTitle: row.chunk_title,
            filepath: row.filepath,
            checksum: row.checksum,
            githubUrl: row.github_url ?? undefined,
            docsUrl: row.docs_url ?? undefined,
            finalUrl: row.final_url ?? undefined,
            sourceType: (row.source_type as 'doc' | 'code' | 'mdx' | 'typescript' | undefined) ?? 'mdx',
            entityType: row.entity_type ?? undefined,
            startLine: row.start_line ?? undefined,
            endLine: row.end_line ?? undefined,
            bm25Rank: row.bm25_rank,
        }));
    }

}

export function createSupabaseStore(config: AppConfig): SupabaseVectorStore {
    return new SupabaseVectorStore(config.supabase);
}
