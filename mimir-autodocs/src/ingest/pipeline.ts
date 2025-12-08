import type { Logger } from "pino";
import type { AppConfig } from "../config/types";
import type { LLMClientBundle, EntityContextInput } from "../llm/types";
import { getLogger } from "../utils/logger";
import { downloadGithubTypescriptFiles, GithubTypescriptDocument } from "./typescript";
import { parseTypescriptFile, ParsedFile } from "./astParser";
import { chunkParsedFile, EntityChunk, ChunkedFile, calculateChunkingStats } from "./entityChunker";
import type { SupabaseVectorStore, ExistingChunkInfo } from "../supabase/client";
import type { DocumentChunk } from "../supabase/types";

interface PendingEmbeddingChunk {
    filepath: string;
    chunkId: number;
    qualifiedName: string;
    checksum: string;
    content: string;
    contextualText: string;
    entityType: EntityChunk["entityType"];
    startLine: number;
    endLine: number;
    githubUrl: string;
}

/** Target location for a chunk in the new state */
interface TargetChunkLocation {
    filepath: string;
    chunkId: number;
    chunk: EntityChunk;
    githubUrl: string;
}

/** Classification of how a chunk should be handled */
type ChunkClassification =
    | { type: "unchanged"; existingId: number }
    | { type: "moved"; existingId: number; newFilepath: string; newChunkId: number }
    | { type: "new"; chunk: EntityChunk; filepath: string; chunkId: number; githubUrl: string };

export interface IngestionPipelineStats {
    processedFiles: number;
    skippedFiles: number;
    totalEntities: number;
    upsertedChunks: number;
    movedChunks: number;
    deletedChunks: number;
    parseErrors: number;
}

export interface IngestionPipelineResult {
    documents: GithubTypescriptDocument[];
    stats: IngestionPipelineStats;
}

