import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { getDatabaseUrl } from "../utils/getDatabaseUrl";

let prisma: PrismaClient | null = null;
let pool: Pool | null = null;

export function getPrismaClient(): PrismaClient {
    if (!prisma) {
        if (!pool) {
            pool = new Pool({
                connectionString: getDatabaseUrl(),
            });
        }
        const adapter = new PrismaPg(pool);
        prisma = new PrismaClient({
            adapter,
            log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
        });
    }
    return prisma;
}

export async function disconnectPrisma(): Promise<void> {
    if (prisma) {
        await prisma.$disconnect();
        prisma = null;
    }
    if (pool) {
        await pool.end();
        pool = null;
    }
}
