export interface LoggingConfig {
    level: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
    pretty: boolean;
}