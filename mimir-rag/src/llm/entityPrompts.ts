import type { EntityContextInput } from "./types";

const ENTITY_CONTEXT_SYSTEM_PROMPT = `You are a code documentation expert. Your task is to generate concise, informative context descriptions for code entities.

For each code entity, provide a short succinct context that:
1. Explains what the code entity does and its purpose
2. Situates the entity within the overall document (where it fits, its role in the file)

The context should help improve search retrieval by clearly describing what the entity does and how it fits into the larger codebase context.

Be precise and succinct. Focus on WHAT the code does and WHERE it fits, not HOW (the code itself shows that).`;

/**
 * Determine programming language from filepath
 */
function getLanguageFromFilepath(filepath?: string): string {
    if (!filepath) return "typescript"; // Default fallback
    
    const lower = filepath.toLowerCase();
    if (lower.endsWith(".py")) return "python";
    if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
    if (lower.endsWith(".js") || lower.endsWith(".jsx")) return "javascript";
    if (lower.endsWith(".rs")) return "rust";
    if (lower.endsWith(".go")) return "go";
    if (lower.endsWith(".java")) return "java";
    if (lower.endsWith(".cpp") || lower.endsWith(".cc") || lower.endsWith(".cxx")) return "cpp";
    if (lower.endsWith(".c")) return "c";
    
    return "typescript"; // Default fallback
}

export function buildEntityContextPrompt(entity: EntityContextInput, filepath?: string): string {
    const parts: string[] = [];
    const language = getLanguageFromFilepath(filepath);

    parts.push(`Entity Type: ${entity.entityType}`);
    parts.push(`Entity Name: ${entity.entityName}`);
    
    if (entity.parentContext) {
        parts.push(`Parent: ${entity.parentContext}`);
    }

    if (entity.jsDoc) {
        parts.push(`\nExisting JSDoc:\n${entity.jsDoc}`);
    }

    if (entity.imports && entity.imports.length > 0) {
        parts.push(`\nRelevant Imports:\n${entity.imports.slice(0, 10).join("\n")}`);
    }

    parts.push(`\nCode:\n\`\`\`${language}\n${entity.entityCode}\n\`\`\``);

    return parts.join("\n");
}

export function buildBatchContextPrompt(
    entities: EntityContextInput[], 
    fileContent: string, 
    filepath?: string,
    entityLineRanges?: Array<{ startLine: number; endLine: number }>
): string {
    const language = getLanguageFromFilepath(filepath);
    const entitySections = entities.map((entity, index) => {
        const lineRange = entityLineRanges?.[index];
        const lineInfo = lineRange ? ` (lines ${lineRange.startLine}-${lineRange.endLine})` : "";
        return `--- Entity ${index + 1}${lineInfo} ---\n${buildEntityContextPrompt(entity, filepath)}`;
    }).join("\n\n");

    return `Generate context descriptions for the following ${entities.length} code entities from the same file.

File Context:
\`\`\`${language}
${fileContent}
\`\`\`

${entitySections}

For each entity, please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. The context should explain what the code entity does, its purpose, and where it fits within the document. Answer only with the succinct context and nothing else. Format your response as a numbered list matching the entity numbers above.`;
}


export function getEntityContextSystemPrompt(): string {
    return ENTITY_CONTEXT_SYSTEM_PROMPT;
}

/**
 * Parse numbered response into individual context strings
 */
export function parseNumberedResponse(response: string, expectedCount: number): string[] {
    const contexts: string[] = [];
    
    // Try to parse numbered format: "1. ...", "2. ...", etc.
    const lines = response.split("\n");
    let currentNumber = 0;
    let currentContent: string[] = [];

    const flushCurrent = () => {
        if (currentContent.length > 0) {
            contexts.push(currentContent.join("\n").trim());
            currentContent = [];
        }
    };

    for (const line of lines) {
        // Check for numbered line (e.g., "1.", "2.", "1:", "2:")
        const numberMatch = line.match(/^(\d+)[.:\)]\s*/);
        
        if (numberMatch) {
            const num = parseInt(numberMatch[1], 10);
            if (num !== currentNumber) {
                flushCurrent();
                currentNumber = num;
            }
            // Add the rest of the line after the number
            const content = line.slice(numberMatch[0].length).trim();
            if (content) {
                currentContent.push(content);
            }
        } else if (currentNumber > 0 && line.trim()) {
            // Continue current entry
            currentContent.push(line.trim());
        }
    }

    flushCurrent();

    // If parsing failed, fall back to splitting by double newlines
    if (contexts.length === 0 || contexts.length !== expectedCount) {
        const sections = response.split(/\n\n+/);
        if (sections.length >= expectedCount) {
            return sections.slice(0, expectedCount).map(s => s.trim());
        }
        
        // Last resort: return the whole response for each entity
        return Array(expectedCount).fill(response.trim());
    }

    return contexts;
}

