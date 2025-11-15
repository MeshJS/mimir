import type { Logger } from "pino";
import type { AppConfig } from "../config/types";
import type { LLMClientBundle } from "../llm/types";
import { getLogger } from "../utils/logger";
import { downloadGithubMdxFiles, GithubMdxDocument } from "./github";
import { chunkMdxFile, MdxChunk } from "./chunker";
import type { SupabaseVectorStore, ExistingChunkInfo } from "../supabase/client";
import type { DocumentChunk } from "../supabase/types";

interface PendingEmbeddingChunk {
    filepath: string;
    chunkId: number;
    chunkTitle: string;
    checksum: string;
    content: string;
    contextualText: string;
}

interface ChunkDiffResult {
    reordered: Array<{ id: number; chunkId: number }>;
    newOrUpdated: Array<{ chunk: MdxChunk; index: number }>;
    deletedIds: number[];
}

export interface IngestionPipelineStats {
    processedDocuments: number;
    skippedDocuments: number;
    upsertedChunks: number;
    reorderedChunks: number;
    deletedChunks: number;
}

export interface IngestionPipelineResult {
    documents: GithubMdxDocument[];
    stats: IngestionPipelineStats;
}

export async function runIngestionPipeline(
    appConfig: AppConfig,
    llm: LLMClientBundle,
    store: SupabaseVectorStore,
    logger?: Logger
): Promise<IngestionPipelineResult> {
    const baseLogger = logger ?? getLogger();
    const ingestionLogger = typeof baseLogger.child === "function"
        ? baseLogger.child({ module: "ingest" })
        : baseLogger;

    const documents = await downloadGithubMdxFiles(appConfig);

    const stats: IngestionPipelineStats = {
        processedDocuments: 0,
        skippedDocuments: 0,
        upsertedChunks: 0,
        reorderedChunks: 0,
        deletedChunks: 0,
    };

    const pendingEmbeddings: PendingEmbeddingChunk[] = [];
    const pendingReorders: Array<{ id: number; chunkId: number }> = [];
    const pendingDeletes: number[] = [];
    const contextTasks: Promise<void>[] = [];

    ingestionLogger.info(`Processing ${documents.length} MDX document${documents.length === 1 ? "" : "s"}.`);

    for (const document of documents) {
        const filepath = document.relativePath || document.path;
        const fileLogger = typeof ingestionLogger.child === "function"
            ? ingestionLogger.child({ file: filepath })
            : ingestionLogger;

        const mdxChunks = chunkMdxFile(document.content);

        if (mdxChunks.length === 0) {
            stats.skippedDocuments += 1;
            fileLogger.warn("No chunks were generated for this document. Skipping.");
            continue;
        }

        stats.processedDocuments += 1;

        const existing = await store.fetchExistingChunks(filepath);
        const diff = diffChunks(mdxChunks, existing);

        if (diff.reordered.length > 0) {
            pendingReorders.push(...diff.reordered);
            stats.reorderedChunks += diff.reordered.length;
        }

        if (diff.deletedIds.length > 0) {
            pendingDeletes.push(...diff.deletedIds);
            stats.deletedChunks += diff.deletedIds.length;
        }

        if (diff.newOrUpdated.length === 0) {
            fileLogger.debug("All chunks unchanged; no LLM work required.");
            continue;
        }

        fileLogger.info(
            `Generating context for ${diff.newOrUpdated.length} new or modified chunk${diff.newOrUpdated.length === 1 ? "" : "s"}.`
        );

        const chunkContents = diff.newOrUpdated.map((entry) => entry.chunk.chunkContent);
        const contextTask = llm.chat
            .generateFileChunkContexts(chunkContents, document.content)
            .then((contexts) => {
                if (contexts.length !== diff.newOrUpdated.length) {
                    throw new Error(
                        `Context generation returned ${contexts.length} entries for ${diff.newOrUpdated.length} chunks in ${filepath}.`
                    );
                }

                diff.newOrUpdated.forEach((entry, index) => {
                    const contextualText = contexts[index]?.trim() ?? "";
                    pendingEmbeddings.push({
                        filepath,
                        chunkId: entry.index,
                        chunkTitle: entry.chunk.chunkTitle,
                        checksum: entry.chunk.checksum,
                        content: entry.chunk.chunkContent,
                        contextualText,
                    });
                });
            })
            .catch((error) => {
                fileLogger.error(
                    { err: error },
                    `Failed to generate contextual summaries for ${filepath}.`
                );
                throw error;
            });

        contextTasks.push(contextTask);

        stats.upsertedChunks += diff.newOrUpdated.length;
    }

    await Promise.all(contextTasks);

    if (pendingReorders.length > 0) {
        ingestionLogger.info(`Reordering ${pendingReorders.length} chunk${pendingReorders.length === 1 ? "" : "s"}.`);
        await store.updateChunkOrders(pendingReorders);
    }

    if (pendingDeletes.length > 0) {
        ingestionLogger.info(`Deleting ${pendingDeletes.length} stale chunk${pendingDeletes.length === 1 ? "" : "s"}.`);
        await store.deleteChunksByIds(pendingDeletes);
    }

    if (pendingEmbeddings.length === 0) {
        ingestionLogger.info("No new or updated chunks required embeddings. Ingestion pipeline complete.");
        return {
            documents,
            stats,
        };
    }

    ingestionLogger.info(`Embedding ${pendingEmbeddings.length} chunk${pendingEmbeddings.length === 1 ? "" : "s"} using ${llm.embedding.config.provider}.`);

    const embeddings = await llm.embedding.embedDocuments(
        pendingEmbeddings.map((entry) => entry.content)
    );

    if (embeddings.length !== pendingEmbeddings.length) {
        throw new Error(
            `Embedding generation returned ${embeddings.length} vectors for ${pendingEmbeddings.length} chunks.`
        );
    }

    const upsertPayload: DocumentChunk[] = pendingEmbeddings.map((entry, index) => ({
        content: entry.content,
        contextualText: entry.contextualText,
        embedding: embeddings[index],
        filepath: entry.filepath,
        chunkId: entry.chunkId,
        chunkTitle: entry.chunkTitle,
        checksum: entry.checksum,
    }));

    await store.upsertChunks(upsertPayload);

    ingestionLogger.info("Ingestion pipeline completed successfully.");

    return {
        documents,
        stats,
    };
}

