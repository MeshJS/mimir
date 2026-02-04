import type { Pool } from "pg";
import type { Logger } from "pino";

interface ChunkRow {
    id: number;
    checksum: string;
    github_url: string | null;
    filepath: string;
    source_type: string | null;
}

function normalizeGithubUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    return url.split('#')[0];
}

export async function findOrphanedChunkIds(
    pool: Pool,
    logger: Logger,
    table: string,
    activeChecksums: Set<string>,
    repositoryBaseUrls?: Set<string>,
    activeGithubUrls?: Set<string>
): Promise<number[]> {
    let allData: ChunkRow[] = [];
    let offset = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
        const result = await pool.query(
            `SELECT id, checksum, github_url, filepath, source_type FROM ${table} ORDER BY id LIMIT $1 OFFSET $2`,
            [batchSize, offset]
        );

        if (result.rows.length === 0) {
            hasMore = false;
        } else {
            allData = allData.concat(result.rows);
            hasMore = result.rows.length === batchSize;
            offset += batchSize;
        }
    }

    if (allData.length === 0) {
        return [];
    }

    let chunksToCheck = allData;
    if (repositoryBaseUrls && repositoryBaseUrls.size > 0) {
        const baseUrlsArray = Array.from(repositoryBaseUrls);
        logger.info(`Filtering chunks by repository base URLs: ${baseUrlsArray.map(url => `"${url}"`).join(", ")}`);

        chunksToCheck = allData.filter(row => {
            if (!row.github_url) return false;
            const normalizedUrl = normalizeGithubUrl(row.github_url);
            if (!normalizedUrl) return false;
            return baseUrlsArray.some(baseUrl => normalizedUrl.startsWith(baseUrl));
        });

        logger.info(`Filtered ${allData.length} total chunks to ${chunksToCheck.length} chunks from configured repositories.`);
    }

    if (activeChecksums.size === 0) {
        return chunksToCheck.map((row) => row.id);
    }

    const normalizedActiveGithubUrls = activeGithubUrls
        ? new Set(Array.from(activeGithubUrls).map(normalizeGithubUrl).filter((url): url is string => url !== null))
        : undefined;

    const orphanedIds: number[] = [];
    let orphanedByGithubUrlCount = 0;
    let orphanedByChecksumCount = 0;
    let skippedNoGithubUrl = 0;

    for (const row of chunksToCheck) {
        const normalizedDbGithubUrl = normalizeGithubUrl(row.github_url);
        const isOrphanedByGithubUrl = normalizedActiveGithubUrls && normalizedDbGithubUrl && !normalizedActiveGithubUrls.has(normalizedDbGithubUrl);
        const isOrphanedByChecksum = !activeChecksums.has(row.checksum);
        const isOrphaned = isOrphanedByGithubUrl || isOrphanedByChecksum;

        if (isOrphaned) {
            orphanedIds.push(row.id);
            if (isOrphanedByGithubUrl && !isOrphanedByChecksum) {
                orphanedByGithubUrlCount++;
            } else if (isOrphanedByChecksum && !isOrphanedByGithubUrl) {
                orphanedByChecksumCount++;
            } else {
                orphanedByGithubUrlCount++;
            }
        } else if (!row.github_url) {
            skippedNoGithubUrl++;
        }
    }

    if (orphanedByGithubUrlCount > 0) {
        logger.info(`Found ${orphanedByGithubUrlCount} chunk${orphanedByGithubUrlCount === 1 ? "" : "s"} orphaned by github_url.`);
    }
    if (orphanedByChecksumCount > 0) {
        logger.info(`Found ${orphanedByChecksumCount} chunk${orphanedByChecksumCount === 1 ? "" : "s"} orphaned by checksum.`);
    }
    if (skippedNoGithubUrl > 0) {
        logger.warn(`Skipped ${skippedNoGithubUrl} chunk${skippedNoGithubUrl === 1 ? "" : "s"} without github_url.`);
    }

    logger.info(`Found ${orphanedIds.length} orphaned chunk${orphanedIds.length === 1 ? "" : "s"} to delete.`);

    return orphanedIds;
}

export async function findStrandedChunkIds(
    pool: Pool,
    logger: Logger,
    table: string,
    activeChecksums: Set<string>,
    repositoryIdentifiers?: Set<string>
): Promise<number[]> {
    const result = await pool.query(
        `SELECT id, checksum, filepath, github_url FROM ${table} WHERE filepath LIKE $1`,
        ['__moving__%']
    );

    if (result.rows.length === 0) {
        return [];
    }

    const strandedIds: number[] = [];

    for (const chunk of result.rows) {
        if (!activeChecksums.has(chunk.checksum)) {
            if (repositoryIdentifiers && repositoryIdentifiers.size > 0) {
                const githubUrl = chunk.github_url;
                if (githubUrl) {
                    const match = githubUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
                    if (match) {
                        const repoIdentifier = `${match[1]}/${match[2]}`;
                        if (repositoryIdentifiers.has(repoIdentifier)) {
                            strandedIds.push(chunk.id);
                        }
                    }
                }
            } else {
                strandedIds.push(chunk.id);
            }
        }
    }

    return strandedIds;
}
