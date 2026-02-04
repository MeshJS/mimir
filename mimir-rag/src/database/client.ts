import { Pool } from "pg";
import { Logger } from "pino";
import type { DatabaseConfig } from "../config/types";
import { getLogger } from "../utils/logger";
import type { DocumentChunk, RetrievedChunk, ExistingChunkInfo } from "./types";
import * as chunks from "./chunks";
import * as moves from "./moves";
import * as orphans from "./orphans";
import * as search from "./search";

export class PostgresVectorStore {
    protected readonly logger: Logger;
    protected readonly pool: Pool;
    protected readonly config: DatabaseConfig;

    constructor(config: DatabaseConfig) {
        this.config = config;
        this.logger = getLogger();
        
        this.pool = new Pool({
            connectionString: config.databaseUrl,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        });

        this.pool.on("error", (err) => {
            this.logger.error({ err }, "Unexpected error on idle PostgreSQL client");
        });
    }

    async verifyConnection(): Promise<void> {
        try {
            const result = await this.pool.query(
                `SELECT id FROM ${this.config.table} LIMIT 1`
            );
            this.logger.info(`Connected to the table "${this.config.table}"`);
        } catch (error: any) {
            if (error.code === "42P01") {
                this.logger.warn(`Table "${this.config.table}" does not exist yet`);
            } else {
                this.logger.error(
                    { err: error },
                    `Failed to connect to PostgreSQL table "${this.config.table}"`
                );
                throw new Error(
                    `Failed to connect to PostgreSQL table "${this.config.table}": ${error.message}`
                );
            }
        }
    }

    async close(): Promise<void> {
        await this.pool.end();
    }

    async fetchExistingChunks(filepath: string): Promise<Map<number, ExistingChunkInfo>> {
        return chunks.fetchExistingChunks(this.pool, this.logger, this.config.table, filepath);
    }

    async fetchChunksByChecksums(checksums: string[]): Promise<Map<string, ExistingChunkInfo[]>> {
        return chunks.fetchChunksByChecksums(this.pool, this.logger, this.config.table, checksums);
    }

    async upsertChunks(chunksToUpsert: DocumentChunk[]): Promise<void> {
        return chunks.upsertChunks(this.pool, this.logger, this.config.table, chunksToUpsert);
    }

    async deleteMissingChunks(filepath: string, validChunkIds: number[]): Promise<void> {
        return chunks.deleteMissingChunks(this.pool, this.logger, this.config.table, filepath, validChunkIds);
    }

    async deleteChunksByIds(ids: number[]): Promise<void> {
        return chunks.deleteChunksByIds(this.pool, this.logger, this.config.table, ids);
    }

    async updateChunkOrders(updates: Array<{ id: number; chunkId: number }>): Promise<void> {
        return chunks.updateChunkOrders(this.pool, this.logger, this.config.table, updates);
    }

    async moveChunksAtomic(movesToExecute: Array<{ id: number; filepath: string; chunkId: number; sourceType?: 'doc' | 'code' | 'mdx' | 'typescript'; githubUrl?: string }>): Promise<void> {
        return moves.moveChunksAtomic(this.pool, this.logger, this.config.table, movesToExecute);
    }

    async findOrphanedChunkIds(activeChecksums: Set<string>, repositoryBaseUrls?: Set<string>, activeGithubUrls?: Set<string>): Promise<number[]> {
        return orphans.findOrphanedChunkIds(this.pool, this.logger, this.config.table, activeChecksums, repositoryBaseUrls, activeGithubUrls);
    }

    async findStrandedChunkIds(activeChecksums: Set<string>, repositoryIdentifiers?: Set<string>): Promise<number[]> {
        return orphans.findStrandedChunkIds(this.pool, this.logger, this.config.table, activeChecksums, repositoryIdentifiers);
    }

    async matchDocuments(embedding: number[], options?: { matchCount?: number; similarityThreshold?: number }): Promise<RetrievedChunk[]> {
        const matchCount = options?.matchCount ?? this.config.matchCount;
        const similarityThreshold = options?.similarityThreshold ?? this.config.similarityThreshold;
        return search.matchDocuments(this.pool, this.logger, this.config.table, embedding, matchCount, similarityThreshold);
    }

    async searchDocumentsFullText(query: string, options?: { matchCount?: number }): Promise<RetrievedChunk[]> {
        const matchCount = options?.matchCount ?? this.config.bm25MatchCount ?? this.config.matchCount;
        return search.searchDocumentsFullText(this.pool, this.logger, this.config.table, query, matchCount);
    }
}

export function createPostgresStore(config: DatabaseConfig): PostgresVectorStore {
    return new PostgresVectorStore(config);
}