function diffChunks(chunks: MdxChunk[], existing: Map<number, ExistingChunkInfo>): ChunkDiffResult {
    const checksumBuckets = new Map<string, Array<{ chunkId: number; info: ExistingChunkInfo }>>();
    const matchedIds = new Set<number>();

    for (const [chunkId, info] of existing.entries()) {
        const bucket = checksumBuckets.get(info.checksum);
        if (bucket) {
            bucket.push({ chunkId, info });
        } else {
            checksumBuckets.set(info.checksum, [{ chunkId, info }]);
        }
    }

    const reordered: Array<{ id: number; chunkId: number }> = [];
    const newOrUpdated: Array<{ chunk: MdxChunk; index: number }> = [];

    chunks.forEach((chunk, index) => {
        const bucket = checksumBuckets.get(chunk.checksum);

        if (bucket && bucket.length > 0) {
            const match = bucket.shift()!;
            if (bucket.length === 0) {
                checksumBuckets.delete(chunk.checksum);
            }

            matchedIds.add(match.info.id);

            if (match.chunkId !== index) {
                reordered.push({ id: match.info.id, chunkId: index });
            }

            return;
        }

        newOrUpdated.push({ chunk, index });
    });

    const deletedIds: number[] = [];
    existing.forEach((info) => {
        if (!matchedIds.has(info.id)) {
            deletedIds.push(info.id);
        }
    });

    return {
        reordered,
        newOrUpdated,
        deletedIds,
    };
}