export async function runIngestionPipeline(
    appConfig: AppConfig,
    llm: LLMClientBundle,
    store: SupabaseVectorStore,
    logger?: Logger
): Promise<IngestionPipelineResult> {
    const baseLogger = logger ?? getLogger();
    const ingestionLogger =
        typeof baseLogger.child === "function"
            ? baseLogger.child({ module: "ingest" })
            : baseLogger;

    // Step 1: Download TypeScript files
    const documents = await downloadGithubTypescriptFiles(appConfig);

    const stats: IngestionPipelineStats = {
        processedFiles: 0,
        skippedFiles: 0,
        totalEntities: 0,
        upsertedChunks: 0,
        movedChunks: 0,
        deletedChunks: 0,
        parseErrors: 0,
    };

    ingestionLogger.info(
        `Processing ${documents.length} TypeScript file${documents.length === 1 ? "" : "s"}.`
    );

    // Step 2: Parse files and extract entities
    const parsedFiles: ParsedFile[] = [];
    const documentMap = new Map<string, GithubTypescriptDocument>();

    for (const document of documents) {
        const filepath = document.relativePath || document.path;
        documentMap.set(filepath, document);

        const fileLogger =
            typeof ingestionLogger.child === "function"
                ? ingestionLogger.child({ file: filepath })
                : ingestionLogger;

        try {
            const parsed = parseTypescriptFile(filepath, document.content, appConfig.parser);
            
            if (parsed.entities.length === 0) {
                stats.skippedFiles += 1;
                fileLogger.debug("No entities found in file. Skipping.");
                continue;
            }

            parsedFiles.push(parsed);
            stats.processedFiles += 1;
            stats.totalEntities += parsed.entities.length;

            fileLogger.debug(`Parsed ${parsed.entities.length} entities.`);
        } catch (error) {
            stats.parseErrors += 1;
            fileLogger.warn({ err: error }, "Failed to parse file. Skipping.");
        }
    }

    if (parsedFiles.length === 0) {
        ingestionLogger.info("No files with entities to process. Ingestion pipeline complete.");
        return { documents, stats };
    }

    // Step 3: Chunk entities with token limits
    // For now, use a reasonable default token limit
    const TOKEN_LIMIT = 8000;
    const chunkedFiles: ChunkedFile[] = parsedFiles.map((parsed) =>
        chunkParsedFile(parsed, { tokenLimit: TOKEN_LIMIT, model: llm.embedding.config.model })
    );

    const chunkStats = calculateChunkingStats(chunkedFiles);
    ingestionLogger.info(
        `Chunked ${chunkStats.totalEntities} entities into ${chunkStats.totalChunks} chunks. ${chunkStats.splitEntities} entities were split.`
    );

    // Step 4: Build target state map: checksum -> target location
    const targetState = new Map<string, TargetChunkLocation>();
    const allChecksums: string[] = [];

    for (const file of chunkedFiles) {
        const document = documentMap.get(file.filepath);
        const githubUrl = document?.sourceUrl ?? "";

        file.chunks.forEach((chunk, index) => {
            // If same checksum appears in multiple files, the last one wins
            // This is expected behavior - content deduplication
            targetState.set(chunk.checksum, {
                filepath: file.filepath,
                chunkId: index,
                chunk,
                githubUrl,
            });
            allChecksums.push(chunk.checksum);
        });
    }

    if (targetState.size === 0) {
        ingestionLogger.info("No chunks to process. Ingestion pipeline complete.");
        return { documents, stats };
    }

    // Step 5: Fetch existing chunks by checksums globally
    const uniqueChecksums = [...new Set(allChecksums)];
    const existingByChecksum = await store.fetchChunksByChecksums(uniqueChecksums);

    ingestionLogger.info(
        `Found ${existingByChecksum.size} existing checksum${existingByChecksum.size === 1 ? "" : "s"} in the database.`
    );

    // Step 6: Classify each target chunk
    const classifications: ChunkClassification[] = [];
    const alreadyAssignedDbIds = new Set<number>();

    for (const [checksum, target] of targetState.entries()) {
        const dbChunksWithSameChecksum = existingByChecksum.get(checksum);

        if (dbChunksWithSameChecksum && dbChunksWithSameChecksum.length > 0) {
            // Check if any DB row is already at the exact target location
            const alreadyInPlace = dbChunksWithSameChecksum.find(
                (dbChunk) =>
                    dbChunk.filepath === target.filepath &&
                    dbChunk.chunkId === target.chunkId &&
                    !alreadyAssignedDbIds.has(dbChunk.id)
            );

            if (alreadyInPlace) {
                classifications.push({ type: "unchanged", existingId: alreadyInPlace.id });
                alreadyAssignedDbIds.add(alreadyInPlace.id);
            } else {
                // Find any unassigned DB row we can move
                const reusableDbChunk = dbChunksWithSameChecksum.find(
                    (dbChunk) => !alreadyAssignedDbIds.has(dbChunk.id)
                );

                if (reusableDbChunk) {
                    classifications.push({
                        type: "moved",
                        existingId: reusableDbChunk.id,
                        newFilepath: target.filepath,
                        newChunkId: target.chunkId,
                    });
                    alreadyAssignedDbIds.add(reusableDbChunk.id);
                } else {
                    classifications.push({
                        type: "new",
                        chunk: target.chunk,
                        filepath: target.filepath,
                        chunkId: target.chunkId,
                        githubUrl: target.githubUrl,
                    });
                }
            }
        } else {
            classifications.push({
                type: "new",
                chunk: target.chunk,
                filepath: target.filepath,
                chunkId: target.chunkId,
                githubUrl: target.githubUrl,
            });
        }
    }

    // Step 7: Find orphaned chunks (checksums not in target state)
    const activeChecksums = new Set(targetState.keys());
    const orphanedIds = await store.findOrphanedChunkIds(activeChecksums);

    // Step 8: Move chunks to new locations
    const movedChunks = classifications.filter(
        (c): c is Extract<ChunkClassification, { type: "moved" }> => c.type === "moved"
    );

    if (movedChunks.length > 0) {
        ingestionLogger.info(
            `Moving ${movedChunks.length} chunk${movedChunks.length === 1 ? "" : "s"} to new locations.`
        );
        await store.moveChunksAtomic(
            movedChunks.map((c) => ({
                id: c.existingId,
                filepath: c.newFilepath,
                chunkId: c.newChunkId,
            }))
        );
        stats.movedChunks = movedChunks.length;
    }

    // Step 9: Delete orphaned chunks
    if (orphanedIds.length > 0) {
        ingestionLogger.info(
            `Deleting ${orphanedIds.length} orphaned chunk${orphanedIds.length === 1 ? "" : "s"}.`
        );
        await store.deleteChunksByIds(orphanedIds);
        stats.deletedChunks = orphanedIds.length;
    }

    // Step 10: Generate contexts and embed new chunks
    const newChunks = classifications.filter(
        (c): c is Extract<ChunkClassification, { type: "new" }> => c.type === "new"
    );

    if (newChunks.length === 0) {
        ingestionLogger.info("No new chunks required embeddings. Ingestion pipeline complete.");
        return { documents, stats };
    }

    // Group new chunks by filepath for context generation
    const newChunksByFilepath = new Map<
        string,
        Array<{ chunk: EntityChunk; chunkId: number; githubUrl: string }>
    >();
    for (const c of newChunks) {
        const existing = newChunksByFilepath.get(c.filepath) ?? [];
        existing.push({ chunk: c.chunk, chunkId: c.chunkId, githubUrl: c.githubUrl });
        newChunksByFilepath.set(c.filepath, existing);
    }

    const pendingEmbeddings: PendingEmbeddingChunk[] = [];
    const contextTasks: Promise<void>[] = [];

    for (const [filepath, chunks] of newChunksByFilepath.entries()) {
        const document = documentMap.get(filepath);

        if (!document) {
            ingestionLogger.warn(
                `Document for filepath ${filepath} not found. Skipping context generation.`
            );
            continue;
        }

        const fileLogger =
            typeof ingestionLogger.child === "function"
                ? ingestionLogger.child({ file: filepath })
                : ingestionLogger;

        fileLogger.info(
            `Generating context for ${chunks.length} new chunk${chunks.length === 1 ? "" : "s"}.`
        );

        // Build entity context inputs
        const entityInputs: EntityContextInput[] = chunks.map((entry) => ({
            entityCode: entry.chunk.content,
            entityType: entry.chunk.entityType,
            entityName: entry.chunk.qualifiedName,
            fullFileContent: document.content,
            parentContext: entry.chunk.parentContext,
            jsDoc: entry.chunk.jsDoc,
        }));

        const contextTask = llm.chat
            .generateEntityContexts(entityInputs, document.content)
            .then((contexts) => {
                if (contexts.length !== chunks.length) {
                    fileLogger.warn(
                        `Context generation returned ${contexts.length} entries for ${chunks.length} chunks.`
                    );
                }

                chunks.forEach((entry, index) => {
                    const contextHeader = contexts[index]?.trim() ?? "";
                    const contextualText = contextHeader
                        ? `${contextHeader}\n---\n${entry.chunk.content}`
                        : entry.chunk.content;

                    pendingEmbeddings.push({
                        filepath,
                        chunkId: entry.chunkId,
                        qualifiedName: entry.chunk.qualifiedName,
                        checksum: entry.chunk.checksum,
                        content: entry.chunk.content,
                        contextualText,
                        entityType: entry.chunk.entityType,
                        startLine: entry.chunk.startLine,
                        endLine: entry.chunk.endLine,
                        githubUrl: entry.githubUrl,
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
    }

    await Promise.all(contextTasks);

    // Step 11: Batch embed all contextual texts
    ingestionLogger.info(
        `Embedding ${pendingEmbeddings.length} chunk${pendingEmbeddings.length === 1 ? "" : "s"} using ${llm.embedding.config.provider}.`
    );

    const embeddings = await llm.embedding.embedDocuments(
        pendingEmbeddings.map((entry) => entry.contextualText)
    );

    if (embeddings.length !== pendingEmbeddings.length) {
        throw new Error(
            `Embedding generation returned ${embeddings.length} vectors for ${pendingEmbeddings.length} chunks.`
        );
    }

    // Step 12: Upsert to database
    const upsertPayload: DocumentChunk[] = pendingEmbeddings.map((entry, index) => ({
        content: entry.content,
        contextualText: entry.contextualText,
        embedding: embeddings[index],
        filepath: entry.filepath,
        chunkId: entry.chunkId,
        chunkTitle: entry.qualifiedName,
        checksum: entry.checksum,
        entityType: entry.entityType,
        githubUrl: entry.githubUrl,
        startLine: entry.startLine,
        endLine: entry.endLine,
    }));

    await store.upsertChunks(upsertPayload);
    stats.upsertedChunks = pendingEmbeddings.length;

    ingestionLogger.info("Ingestion pipeline completed successfully.");

    return {
        documents,
        stats,
    };
}

