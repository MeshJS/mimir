import type { Logger } from "pino";
import type { AppConfig } from "../config/types";
import type { LLMClientBundle, EntityContextInput } from "../llm/types";
import { getLogger } from "../utils/logger";
import { downloadGithubFiles, downloadGithubMdxFiles, GithubMdxDocument, GithubDocument, GithubDocumentType } from "./github";
import { chunkMdxFile, enforceChunkTokenLimit, MdxChunk } from "./chunkers/chunker";
import { parseTypescriptFile, ParsedFile } from "./parsers/astParser";
import { parsePythonFile, ParsedPythonFile } from "./parsers/pythonAstParser";
import { parseRustFile, ParsedRustFile } from "./parsers/rustAstParser";
import { chunkParsedFile, EntityChunk } from "./chunkers/entityChunker";
import type { PostgresVectorStore } from "../database/client";
import type { DocumentChunk } from "../supabase/types";
import { resolveEmbeddingInputTokenLimit } from "../llm/modelLimits";
import { resolveSourceLinks } from "../utils/sourceLinks";
import { parseGithubUrl } from "../github/utils";

interface PendingEmbeddingChunk {
    filepath: string;
    chunkId: number;
    chunkTitle: string;
    checksum: string;
    content: string;
    contextualText: string;
    sourceType: 'doc' | 'code';
    entityType?: string;
    startLine?: number;
    endLine?: number;
    githubUrl?: string;
}

/** Unified chunk type for both docs (MDX) and code entities */
type UnifiedChunk = 
    | { sourceType: 'doc'; chunk: MdxChunk }
    | { sourceType: 'code'; chunk: EntityChunk };

/** Target location for a chunk in the new state */
interface TargetChunkLocation {
    filepath: string;
    chunkId: number;
    chunk: UnifiedChunk;
    sourceType: 'doc' | 'code';
    githubUrl?: string;
}

/** Classification of how a chunk should be handled */
type ChunkClassification =
    | { type: "unchanged"; existingId: number }
    | { type: "moved"; existingId: number; newFilepath: string; newChunkId: number; newSourceType: 'doc' | 'code'; newGithubUrl?: string }
    | { type: "new"; chunk: UnifiedChunk; filepath: string; chunkId: number; sourceType: 'doc' | 'code'; githubUrl?: string };

export interface IngestionPipelineStats {
    processedDocuments: number;
    skippedDocuments: number;
    upsertedChunks: number;
    movedChunks: number;
    deletedChunks: number;
}

export interface IngestionPipelineResult {
    documents: GithubDocument[];
    stats: IngestionPipelineStats;
}

