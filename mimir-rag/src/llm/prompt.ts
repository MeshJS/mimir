import type { DocumentChunk } from "../supabase/types";
import type { GenerateAnswerOptions, contextualChunkInput } from "./types";
import { z } from "zod";

const DEFAULT_SYSTEM_PROMPT = [
    "You are a MeshJS expert assistant. Help developers with MeshJS questions using the provided context.",
    "Use the documentation context to answer questions about MeshJS and Cardano development.",
    "Provide accurate code examples and explanations based on the context provided.",
    "",
    "When answering:",
    "- Give direct, helpful answers based on the context",
    "- Include relevant code examples when available",
    "- Explain concepts clearly for developers",
    "- If the context doesn't cover the question, say so clearly.",
    "- Do not invent or assume APIs, methods, or functionality not in the documentation.",
    "",
    "IMPORTANT:",
    "- Do NOT add conclusions, summary sections, or 'For more information' references at the end",
    "- Do NOT suggest referring to documentation or additional resources",
    "- Sources are handled separately by the system - just provide the answer content",
    "- End your response when the answer is complete, without extra closing remarks",
    "",
    "Be concise but thorough. Focus on practical, actionable guidance for MeshJS development.",
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
            const body = chunk.contextualText?.trim() || chunk.content.trim();
            return `${header}${title}\n${body}`;
        })
        .join("\n\n");

    // Add available sources metadata for structured output
    const availableSources = chunks.map((chunk, index) => {
        const title = chunk.chunkTitle || `${chunk.filepath}#${chunk.chunkId}`;
        const url = chunk.finalUrl || chunk.githubUrl || chunk.docsUrl || chunk.filepath;
        return `${index + 1}. filepath: "${chunk.filepath}", chunkTitle: "${title}", url: "${url}"`;
    }).join("\n");

    return `${formattedChunks}\n\n---\n\nAvailable sources (select only the sources you actually used):\n${availableSources}`.trim();
}

function formatSingleChunkContext(context: contextualChunkInput): string {
    return [
        "Full file context:",
        context.fileContent.trim(),
        "",
        "Focused chunk:",
        context.chunkContent.trim(),
    ]
        .join("\n")
        .trim();
}

function buildContext(context: GenerateAnswerOptions["context"]): string {
    if (Array.isArray(context)) {
        if (context.length === 0) {
            return "";
        }

        return formatDocumentChunks(context);
    }

    return formatSingleChunkContext(context);
}

export function buildPromptMessages(options: GenerateAnswerOptions): { system: string; user: string } {
    const system = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const formattedContext = buildContext(options.context);

    const userSections: string[] = [];
    if (formattedContext.length > 0) {
        userSections.push("Use the provided context to inform your response.", formattedContext);
    }

    userSections.push(`Prompt: ${options.prompt.trim()}`, "Answer:");

    const user = userSections.join("\n\n");

    return { system, user };
}
