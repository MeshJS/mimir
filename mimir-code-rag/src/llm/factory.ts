import type { Logger } from "pino";
import type { LLMConfig, ChatModelConfig, EmbeddingModelConfig } from "../config/types";
import type { ChatProvider, EmbeddingProvider, LLMClientBundle } from "./types";
import { OpenAIChatProvider, OpenAIEmbeddingProvider } from "./providers/openai";
import { GoogleChatProvider, GoogleEmbeddingProvider } from "./providers/google";
import { AnthropicChatProvider } from "./providers/anthropic";
import { MistralChatProvider, MistralEmbeddingProvider } from "./providers/mistral";

function providerLogger(
    logger: Logger | undefined,
    scope: "chat" | "embedding",
    provider: string
): Logger | undefined {
    if (!logger) {
        return undefined;
    }

    if (typeof logger.child === "function") {
        return logger.child({ module: "llm", scope, provider });
    }

    return logger;
}

export function createEmbeddingProvider(config: EmbeddingModelConfig, logger?: Logger): EmbeddingProvider {
    const scopedLogger = providerLogger(logger, "embedding", config.provider);

    switch (config.provider) {
        case "openai":
            return new OpenAIEmbeddingProvider(config, scopedLogger);
        case "google":
            return new GoogleEmbeddingProvider(config, scopedLogger);
        case "mistral":
            return new MistralEmbeddingProvider(config, scopedLogger);
        default:
            throw new Error(`Embedding provider "${config.provider}" is not supported.`);
    }
}

export function createChatProvider(config: ChatModelConfig, logger?: Logger): ChatProvider {
    const scopedLogger = providerLogger(logger, "chat", config.provider);

    switch (config.provider) {
        case "openai":
            return new OpenAIChatProvider(config, scopedLogger);
        case "google":
            return new GoogleChatProvider(config, scopedLogger);
        case "anthropic":
            return new AnthropicChatProvider(config, scopedLogger);
        case "mistral":
            return new MistralChatProvider(config, scopedLogger);
        default:
            throw new Error(`Chat provider "${config.provider}" is not supported.`);
    }
}

export function createLLMClient(config: LLMConfig, logger?: Logger): LLMClientBundle {
    return {
        embedding: createEmbeddingProvider(config.embedding, logger),
        chat: createChatProvider(config.chat, logger),
    };
}

