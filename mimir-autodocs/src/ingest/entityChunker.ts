import { Buffer } from "node:buffer";
import type { TypeScriptEntity, EntityType, ParsedFile } from "./astParser";
import { calculateChecksum } from "../utils/calculateChecksum";
import { countTokens, getEncoder } from "../utils/tokenEncoder";

export interface EntityChunk {
    /** Qualified name of the entity (e.g., "ClassName.methodName") */
    qualifiedName: string;
    /** Type of the entity */
    entityType: EntityType;
    /** The code content */
    content: string;
    /** SHA-256 checksum of the content */
    checksum: string;
    /** Parent context if nested (e.g., class name for methods) */
    parentContext?: string;
    /** Start line in source file (1-based) */
    startLine: number;
    /** End line in source file (1-based) */
    endLine: number;
    /** Whether the entity is exported */
    isExported: boolean;
    /** JSDoc comment if present */
    jsDoc?: string;
    /** Part number if entity was split (1-based) */
    partNumber?: number;
    /** Total parts if entity was split */
    totalParts?: number;
}

export interface ChunkerOptions {
    /** Maximum tokens per chunk */
    tokenLimit: number;
    /** Model name for tokenizer */
    model?: string;
}

export interface ChunkedFile {
    /** File path */
    filepath: string;
    /** All chunks from the file */
    chunks: EntityChunk[];
    /** Import statements (for context) */
    imports: string[];
    /** Module-level documentation */
    moduleDoc?: string;
}

/**
 * Process a parsed file and create chunks with token limits enforced
 */
export function chunkParsedFile(parsed: ParsedFile, options: ChunkerOptions): ChunkedFile {
    const chunks: EntityChunk[] = [];

    for (const entity of parsed.entities) {
        const entityChunks = createEntityChunks(entity, options);
        chunks.push(...entityChunks);
    }

    return {
        filepath: parsed.filepath,
        chunks,
        imports: parsed.imports,
        moduleDoc: parsed.moduleDoc,
    };
}

/**
 * Create chunks from a single entity, splitting if necessary
 */
function createEntityChunks(entity: TypeScriptEntity, options: ChunkerOptions): EntityChunk[] {
    const tokens = countTokens(entity.code, options.model);

    // Entity fits within limit
    if (tokens <= options.tokenLimit) {
        return [entityToChunk(entity)];
    }

    // Need to split the entity
    return splitEntity(entity, options);
}

/**
 * Convert a TypeScriptEntity to an EntityChunk
 */
function entityToChunk(entity: TypeScriptEntity, partNumber?: number, totalParts?: number): EntityChunk {
    return {
        qualifiedName: entity.qualifiedName,
        entityType: entity.entityType,
        content: entity.code,
        checksum: entity.checksum,
        parentContext: entity.parentContext,
        startLine: entity.startLine,
        endLine: entity.endLine,
        isExported: entity.isExported,
        jsDoc: entity.jsDoc,
        partNumber,
        totalParts,
    };
}

/**
 * Split an oversized entity into multiple chunks
 */
function splitEntity(entity: TypeScriptEntity, options: ChunkerOptions): EntityChunk[] {
    const { tokenLimit, model } = options;
    const lines = entity.code.split("\n");
    const newlineTokens = countTokens("\n", model);

    const parts: string[] = [];
    let currentLines: string[] = [];
    let currentTokens = 0;

    // Try to create a header with signature info for context in each part
    const signatureHeader = createSignatureHeader(entity);
    const headerTokens = signatureHeader ? countTokens(signatureHeader + "\n", model) : 0;
    const effectiveLimit = tokenLimit - headerTokens;

    const flush = () => {
        if (currentLines.length === 0) return;

        const content = currentLines.join("\n");
        if (content.trim().length > 0) {
            const partContent = signatureHeader 
                ? `${signatureHeader}\n// ... (continued)\n${content}`
                : content;
            parts.push(partContent);
        }
        currentLines = [];
        currentTokens = 0;
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineTokens = countTokens(line, model);

        // Handle oversized lines
        if (lineTokens > effectiveLimit) {
            flush();
            const oversizedParts = hardSplitLine(line, effectiveLimit, model);
            for (const part of oversizedParts) {
                const partContent = signatureHeader
                    ? `${signatureHeader}\n// ... (continued)\n${part}`
                    : part;
                parts.push(partContent);
            }
            continue;
        }

        // Skip leading empty lines in new chunks
        if (currentLines.length === 0 && line.trim().length === 0) {
            continue;
        }

        const additionalTokens = lineTokens + (currentLines.length > 0 ? newlineTokens : 0);
        if (currentTokens + additionalTokens > effectiveLimit) {
            flush();
        }

        currentLines.push(line);
        currentTokens += lineTokens + (currentLines.length === 1 ? 0 : newlineTokens);
    }

    flush();

    // If only one part, return as-is
    if (parts.length <= 1) {
        return [entityToChunk(entity)];
    }

    // Create chunks for each part
    return parts.map((content, index) => ({
        qualifiedName: `${entity.qualifiedName}_part${index + 1}`,
        entityType: entity.entityType,
        content,
        checksum: calculateChecksum(content),
        parentContext: entity.parentContext,
        startLine: entity.startLine,
        endLine: entity.endLine,
        isExported: entity.isExported,
        jsDoc: index === 0 ? entity.jsDoc : undefined, // Only include JSDoc in first part
        partNumber: index + 1,
        totalParts: parts.length,
    }));
}

