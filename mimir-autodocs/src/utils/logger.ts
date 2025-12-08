import pino, { type Logger, type TransportSingleOptions } from "pino";
import type { LoggingConfig } from "../config/types";

let loggerInstance: Logger | null = null;

export function configureLogger(config: LoggingConfig) {
    let transport: TransportSingleOptions | undefined;

    if (config.pretty) {
        try {
            const prettyTarget = require.resolve("pino-pretty");
            transport = {
                target: prettyTarget,
                options: {
                    colorize: true,
                    translateTime: "SYS:standard",
                },
            };
        } catch {
            console.warn(
                '[mimir-autodocs] "pino-pretty" is not installed. Falling back to JSON logs. Install it or set logging.pretty to false.'
            );
        }
    }

    loggerInstance = pino({
        level: config.level,
        base: undefined,
        transport,
    });
}

export function getLogger(): Logger {
    if (!loggerInstance) {
        loggerInstance = pino({
            level: "info",
            base: undefined,
        });
    }
    return loggerInstance;
}

