import { get_encoding, encoding_for_model, Tiktoken, type TiktokenModel } from "tiktoken";

const TOKENIZER_FALLBACK = "cl100k_base";
const encoderCache = new Map<string, Tiktoken>();

/**
 * List of known special tokens that tiktoken doesn't allow in input text.
 * These tokens are used internally by models and should not appear in user input.
 */
const SPECIAL_TOKENS = [
    '<|endoftext|>',
    '<|endofprompt|>',
    '<|fim_prefix|>',
    '<|fim_middle|>',
    '<|fim_suffix|>',
    '<|start_header_id|>',
    '<|end_header_id|>',
    '<|eot_id|>',
] as const;

/**
 * Sanitize text by replacing special tokens with safe placeholders.
 * This prevents tiktoken from throwing errors when encoding text that contains
 * literal occurrences of special tokens (e.g., in source code or documentation).
 */
function sanitizeSpecialTokens(text: string): string {
    let sanitized = text;
    for (const token of SPECIAL_TOKENS) {
        // Replace special token with a placeholder that won't conflict with tiktoken
        // Using HTML entity-like encoding that preserves the original text meaning
        const placeholder = token
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\|/g, '&#124;');
        // Escape special regex characters in the token for safe replacement
        const escapedToken = token.replace(/[|<>\\]/g, '\\$&');
        sanitized = sanitized.replace(new RegExp(escapedToken, 'g'), placeholder);
    }
    return sanitized;
}

export function getEncoder(model?: string): Tiktoken {
    const key = (model ?? TOKENIZER_FALLBACK).toLocaleLowerCase();
    if(encoderCache.has(key)) {
        return encoderCache.get(key)!;
    }

    let encoder: Tiktoken;
    try {
        encoder = encoding_for_model(key as TiktokenModel);
    } catch {
        encoder = get_encoding(TOKENIZER_FALLBACK);
    }

    encoderCache.set(key, encoder);
    return encoder;
}

export function countTokens(chunk: string, model?: string): number {
    if(!chunk) return 0;
    try {
        // Sanitize special tokens before encoding to prevent errors
        const sanitized = sanitizeSpecialTokens(chunk);
        return getEncoder(model).encode(sanitized).length;
    } catch (error) {
        // Fall back to character-based estimate if encoding still fails
        // Rough estimate: ~4 characters per token for English code
        // This is a conservative estimate to avoid underestimating token counts
        return Math.ceil(chunk.length / 4);
    }
}

export function countTokensInBatch(chunks: string[], model?: string): number {
    return chunks.reduce((sum, current) => sum + countTokens(current, model), 0);
}