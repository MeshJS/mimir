import type { AppConfig } from "../../config/types";
import type { LLMClientBundle } from "../../llm/types";
import type { PostgresVectorStore } from "../../database/client";

export interface ServerContext {
    config: AppConfig;
    llm: LLMClientBundle;
    store: PostgresVectorStore;
    ingestionBusy: boolean;
}

export interface RouterContext {
    config: AppConfig;
    llm: LLMClientBundle;
    store: PostgresVectorStore;
    ingestionBusy: boolean;
    setIngestionBusy: (busy: boolean) => void;
}

export function createRouterContext(context: ServerContext): RouterContext {
    return {
        config: context.config,
        llm: context.llm,
        store: context.store,
        ingestionBusy: context.ingestionBusy,
        setIngestionBusy: (busy: boolean) => {
            context.ingestionBusy = busy;
        },
    };
}
