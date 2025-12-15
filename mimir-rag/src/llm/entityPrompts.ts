import type { EntityContextInput } from "./types";

const ENTITY_CONTEXT_SYSTEM_PROMPT = `You are a code documentation expert. Your task is to generate concise, informative context descriptions for code entities (for example, TypeScript or Python).

For each code entity provided, write a short context (100-200 tokens) that:
1. Explains the entity's purpose and role in the codebase
2. Describes key parameters, return types, or properties
3. Notes any important dependencies or relationships with other code
4. Highlights any notable patterns or design decisions

The context should help someone searching for this code understand what it does without reading the full implementation.

Be precise and technical. Focus on WHAT the code does and WHY, not HOW (the code itself shows that).`;

export function buildEntityContextPrompt(entity: EntityContextInput): string {
    const parts: string[] = [];

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

    parts.push(`\nCode:\n\`\`\`typescript\n${entity.entityCode}\n\`\`\``);

    return parts.join("\n");
}

export function buildBatchContextPrompt(entities: EntityContextInput[], fileContent: string): string {
    const entitySections = entities.map((entity, index) => {
        return `--- Entity ${index + 1} ---\n${buildEntityContextPrompt(entity)}`;
    }).join("\n\n");

    return `Generate context descriptions for the following ${entities.length} code entities from the same file.

File Context (truncated if large):
\`\`\`
${truncateFileContent(fileContent, 2000)}
\`\`\`

${entitySections}

For each entity, provide a concise context description (100-200 tokens) that explains its purpose, key characteristics, and relationships. Format your response as a numbered list matching the entity numbers above.`;
}

function truncateFileContent(content: string, maxChars: number): string {
    if (content.length <= maxChars) {
        return content;
    }

    // Try to cut at a reasonable point
    const truncated = content.slice(0, maxChars);
    const lastNewline = truncated.lastIndexOf("\n");
    
    if (lastNewline > maxChars * 0.8) {
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

