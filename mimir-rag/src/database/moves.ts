import type { Pool } from "pg";
import type { Logger } from "pino";

interface ChunkMove {
    id: number;
    filepath: string;
    chunkId: number;
    sourceType?: 'doc' | 'code' | 'mdx' | 'typescript';
    githubUrl?: string;
}

export async function moveChunksAtomic(
    pool: Pool,
    logger: Logger,
    table: string,
    moves: ChunkMove[]
): Promise<void> {
    if (moves.length === 0) {
        return;
    }

    const BATCH_SIZE = 50;
    for (let i = 0; i < moves.length; i += BATCH_SIZE) {
        const batch = moves.slice(i, i + BATCH_SIZE);
        await Promise.all(
            batch.map(async (move) => {
                const tempFilepath = `__moving__${move.id}`;
                const updates: string[] = [`filepath = $1`, `chunk_id = $2`];
                const values: any[] = [tempFilepath, move.chunkId];
                let paramIndex = 3;

                if (move.sourceType) {
                    updates.push(`source_type = $${paramIndex}`);
                    values.push(move.sourceType);
                    paramIndex++;
                }

                await pool.query(
                    `UPDATE ${table} SET ${updates.join(", ")} WHERE id = $${paramIndex}`,
                    [...values, move.id]
                );
            })
        );
    }

    const movesByTarget = new Map<string, ChunkMove[]>();
    for (const move of moves) {
        const uniqueKey = `${move.filepath}:${move.chunkId}`;
        if (!movesByTarget.has(uniqueKey)) {
            movesByTarget.set(uniqueKey, []);
        }
        movesByTarget.get(uniqueKey)!.push(move);
    }

    let successfullyMoved = 0;
    const strandedChunkIds: number[] = [];

    for (const [uniqueKey, targetMoves] of movesByTarget.entries()) {
        if (targetMoves.length > 1) {
            logger.warn(
                `Multiple chunks (${targetMoves.length}) targeting same location ${uniqueKey}. Only moving first chunk.`
            );
            for (let i = 1; i < targetMoves.length; i++) {
                strandedChunkIds.push(targetMoves[i].id);
            }
        }

        const move = targetMoves[0];

        const existingResult = await pool.query(
            `SELECT id FROM ${table} WHERE filepath = $1 AND chunk_id = $2`,
            [move.filepath, move.chunkId]
        );

        if (existingResult.rows.length > 0 && existingResult.rows[0].id !== move.id) {
            logger.warn(
                `Target location ${uniqueKey} already occupied by chunk ${existingResult.rows[0].id}. Skipping move for chunk ${move.id}.`
            );
            strandedChunkIds.push(move.id);
            continue;
        }

        const updates: string[] = [`filepath = $1`, `chunk_id = $2`];
        const values: any[] = [move.filepath, move.chunkId];
        let paramIndex = 3;

        if (move.sourceType) {
            updates.push(`source_type = $${paramIndex}`);
            values.push(move.sourceType);
            paramIndex++;
        }

        if (move.githubUrl !== undefined) {
            updates.push(`github_url = $${paramIndex}`);
            values.push(move.githubUrl);
            paramIndex++;
        }

        await pool.query(
            `UPDATE ${table} SET ${updates.join(", ")} WHERE id = $${paramIndex}`,
            [...values, move.id]
        );

        successfullyMoved++;
    }

    if (strandedChunkIds.length > 0) {
        logger.warn(
            `${strandedChunkIds.length} chunk${strandedChunkIds.length === 1 ? "" : "s"} left in temporary locations due to duplicate target locations.`
        );
    }

    logger.info(`Moved ${successfullyMoved} of ${moves.length} chunk${moves.length === 1 ? "" : "s"} to new locations.`);
}
