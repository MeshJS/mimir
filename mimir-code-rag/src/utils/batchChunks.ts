export function batchChunks<T>(chunks: T[], batchSize: number): T[][] {
    if (batchSize <= 0) throw new Error("batchSize must be > 0");

    const batches: T[][] = [];
    for (let i = 0; i < chunks.length; i += batchSize) {
        batches.push(chunks.slice(i, i + batchSize));
    }
    return batches;
}