/**
 * Create a signature header for split entities to provide context
 */
function createSignatureHeader(entity: TypeScriptEntity): string | null {
    const lines = entity.code.split("\n");
    
    // Try to extract just the signature (first meaningful lines up to opening brace)
    let signatureLines: string[] = [];
    let braceDepth = 0;
    
    for (const line of lines) {
        signatureLines.push(line);
        
        for (const char of line) {
            if (char === "{") braceDepth++;
            if (char === "}") braceDepth--;
        }

        // Stop after we find the opening brace of the main body
        if (braceDepth > 0) break;
    }

    // If signature is too long, just use the first line
    if (signatureLines.length > 5) {
        signatureLines = [lines[0]];
    }

    const signature = signatureLines.join("\n").trim();
    if (signature.length === 0) return null;

    return `// Entity: ${entity.qualifiedName}\n// ${entity.entityType}`;
}

/**
 * Hard split a single line that exceeds the token limit
 */
function hardSplitLine(text: string, tokenLimit: number, model?: string): string[] {
    const encoder = getEncoder(model);
    const tokens = encoder.encode(text);
    const limit = Math.max(1, tokenLimit);

    if (tokens.length === 0) return [];

    const pieces: string[] = [];
    for (let start = 0; start < tokens.length; start += limit) {
        const slice = tokens.slice(start, Math.min(tokens.length, start + limit));
        const decodedBytes = encoder.decode(slice);
        const decodedText = Buffer.from(decodedBytes).toString("utf8");
        if (decodedText.trim().length > 0) {
            pieces.push(decodedText);
        }
    }

    return pieces;
}

/**
 * Batch multiple ChunkedFiles into a flat list of chunks with file context
 */
export interface FlattenedChunk extends EntityChunk {
    /** Source file path */
    filepath: string;
    /** Index within the file */
    chunkIndex: number;
    /** File imports for context */
    fileImports: string[];
    /** File module documentation */
    fileModuleDoc?: string;
}

export function flattenChunkedFiles(files: ChunkedFile[]): FlattenedChunk[] {
    const flattened: FlattenedChunk[] = [];

    for (const file of files) {
        file.chunks.forEach((chunk, index) => {
            flattened.push({
                ...chunk,
                filepath: file.filepath,
                chunkIndex: index,
                fileImports: file.imports,
                fileModuleDoc: file.moduleDoc,
            });
        });
    }

    return flattened;
}

/**
 * Calculate statistics about chunking results
 */
export interface ChunkingStats {
    totalFiles: number;
    totalEntities: number;
    totalChunks: number;
    splitEntities: number;
    averageChunksPerFile: number;
    entityTypeBreakdown: Record<EntityType, number>;
}

export function calculateChunkingStats(files: ChunkedFile[]): ChunkingStats {
    const entityTypeBreakdown: Record<string, number> = {};
    let totalEntities = 0;
    let totalChunks = 0;
    let splitEntities = 0;

    for (const file of files) {
        for (const chunk of file.chunks) {
            totalChunks++;
            entityTypeBreakdown[chunk.entityType] = (entityTypeBreakdown[chunk.entityType] ?? 0) + 1;

            // Count unique entities (not parts)
            if (!chunk.partNumber || chunk.partNumber === 1) {
                totalEntities++;
            }

            // Count split entities
            if (chunk.partNumber === 1 && chunk.totalParts && chunk.totalParts > 1) {
                splitEntities++;
            }
        }
    }

    return {
        totalFiles: files.length,
        totalEntities,
        totalChunks,
        splitEntities,
        averageChunksPerFile: files.length > 0 ? totalChunks / files.length : 0,
        entityTypeBreakdown: entityTypeBreakdown as Record<EntityType, number>,
    };
}

