import type { DocumentChunk } from "../supabase/types";
import type { GenerateAnswerOptions, contextualChunkInput } from "./types";

const DEFAULT_SYSTEM_PROMPT = [
    "You are a meticulous assistant that answers questions using the provided documentation context.",
    "Use only the supplied context to craft your answer.",
    "If the answer cannot be determined from the context, say you do not know.",
].join(" ");

function formatDocumentChunks(chunks: DocumentChunk[]): string {
    return chunks
        .map((chunk, index) => {
            const header = `Source ${index + 1}: ${chunk.filepath}#${chunk.chunkId}`;
            const title = chunk.chunkTitle ? ` (${chunk.chunkTitle})` : "";
            const body = chunk.contextualText?.trim() || chunk.content.trim();
            return `${header}${title}\n${body}`;
        })
        .join("\n\n")
        .trim();
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
