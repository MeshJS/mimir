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
    "When generating code:",
    "- Ensure ALL required components are included (inputs, outputs, parameters, etc.)",
    "- Verify ALL values match the specification exactly (addresses, policy IDs, names, etc.)",
    "- Include ALL referenced variables and their definitions or sources",
    "- Generate complete, runnable code - not partial snippets with undefined variables",
    "- Cross-reference all values from the provided specification to ensure accuracy",
    "- If a specification lists requirements, ensure each one is addressed in the code",
    "- Before finalizing, verify each requirement from the specification is addressed",
    "- Check that all hardcoded values (addresses, IDs, names) match the specification exactly",
    "- Ensure no variables are used without being defined or explained",
    "- Confirm all inputs and outputs mentioned in the specification are included",
    "- If the specification mentions constraints or gotchas, ensure they're handled",
    "",
    "IMPORTANT:",
    "- Do NOT add conclusions, summary sections, or 'For more information' references at the end",
    "- Do NOT suggest referring to documentation or additional resources",
    "- Sources are handled separately by the system - just provide the answer content",
    "- End your response when the answer is complete, without extra closing remarks",
    "",
    "Source Attribution - Be Strict and Selective:",
    "- Only include sources in the 'sources' array that you actually referenced or used to generate your answer",
    "- Do not include sources just because they were provided as context - only include what you used",
    "- If a source wasn't used to support any part of your answer, do not include it",
    "- Review each source carefully before including it - ask yourself: 'Did I actually use this source?'",
    "- When in doubt, exclude the source rather than include it",
    "",
    "Prioritize accuracy and completeness over brevity. When given detailed specifications, ensure every requirement is properly implemented.",
].join(" ");

export const sourceSchema = z.object({
    filepath: z.string().describe("The file path of the source"),
    chunkTitle: z.string().describe("The title or description of the source chunk"),
    url: z.string().optional().describe("The URL to access the source"),
});

export const answerWithSourcesSchema = z.object({
    sources: z.array(sourceSchema).describe("CRITICAL: This array must contain ONLY the sources you ACTUALLY USED. DO NOT include all provided sources. If you were given 10 sources but only used 2, return only those 2. Review each source: did you quote it? reference it? use its content? If NO, exclude it. Example: For 'how to install X', you typically need 1 source, not 10. Provide this FIRST."),
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
        return `${index + 1}. filepath: "${chunk.filepath}", chunkTitle: "${title}"`;
    }).join("\n");

    return `${formattedChunks}\n\n---\n\nCRITICAL SOURCE SELECTION RULES:\nYou have been provided ${chunks.length} context sources above. You MUST only include sources you ACTUALLY USED.\n\nRULES:\n1. Review each source: "Did I quote, reference, or use content from this source in my answer?"\n2. If NO → DO NOT include it in the 'sources' array\n3. If YES → Include it\n4. For simple questions (e.g., "how to install X"), you typically need 1 source, NOT ${chunks.length}\n5. Example: If asked "how to install mesh" and you found the answer in Source 3, return ONLY Source 3, not all ${chunks.length} sources\n6. When in doubt, EXCLUDE the source\n\nDO NOT include all ${chunks.length} sources just because they were provided. Only include what you actually used.\n\nAvailable sources:\n${availableSources}\n\nWhen the user provides specific values (addresses, policy IDs, names, etc.), ensure you use those exact values in your code. Cross-reference any values mentioned in the user's request with the documentation context.`.trim();
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

/**
 * Detects if a request appears to be complex (multiple requirements, specifications, etc.)
 */
function isComplexRequest(prompt: string): boolean {
    const complexityIndicators = [
        /multiple|several|various/i,
        /step|steps|process|workflow/i,
        /table|reference|quick reference/i,
        /constraint|requirement|must|should/i,
        /input|output|party|parties/i,
        /build|create|implement|generate/i,
    ];
    return complexityIndicators.some(pattern => pattern.test(prompt));
}

/**
 * Detects if a request appears to include detailed specifications
 */
function hasDetailedSpecification(prompt: string): boolean {
    return prompt.length > 500 || 
           /specification|spec|requirements|constraints|gotchas/i.test(prompt) ||
           /address|policy|id|name|value|parameter/i.test(prompt);
}

export function buildPromptMessages(options: GenerateAnswerOptions): { system: string; user: string } {
    const system = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const formattedContext = buildContext(options.context);

    const userSections: string[] = [];
    if (formattedContext.length > 0) {
        userSections.push("Use the provided context to inform your response.", formattedContext);
    }

    const userPrompt = options.prompt.trim();
    const isComplex = isComplexRequest(userPrompt);
    const hasDetailedSpec = hasDetailedSpecification(userPrompt);

    // Enhanced guidance for complex or detailed requests
    if (isComplex || hasDetailedSpec) {
        if (hasDetailedSpec) {
            userSections.push(
                "IMPORTANT: The user has provided a detailed specification. Ensure you:",
                "- Read through ALL requirements carefully",
                "- Include ALL specified values, addresses, and parameters",
                "- Generate complete code with all necessary components",
                "- Do not skip any steps or requirements mentioned",
                "- Cross-reference each value from the specification to ensure accuracy",
                ""
            );
        }
        
        if (isComplex) {
            userSections.push(
                "This appears to be a complex request with multiple requirements.",
                "Please ensure you address each requirement systematically and completely.",
                ""
            );
        }
    }

    userSections.push(`User Request: ${userPrompt}`, "", "Answer:");

    const user = userSections.join("\n\n");

    return { system, user };
}
