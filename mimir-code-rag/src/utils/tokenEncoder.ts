import { get_encoding, encoding_for_model, Tiktoken, type TiktokenModel } from "tiktoken";

const TOKENIZER_FALLBACK = "cl100k_base";
const encoderCache = new Map<string, Tiktoken>();

export function getEncoder(model?: string): Tiktoken {
    const key = (model ?? TOKENIZER_FALLBACK).toLocaleLowerCase();
    if (encoderCache.has(key)) {
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
    if (!chunk) return 0;
    return getEncoder(model).encode(chunk).length;
}

export function countTokensInBatch(chunks: string[], model?: string): number {
    return chunks.reduce((sum, current) => sum + countTokens(current, model), 0);
}

