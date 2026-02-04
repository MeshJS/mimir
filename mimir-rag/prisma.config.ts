/// <reference types="node" />
import "dotenv/config";
import { defineConfig } from "prisma/config";

function getDatabaseUrl(): string {
    if (process.env.DATABASE_URL) {
        return process.env.DATABASE_URL;
    }
    if (process.env.MIMIR_DATABASE_URL) {
        return process.env.MIMIR_DATABASE_URL;
    }
    throw new Error("DATABASE_URL or MIMIR_DATABASE_URL must be set");
}

function getDatabaseUrlSafe(): string {
    if (process.env.PRISMA_SKIP_DATABASE_URL_CHECK === "true") {
        return process.env.DATABASE_URL || process.env.MIMIR_DATABASE_URL || "postgresql://placeholder";
    }
    try {
        return getDatabaseUrl();
    } catch (error) {
        throw error;
    }
}

const databaseUrl = getDatabaseUrlSafe();

export default defineConfig({
    schema: "prisma/schema.prisma",
    migrations: {
        path: "prisma/migrations",
    },
    datasource: {
        url: databaseUrl,
    },
});
