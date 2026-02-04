export function getDatabaseUrl(): string {
    if (process.env.DATABASE_URL) {
        return process.env.DATABASE_URL;
    }
    if (process.env.MIMIR_DATABASE_URL) {
        return process.env.MIMIR_DATABASE_URL;
    }
    throw new Error("DATABASE_URL or MIMIR_DATABASE_URL must be set");
}
