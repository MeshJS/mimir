import type { Pool } from "pg";
import type { Logger } from "pino";
import type { DocumentChunk, ExistingChunkInfo } from "./types";

export async function fetchExistingChunks(
    pool: Pool,
    logger: Logger,
    table: string,
    filepath: string
): Promise<Map<number, ExistingChunkInfo>> {
    const result = await pool.query(
        `SELECT id, chunk_id, checksum, filepath FROM ${table} WHERE filepath = $1`,
        [filepath]
    );

    const map = new Map<number, ExistingChunkInfo>();
    result.rows.forEach((row) => {
        map.set(row.chunk_id, {
            id: row.id,
            checksum: row.checksum,
            filepath: row.filepath,
            chunkId: row.chunk_id,
        });
    });

    return map;
}

export async function fetchChunksByChecksums(
    pool: Pool,
    logger: Logger,
    table: string,
    checksums: string[]
): Promise<Map<string, ExistingChunkInfo[]>> {
    if (checksums.length === 0) {
        return new Map();
    }

    const map = new Map<string, ExistingChunkInfo[]>();
    const BATCH_SIZE = 50;

    for (let i = 0; i < checksums.length; i += BATCH_SIZE) {
        const batch = checksums.slice(i, i + BATCH_SIZE);
        const placeholders = batch.map((_, idx) => `$${idx + 1}`).join(",");
        
        const result = await pool.query(
            `SELECT id, chunk_id, checksum, filepath, source_type FROM ${table} WHERE checksum IN (${placeholders})`,
            batch
        );

        result.rows.forEach((row) => {
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

export async function upsertChunks(
    pool: Pool,
    logger: Logger,
    table: string,
    chunks: DocumentChunk[]
): Promise<void> {
    if (chunks.length === 0) {
        return;
    }

    const values: any[] = [];
    const placeholders: string[] = [];
    let paramIndex = 1;

    chunks.forEach((chunk) => {
        const chunkValues: any[] = [
            chunk.content,
            chunk.contextualText,
            `[${chunk.embedding.join(",")}]`,
            chunk.filepath,
            chunk.chunkId,
            chunk.chunkTitle,
            chunk.checksum,
            chunk.githubUrl ?? null,
            chunk.docsUrl ?? null,
            chunk.finalUrl ?? null,
            chunk.sourceType ?? 'mdx',
            chunk.entityType ?? null,
            chunk.startLine ?? null,
            chunk.endLine ?? null
        ];
        const chunkPlaceholders = chunkValues.map((_, i) => {
            const paramIndex = values.length + i + 1;
            if (i === 2) {
                return `$${paramIndex}::vector`;
            }
            return `$${paramIndex}`;
        }).join(", ");
        placeholders.push(`(${chunkPlaceholders})`);
        values.push(...chunkValues);
    });

    const query = `
        INSERT INTO ${table} (
            content, contextual_text, embedding, filepath, chunk_id, chunk_title,
            checksum, github_url, docs_url, final_url, source_type, entity_type,
            start_line, end_line
        ) VALUES ${placeholders.join(", ")}
        ON CONFLICT (filepath, chunk_id) DO UPDATE SET
            content = EXCLUDED.content,
            contextual_text = EXCLUDED.contextual_text,
            embedding = EXCLUDED.embedding::vector,
            chunk_title = EXCLUDED.chunk_title,
            checksum = EXCLUDED.checksum,
            github_url = EXCLUDED.github_url,
            docs_url = EXCLUDED.docs_url,
            final_url = EXCLUDED.final_url,
            source_type = EXCLUDED.source_type,
            entity_type = EXCLUDED.entity_type,
            start_line = EXCLUDED.start_line,
            end_line = EXCLUDED.end_line
    `;

    await pool.query(query, values);
    logger.info(`Upserted ${chunks.length} chunk${chunks.length === 1 ? "" : "s"}`);
}

export async function deleteMissingChunks(
    pool: Pool,
    logger: Logger,
    table: string,
    filepath: string,
    validChunkIds: number[]
): Promise<void> {
    if (validChunkIds.length === 0) {
        await pool.query(`DELETE FROM ${table} WHERE filepath = $1`, [filepath]);
        return;
    }

    const placeholders = validChunkIds.map((_, idx) => `$${idx + 1}`).join(",");
    await pool.query(
        `DELETE FROM ${table} WHERE filepath = $${validChunkIds.length + 1} AND chunk_id NOT IN (${placeholders})`,
        [...validChunkIds, filepath]
    );

    logger.info(`Successfully deleted missing chunks from ${filepath}`);
}

export async function deleteChunksByIds(
    pool: Pool,
    logger: Logger,
    table: string,
    ids: number[]
): Promise<void> {
    if (ids.length === 0) {
        return;
    }

    const placeholders = ids.map((_, idx) => `$${idx + 1}`).join(",");
    await pool.query(`DELETE FROM ${table} WHERE id IN (${placeholders})`, ids);

    logger.info(`Deleted ${ids.length} chunk${ids.length === 1 ? "" : "s"} by id`);
}

export async function updateChunkOrders(
    pool: Pool,
    logger: Logger,
    table: string,
    updates: Array<{ id: number; chunkId: number }>
): Promise<void> {
    if (updates.length === 0) {
        return;
    }

    const TEMP_OFFSET = 1_000_000;

    for (const update of updates) {
        await pool.query(
            `UPDATE ${table} SET chunk_id = $1 WHERE id = $2`,
            [TEMP_OFFSET + update.id, update.id]
        );
    }

    for (const update of updates) {
        await pool.query(
            `UPDATE ${table} SET chunk_id = $1 WHERE id = $2`,
            [update.chunkId, update.id]
        );
    }

    logger.info(`Reordered ${updates.length} chunk${updates.length === 1 ? "" : "s"}`);
}
