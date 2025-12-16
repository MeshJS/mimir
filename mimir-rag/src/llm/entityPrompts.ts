import type { EntityContextInput } from "./types";
import { countTokens } from "../utils/tokenEncoder";

const ENTITY_CONTEXT_SYSTEM_PROMPT = `You are a code documentation expert. Your task is to generate concise, informative context descriptions for code entities (for example, TypeScript or Python).

For each code entity provided, write a short context (100-200 tokens) that:
1. Explains the entity's purpose and role in the codebase
2. Describes key parameters, return types, or properties
3. Notes any important dependencies or relationships with other code
4. Highlights any notable patterns or design decisions

The context should help someone searching for this code understand what it does without reading the full implementation.

Be precise and technical. Focus on WHAT the code does and WHY, not HOW (the code itself shows that).`;

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

export function buildBatchContextPrompt(entities: EntityContextInput[], fileContent: string, filepath?: string, model?: string): string {
    const language = getLanguageFromFilepath(filepath);
    const entitySections = entities.map((entity, index) => {
        return `--- Entity ${index + 1} ---\n${buildEntityContextPrompt(entity, filepath)}`;
    }).join("\n\n");

    // Use token-based truncation with a generous limit (16000 tokens)
    // Modern chat models support 128k+ tokens, so this is conservative but reasonable
    const MAX_FILE_CONTEXT_TOKENS = 16000;
    const truncatedContent = truncateFileContentByTokens(fileContent, MAX_FILE_CONTEXT_TOKENS, model);

    return `Generate context descriptions for the following ${entities.length} code entities from the same file.

File Context (truncated if large):
\`\`\`${language}
${truncatedContent}
\`\`\`

${entitySections}

For each entity, provide a concise context description (100-200 tokens) that explains its purpose, key characteristics, and relationships. Format your response as a numbered list matching the entity numbers above.`;
}

/**
 * Truncate file content by tokens instead of characters
 * This allows us to use much more of the available context window
 * Uses a more efficient approach: estimate character-to-token ratio and refine
 */
function truncateFileContentByTokens(content: string, maxTokens: number, model?: string): string {
    const contentTokens = countTokens(content, model);
    
    if (contentTokens <= maxTokens) {
        return content;
    }

    // Estimate character-to-token ratio from a sample
    const sampleSize = Math.min(1000, content.length);
    const sample = content.slice(0, sampleSize);
    const sampleTokens = countTokens(sample, model);
    const ratio = sampleTokens > 0 ? sampleSize / sampleTokens : 4; // Default ~4 chars per token
    
    // Estimate target length, then refine
    let estimatedLength = Math.floor(maxTokens * ratio * 0.9); // Use 90% to be safe
    estimatedLength = Math.min(estimatedLength, content.length);
    
    let truncated = content.slice(0, estimatedLength);
    let tokens = countTokens(truncated, model);
    
    // Refine: if too short, expand; if too long, shrink
    if (tokens < maxTokens * 0.95) {
        // Expand if we have room
        const remaining = content.slice(estimatedLength);
        const remainingTokens = countTokens(remaining, model);
        const canAdd = maxTokens - tokens;
        
        if (canAdd > 0 && remainingTokens > 0) {
            // Estimate how much more we can add
            const addRatio = remaining.length / remainingTokens;
            const addLength = Math.floor(canAdd * addRatio * 0.9);
            const newLength = Math.min(estimatedLength + addLength, content.length);
            truncated = content.slice(0, newLength);
            tokens = countTokens(truncated, model);
        }
    }
    
    // If still too long, binary search to find exact point
    if (tokens > maxTokens) {
        let left = 0;
        let right = truncated.length;
        
        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            const test = content.slice(0, mid);
            const testTokens = countTokens(test, model);
            
            if (testTokens <= maxTokens) {
                left = mid + 1;
                truncated = test;
                tokens = testTokens;
            } else {
                right = mid;
            }
        }
    }

    // Try to cut at a reasonable point (line boundary)
    const lastNewline = truncated.lastIndexOf("\n");
    
    if (lastNewline > truncated.length * 0.8) {
        return truncated.slice(0, lastNewline) + "\n// ... (file truncated)";
    }

    return truncated + "\n// ... (file truncated)";
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