export async function runIngestionPipeline(
    appConfig: AppConfig,
    llm: LLMClientBundle,
    store: PostgresVectorStore,
    logger?: Logger
): Promise<IngestionPipelineResult> {
    const baseLogger = logger ?? getLogger();
    const ingestionLogger = typeof baseLogger.child === "function"
        ? baseLogger.child({ module: "ingest" })
        : baseLogger;

    const documents = await downloadGithubFiles(appConfig);
    const chunkTokenLimit = resolveEmbeddingInputTokenLimit(llm.embedding.config);

    const stats: IngestionPipelineStats = {
        processedDocuments: 0,
        skippedDocuments: 0,
        upsertedChunks: 0,
        movedChunks: 0,
        deletedChunks: 0,
    };

    const mdxCount = documents.filter(d => d.type === 'mdx').length;
    const tsCount = documents.filter(d => d.type === 'typescript').length;
    const pyCount = documents.filter(d => d.type === 'python').length;
    const rustCount = documents.filter(d => d.type === 'rust').length;
    ingestionLogger.info(`Processing ${documents.length} document${documents.length === 1 ? "" : "s"} (${mdxCount} MDX, ${tsCount} TypeScript, ${pyCount} Python, ${rustCount} Rust).`);

    const targetState = new Map<string, TargetChunkLocation>();
    const allChecksums: string[] = [];
    const documentMap = new Map<string, GithubDocument>(); // filepath -> document
    const documentChunksMap = new Map<string, { chunks: UnifiedChunk[]; parsedFile?: ParsedFile | ParsedPythonFile | ParsedRustFile }>(); // filepath -> {chunks, parsedFile}

    for (const document of documents) {
        const filepath = document.relativePath || document.path;
        const fileLogger = typeof ingestionLogger.child === "function"
            ? ingestionLogger.child({ file: filepath })
            : ingestionLogger;

        documentMap.set(filepath, document);

        if (document.type === 'mdx') {
            const rawChunks = chunkMdxFile(document.content);
            const preparedChunks = enforceChunkTokenLimit(rawChunks, {
                tokenLimit: chunkTokenLimit,
                model: llm.embedding.config.model,
            });

            if (preparedChunks.length === 0) {
                stats.skippedDocuments += 1;
                fileLogger.warn("No chunks were generated for this document. Skipping.");
                continue;
            }

            const additionalChunks = preparedChunks.length - rawChunks.length;
            if (additionalChunks > 0) {
                fileLogger.info(
                    `Split ${additionalChunks} oversized chunk${additionalChunks === 1 ? "" : "s"} to respect the ${chunkTokenLimit} token embedding limit.`
                );
            }

            stats.processedDocuments += 1;
            documentChunksMap.set(filepath, {
                chunks: preparedChunks.map(chunk => ({ sourceType: 'doc' as const, chunk })),
            });

            preparedChunks.forEach((chunk, index) => {
                const links = resolveSourceLinks(filepath, chunk.chunkTitle, appConfig, document.sourceUrl, document.sourceRepoConfig);
                targetState.set(chunk.checksum, {
                    filepath,
                    chunkId: index,
                    chunk: { sourceType: 'doc', chunk },
                    sourceType: 'doc',
                    githubUrl: links.githubUrl,
                });
                allChecksums.push(chunk.checksum);
            });
        } else if (document.type === 'typescript' || document.type === 'python' || document.type === 'rust') {
            let parsedFile: ParsedFile | ParsedPythonFile | ParsedRustFile;
            try {
                if (document.type === 'typescript') {
                    parsedFile = parseTypescriptFile(filepath, document.content, appConfig.parser);
                } else if (document.type === 'python') {
                    parsedFile = await parsePythonFile(filepath, document.content);
                } else {
                    parsedFile = await parseRustFile(filepath, document.content);
                }
            } catch (error) {
                fileLogger.error({ err: error }, `Failed to parse ${document.type} file. Skipping.`);
                stats.skippedDocuments += 1;
                continue;
            }

            const chunkedFile = chunkParsedFile(parsedFile, {
                tokenLimit: chunkTokenLimit,
                model: llm.embedding.config.model,
            });

            if (chunkedFile.chunks.length === 0) {
                stats.skippedDocuments += 1;
                fileLogger.warn("No entities were generated for this document. Skipping.");
                continue;
            }

            stats.processedDocuments += 1;
            const sourceType: 'code' = 'code';
            documentChunksMap.set(filepath, {
                chunks: chunkedFile.chunks.map(chunk => ({ sourceType, chunk })),
                parsedFile,
            });

            chunkedFile.chunks.forEach((chunk, index) => {
                const links = resolveSourceLinks(filepath, chunk.qualifiedName, appConfig, document.sourceUrl, document.sourceRepoConfig);
                targetState.set(chunk.checksum, {
                    filepath,
                    chunkId: index,
                    chunk: { sourceType, chunk },
                    sourceType,
                    githubUrl: links.githubUrl,
                });
                allChecksums.push(chunk.checksum);
            });
        }
    }

    if (targetState.size === 0) {
        ingestionLogger.info("No chunks to process. Ingestion pipeline complete.");
        return { documents, stats };
    }

    const uniqueChecksums = [...new Set(allChecksums)];
    const existingByChecksum = await store.fetchChunksByChecksums(uniqueChecksums);

    ingestionLogger.info(
        `Found ${existingByChecksum.size} existing checksum${existingByChecksum.size === 1 ? "" : "s"} in the database.`
    );

    const classifications: ChunkClassification[] = [];
    const alreadyAssignedDbIds = new Set<number>();
    const assignedTargetLocations = new Set<string>();

    function normalizeSourceType(sourceType?: string): 'doc' | 'code' | undefined {
        if (!sourceType) return undefined;
        if (sourceType === 'code' || sourceType === 'doc') return sourceType;
        if (sourceType === 'typescript' || sourceType === 'python' || sourceType === 'rust') return 'code';
        if (sourceType === 'mdx') return 'doc';
        return undefined;
    }

    for (const [checksum, target] of targetState.entries()) {
        const targetLocationKey = `${target.filepath}:${target.chunkId}:${target.sourceType}`;
        
        if (assignedTargetLocations.has(targetLocationKey)) {
            continue;
        }
        
        const dbChunksWithSameChecksum = existingByChecksum.get(checksum);

        if (dbChunksWithSameChecksum && dbChunksWithSameChecksum.length > 0) {
            const alreadyInPlace = dbChunksWithSameChecksum.find(
                (dbChunk) => 
                    !dbChunk.filepath.startsWith("__moving__") &&
                    dbChunk.filepath === target.filepath && 
                    dbChunk.chunkId === target.chunkId &&
                    normalizeSourceType(dbChunk.sourceType) === normalizeSourceType(target.sourceType) &&
                    !alreadyAssignedDbIds.has(dbChunk.id)
            );

            if (alreadyInPlace) {
                const needsSourceTypeUpdate = 
                    normalizeSourceType(alreadyInPlace.sourceType) === normalizeSourceType(target.sourceType) &&
                    alreadyInPlace.sourceType !== target.sourceType;
                
                if (needsSourceTypeUpdate) {
                    classifications.push({
                        type: "moved",
                        existingId: alreadyInPlace.id,
                        newFilepath: target.filepath,
                        newChunkId: target.chunkId,
                        newSourceType: target.sourceType,
                        newGithubUrl: target.githubUrl,
                    });
                    alreadyAssignedDbIds.add(alreadyInPlace.id);
                    assignedTargetLocations.add(targetLocationKey);
                } else {
                    classifications.push({ type: "unchanged", existingId: alreadyInPlace.id });
                    alreadyAssignedDbIds.add(alreadyInPlace.id);
                    assignedTargetLocations.add(targetLocationKey);
                }
                } else {
                    const reusableDbChunk = dbChunksWithSameChecksum.find(
                        (dbChunk) => 
                            !alreadyAssignedDbIds.has(dbChunk.id) &&
                            dbChunk.filepath.startsWith("__moving__")
                    ) || dbChunksWithSameChecksum.find(
                        (dbChunk) => !alreadyAssignedDbIds.has(dbChunk.id)
                    );

                    if (reusableDbChunk) {
                        if (assignedTargetLocations.has(targetLocationKey)) {
                            ingestionLogger.warn(
                                `Target location ${targetLocationKey} already assigned, skipping move for chunk ${reusableDbChunk.id}`
                            );
                            continue;
                        }
                        
                        classifications.push({
                            type: "moved",
                            existingId: reusableDbChunk.id,
                            newFilepath: target.filepath,
                            newChunkId: target.chunkId,
                            newSourceType: target.sourceType,
                            newGithubUrl: target.githubUrl,
                        });
                        alreadyAssignedDbIds.add(reusableDbChunk.id);
                        assignedTargetLocations.add(targetLocationKey);
                    } else {
                        if (assignedTargetLocations.has(targetLocationKey)) {
                            ingestionLogger.warn(
                                `Target location ${targetLocationKey} already assigned, skipping new chunk creation`
                            );
                            continue;
                        }
                        
                        classifications.push({
                            type: "new",
                            chunk: target.chunk,
                            filepath: target.filepath,
                            chunkId: target.chunkId,
                            sourceType: target.sourceType,
                            githubUrl: target.githubUrl,
                        });
                        assignedTargetLocations.add(targetLocationKey);
                    }
                }
        } else {
            classifications.push({
                type: "new",
                chunk: target.chunk,
                filepath: target.filepath,
                chunkId: target.chunkId,
                sourceType: target.sourceType,
                githubUrl: target.githubUrl,
            });
            assignedTargetLocations.add(targetLocationKey);
        }
    }

    const activeChecksums = new Set(targetState.keys());
    const normalizeGithubUrl = (url: string | undefined): string | null => {
        if (!url) return null;
        return url.split('#')[0];
    };
    
    const activeGithubUrls = new Set<string>();
    for (const target of targetState.values()) {
        const normalizedUrl = normalizeGithubUrl(target.githubUrl);
        if (normalizedUrl) {
            activeGithubUrls.add(normalizedUrl);
        }
    }
    
    ingestionLogger.info(
        `Orphan detection: ${activeChecksums.size} active checksum${activeChecksums.size === 1 ? "" : "s"} and ${activeGithubUrls.size} active github_url${activeGithubUrls.size === 1 ? "" : "s"} in target state.`
    );
    
    const repositoryBaseUrls = new Set<string>();
    const repositoryIdentifiers = new Set<string>();
    const githubConfig = appConfig.github;
    const branch = githubConfig.branch || 'main';
    
    const urlsToCheck: string[] = [];
    
    if (githubConfig.githubUrl) urlsToCheck.push(githubConfig.githubUrl);
    if (githubConfig.codeUrl) urlsToCheck.push(githubConfig.codeUrl);
    if (githubConfig.docsUrl) urlsToCheck.push(githubConfig.docsUrl);
    
    if (githubConfig.codeRepos) {
        for (const repo of githubConfig.codeRepos) {
            urlsToCheck.push(repo.url);
        }
    }
    
    if (githubConfig.docsRepos) {
        for (const repo of githubConfig.docsRepos) {
            urlsToCheck.push(repo.url);
        }
    }
    
    for (const url of urlsToCheck) {
        try {
            const parsed = parseGithubUrl(url);
            const repoIdentifier = `${parsed.owner}/${parsed.repo}`;
            repositoryIdentifiers.add(repoIdentifier);
            
            const repoBranch = parsed.branch || branch;
            const baseUrl = `https://github.com/${parsed.owner}/${parsed.repo}/blob/${repoBranch}/`;
            repositoryBaseUrls.add(baseUrl);
            
            ingestionLogger.debug(`Added repository base URL for orphan detection: ${baseUrl}`);
        } catch (error) {
            ingestionLogger.warn({ err: error, url }, "Failed to parse GitHub URL for repository scoping");
        }
    }
    
    ingestionLogger.info(
        `Orphan detection: Scoping to ${repositoryBaseUrls.size} repository${repositoryBaseUrls.size === 1 ? "" : "s"}: ${Array.from(repositoryIdentifiers).join(", ")}`
    );
    
    if (repositoryBaseUrls.size === 0) {
        ingestionLogger.warn(
            "Could not parse any GitHub repository URLs. Skipping orphan chunk detection to prevent accidental deletion of chunks from other repositories."
        );
    }
    
    const movedChunks = classifications.filter(
        (c): c is Extract<ChunkClassification, { type: "moved" }> => c.type === "moved"
    );

    if (movedChunks.length > 0) {
        ingestionLogger.info(`Moving ${movedChunks.length} chunk${movedChunks.length === 1 ? "" : "s"} to new locations.`);
        await store.moveChunksAtomic(
            movedChunks.map((c) => ({
                id: c.existingId,
                filepath: c.newFilepath,
                chunkId: c.newChunkId,
                sourceType: c.newSourceType,
                githubUrl: c.newGithubUrl,
            }))
        );
        stats.movedChunks = movedChunks.length;
    }

    const orphanedIds = repositoryBaseUrls.size > 0
        ? await store.findOrphanedChunkIds(activeChecksums, repositoryBaseUrls, activeGithubUrls)
        : [];

    const strandedChunkIds = repositoryIdentifiers.size > 0
        ? await store.findStrandedChunkIds(activeChecksums, repositoryIdentifiers)
        : [];

    const chunksToDelete = [...new Set([...orphanedIds, ...strandedChunkIds])];
    if (chunksToDelete.length > 0) {
        const orphanedCount = orphanedIds.length;
        const strandedCount = strandedChunkIds.length;
        if (strandedCount > 0) {
            ingestionLogger.info(`Deleting ${strandedCount} stranded chunk${strandedCount === 1 ? "" : "s"} in temporary locations.`);
        }
        if (orphanedCount > 0) {
            ingestionLogger.info(`Deleting ${orphanedCount} orphaned chunk${orphanedCount === 1 ? "" : "s"}.`);
        }
        await store.deleteChunksByIds(chunksToDelete);
        stats.deletedChunks = chunksToDelete.length;
    }

    const newChunks = classifications.filter(
        (c): c is Extract<ChunkClassification, { type: "new" }> => c.type === "new"
    );

    if (newChunks.length === 0) {
        ingestionLogger.info("No new chunks required embeddings. Ingestion pipeline complete.");
        return { documents, stats };
    }

    const newChunksByFilepath = new Map<string, Array<{ chunk: UnifiedChunk; chunkId: number; sourceType: 'doc' | 'code'; githubUrl?: string }>>();
    for (const c of newChunks) {
        const existing = newChunksByFilepath.get(c.filepath) ?? [];
        existing.push({ chunk: c.chunk, chunkId: c.chunkId, sourceType: c.sourceType, githubUrl: c.githubUrl });
        newChunksByFilepath.set(c.filepath, existing);
    }

    const pendingEmbeddings: PendingEmbeddingChunk[] = [];
    const contextTasks: Promise<void>[] = [];

    for (const [filepath, chunks] of newChunksByFilepath.entries()) {
        const document = documentMap.get(filepath);

        if (!document) {
            ingestionLogger.warn(`Document for filepath ${filepath} not found. Skipping context generation.`);
            continue;
        }

        const fileLogger = typeof ingestionLogger.child === "function"
            ? ingestionLogger.child({ file: filepath })
            : ingestionLogger;

        fileLogger.info(
            `Generating context for ${chunks.length} new chunk${chunks.length === 1 ? "" : "s"}.`
        );

        const sourceType: 'doc' | 'code' =
            chunks[0]?.sourceType ?? (document.type === 'mdx' ? 'doc' : 'code');
        const fileEntry = documentChunksMap.get(filepath);

        if (sourceType === 'doc') {
            const chunkContents = chunks.map((entry) => {
                if (entry.chunk.sourceType === 'doc') {
                    return entry.chunk.chunk.chunkContent;
                }
                throw new Error(`Mismatched chunk type for MDX file ${filepath}`);
            });
            const contextTask = llm.chat
                .generateFileChunkContexts(chunkContents, document.content)
                .then((contexts) => {
                    if (contexts.length !== chunks.length) {
                        throw new Error(
                            `Context generation returned ${contexts.length} entries for ${chunks.length} chunks in ${filepath}.`
                        );
                    }

                    chunks.forEach((entry, index) => {
                        if (entry.chunk.sourceType === 'doc') {
                            const contextHeader = contexts[index]?.trim() ?? "";
                            const contextualText = `${contextHeader}---${entry.chunk.chunk.chunkContent}`;
                            const links = resolveSourceLinks(filepath, entry.chunk.chunk.chunkTitle, appConfig, document.sourceUrl, document.sourceRepoConfig);
                            pendingEmbeddings.push({
                                filepath,
                                chunkId: entry.chunkId,
                                chunkTitle: entry.chunk.chunk.chunkTitle,
                                checksum: entry.chunk.chunk.checksum,
                                content: entry.chunk.chunk.chunkContent,
                                contextualText,
                                sourceType: 'doc',
                                githubUrl: links.githubUrl,
                            });
                        }
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
        } else if (sourceType === 'code') {
            const parsedFile = fileEntry?.parsedFile;
            if (!parsedFile) {
                fileLogger.warn(`Parsed file entry for ${filepath} not found. Skipping context generation.`);
                continue;
            }

            const entityInputs: EntityContextInput[] = chunks.map((entry) => {
                if (entry.chunk.sourceType === 'code') {
                    const codeChunk = entry.chunk.chunk;
                    const baseQualifiedName = codeChunk.qualifiedName.split('_part')[0];
                    const originalEntity = (parsedFile as any).entities.find(
                        (e: { qualifiedName: string }) => e.qualifiedName === baseQualifiedName
                    );

                    return {
                        entityCode: codeChunk.content,
                        entityType: codeChunk.entityType,
                        entityName: (originalEntity as any)?.name ?? codeChunk.qualifiedName,
                        qualifiedName: (originalEntity as any)?.qualifiedName ?? codeChunk.qualifiedName,
                        fullFileContent: document.content,
                        parentContext: (originalEntity as any)?.parentContext,
                        jsDoc: (originalEntity as any)?.jsDoc ?? (originalEntity as any)?.docstring,
                        imports: (parsedFile as any).imports,
                        parameters: (originalEntity as any)?.parameters,
                        returnType: (originalEntity as any)?.returnType,
                    };
                }
                throw new Error(`Mismatched chunk type for code file ${filepath}`);
            });

            const entityLineRanges = chunks
                .filter(entry => entry.chunk.sourceType === 'code')
                .map(entry => {
                    const chunk = entry.chunk.chunk as { startLine?: number; endLine?: number };
                    return {
                        startLine: chunk.startLine ?? 1,
                        endLine: chunk.endLine ?? 1,
                    };
                });

            const contextTask = llm.chat
                .generateEntityContexts(entityInputs, document.content, filepath, entityLineRanges)
                .then((contexts) => {
                    if (contexts.length !== chunks.length) {
                        throw new Error(
                            `Context generation returned ${contexts.length} entries for ${chunks.length} chunks in ${filepath}.`
                        );
                    }

                    chunks.forEach((entry, index) => {
                        if (entry.chunk.sourceType === 'code') {
                            const contextHeader = contexts[index]?.trim() ?? "";
                            const contextualText = contextHeader
                                ? `${contextHeader}\n---\n${entry.chunk.chunk.content}`
                                : entry.chunk.chunk.content;
                            pendingEmbeddings.push({
                                filepath,
                                chunkId: entry.chunkId,
                                chunkTitle: entry.chunk.chunk.qualifiedName,
                                checksum: entry.chunk.chunk.checksum,
                                content: entry.chunk.chunk.content,
                                contextualText,
                                sourceType: 'code',
                                entityType: entry.chunk.chunk.entityType,
                                startLine: entry.chunk.chunk.startLine,
                                endLine: entry.chunk.chunk.endLine,
                                githubUrl: entry.githubUrl,
                            });
                        }
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
    }

    await Promise.all(contextTasks);

    ingestionLogger.info(`Embedding ${pendingEmbeddings.length} chunk${pendingEmbeddings.length === 1 ? "" : "s"} using ${llm.embedding.config.provider}.`);

    const embeddings = await llm.embedding.embedDocuments(
        pendingEmbeddings.map((entry) => entry.contextualText)
    );

    if (embeddings.length !== pendingEmbeddings.length) {
        throw new Error(
            `Embedding generation returned ${embeddings.length} vectors for ${pendingEmbeddings.length} chunks.`
        );
    }

    const upsertPayload: DocumentChunk[] = pendingEmbeddings.map((entry, index) => {
        const document = documentMap.get(entry.filepath);
        const sourceUrl = document?.sourceUrl ?? entry.githubUrl;
        const links = resolveSourceLinks(
            entry.filepath,
            entry.chunkTitle,
            appConfig,
            sourceUrl,
            document?.sourceRepoConfig
        );

        return {
            content: entry.content,
            contextualText: entry.contextualText,
            embedding: embeddings[index],
            filepath: entry.filepath,
            chunkId: entry.chunkId,
            chunkTitle: entry.chunkTitle,
            checksum: entry.checksum,
            githubUrl: links.githubUrl,
            docsUrl: links.docsUrl,
            finalUrl: links.finalUrl,
            sourceType: entry.sourceType,
            entityType: entry.entityType,
            startLine: entry.startLine,
            endLine: entry.endLine,
        };
    });

    await store.upsertChunks(upsertPayload);
    stats.upsertedChunks = pendingEmbeddings.length;

    ingestionLogger.info("Ingestion pipeline completed successfully.");

    return {
        documents,
        stats,
    };
}

