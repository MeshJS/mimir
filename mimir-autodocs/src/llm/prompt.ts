import type { DocumentChunk } from "../supabase/types";
import type { GenerateAnswerOptions } from "./types";
import { z } from "zod";

const DEFAULT_SYSTEM_PROMPT = [
    "You are a TypeScript code expert assistant. Help developers understand code by analyzing the provided code context.",
    "Use the code context to answer questions about functions, classes, interfaces, and how the code works.",
    "",
    "When answering, you MUST:",
    "- ALWAYS include relevant code snippets from the context in your response",
    "- Show the actual code, not just describe it",
    "- Use code blocks with proper syntax highlighting (```typescript)",
    "- Explain what the code does AND show how it works with examples",
    "- Include function signatures, class definitions, or interface structures when relevant",
    "- Show code examples that demonstrate usage patterns",
    "",
    "Response format:",
    "- Start with a brief explanation",
    "- Include code snippets from the context (use ```typescript code blocks)",
    "- Explain the code's purpose, parameters, return types, and behavior",
    "- Show practical examples of how to use the code when applicable",
    "",
    "Guidelines:",
    "- Extract and show actual code from the provided context",
    "- If explaining a function, show its signature and implementation",
    "- If explaining a class, show its structure and key methods",
    "- If explaining types/interfaces, show their definition",
    "- Make code snippets self-contained and clear",
    "- If the context doesn't cover the question, say so clearly",
    "- Do not invent or assume functionality not in the code context",
    "",
    "IMPORTANT:",
    "- Do NOT add conclusions, summary sections, or 'For more information' references at the end",
    "- Do NOT suggest referring to documentation or additional resources",
    "- Sources are handled separately by the system - just provide the answer content",
    "- End your response when the answer is complete, without extra closing remarks",
    "",
    "Be thorough and practical. Show code, explain code, help developers understand by seeing the actual implementation.",
].join(" ");

export const sourceSchema = z.object({
    filepath: z.string().describe("The file path of the source"),
    chunkTitle: z.string().describe("The title or description of the source chunk"),
    url: z.string().optional().describe("The URL to access the source"),
});

export const answerWithSourcesSchema = z.object({
    sources: z.array(sourceSchema).describe("Array of sources that were used to generate the answer. Provide this FIRST."),
    answer: z.string().describe("The answer to the user's question. MUST include code snippets in TypeScript code blocks (```typescript) showing actual code from the context. Do not just describe - show the code."),
});

function formatDocumentChunks(chunks: DocumentChunk[]): string {
    const formattedChunks = chunks
        .map((chunk, index) => {
            const header = `Source ${index + 1}: ${chunk.filepath}#${chunk.chunkId}`;
            const title = chunk.chunkTitle ? ` (${chunk.chunkTitle})` : "";
            const entityType = chunk.entityType ? ` [${chunk.entityType}]` : "";
            // Include both contextual text (which has the context header) and the raw code content
            const contextualPart = chunk.contextualText?.trim() || "";
            const codePart = chunk.content.trim();
            // If contextual text already includes the code, don't duplicate
            const body = contextualPart.includes(codePart) 
                ? contextualPart 
                : `${contextualPart}\n\nCode:\n\`\`\`typescript\n${codePart}\n\`\`\``;
            return `${header}${title}${entityType}\n${body}`;
        })
        .join("\n\n");

    // Add available sources metadata for structured output
    const availableSources = chunks.map((chunk, index) => {
        const title = chunk.chunkTitle || `${chunk.filepath}#${chunk.chunkId}`;
        const url = chunk.githubUrl || chunk.filepath;
        return `${index + 1}. filepath: "${chunk.filepath}", chunkTitle: "${title}", url: "${url}"`;
    }).join("\n");

    return `${formattedChunks}\n\n---\n\nAvailable sources (select only the sources you actually used):\n${availableSources}`.trim();
}

export function buildPromptMessages(options: GenerateAnswerOptions): { system: string; user: string } {
    const system = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const formattedContext = formatDocumentChunks(options.context);

    const userSections: string[] = [];
    if (formattedContext.length > 0) {
        userSections.push(
            "Use the provided code context to inform your response. Extract and show relevant code snippets in your answer.",
            formattedContext
        );
    }

    userSections.push(
        `Question: ${options.prompt.trim()}`,
        "",
        "Instructions:",
        "- Include actual code snippets from the context in your response",
        "- Use TypeScript code blocks (```typescript) for all code examples",
        "- Show the code, explain it, and demonstrate usage when helpful",
        "",
        "Answer:"
    );

    const user = userSections.join("\n\n");

    return { system, user };
}

