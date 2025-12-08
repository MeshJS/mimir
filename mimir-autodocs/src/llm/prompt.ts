import type { DocumentChunk } from "../supabase/types";
import type { GenerateAnswerOptions } from "./types";
import { z } from "zod";

const DEFAULT_SYSTEM_PROMPT = [
    "You are a TypeScript code expert assistant. Help developers understand code by analyzing the provided code context.",
    "Use the code context to answer questions about functions, classes, interfaces, and how the code works.",
    "Provide accurate explanations and code examples based on the context provided.",
    "",
    "When answering:",
    "- Explain what the code does and how it works",
    "- Include relevant code snippets when helpful",
    "- Explain concepts clearly for developers",
    "- If the context doesn't cover the question, say so clearly.",
    "- Do not invent or assume functionality not in the code context.",
    "",
    "IMPORTANT:",
    "- Do NOT add conclusions, summary sections, or 'For more information' references at the end",
    "- Do NOT suggest referring to documentation or additional resources",
    "- Sources are handled separately by the system - just provide the answer content",
    "- End your response when the answer is complete, without extra closing remarks",
    "",
    "Be concise but thorough. Focus on practical, actionable guidance for understanding the codebase.",
].join(" ");

export const sourceSchema = z.object({
    filepath: z.string().describe("The file path of the source"),
    chunkTitle: z.string().describe("The title or description of the source chunk"),
    url: z.string().optional().describe("The URL to access the source"),
});

export const answerWithSourcesSchema = z.object({
    sources: z.array(sourceSchema).describe("Array of sources that were used to generate the answer. Provide this FIRST."),
    answer: z.string().describe("The answer to the user's question"),
});

function formatDocumentChunks(chunks: DocumentChunk[]): string {
    const formattedChunks = chunks
        .map((chunk, index) => {
            const header = `Source ${index + 1}: ${chunk.filepath}#${chunk.chunkId}`;
            const title = chunk.chunkTitle ? ` (${chunk.chunkTitle})` : "";
            const entityType = chunk.entityType ? ` [${chunk.entityType}]` : "";
            const body = chunk.contextualText?.trim() || chunk.content.trim();
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
        userSections.push("Use the provided code context to inform your response.", formattedContext);
    }

    userSections.push(`Prompt: ${options.prompt.trim()}`, "Answer:");

    const user = userSections.join("\n\n");

    return { system, user };
}

