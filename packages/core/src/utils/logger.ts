import pino, { type Logger } from "pino";
import type { LoggingConfig } from "../config/types";

let loggerInstance: Logger | null = null;

export function configureLogger(config: LoggingConfig) {
    loggerInstance = pino({
        level: config.level,
        base: undefined,
        transport: config.pretty
            ?   {
                    target: "pino-pretty",
                    options: {
                        colorize: true,
                        translateTime: "SYS:standard",
                    }
                }
            : undefined,
    });
}


export function getLogger(): Logger {
    if(!loggerInstance) {
        loggerInstance = pino({
            level: "info",
            base: undefined
        });
    }
    return loggerInstance;
}