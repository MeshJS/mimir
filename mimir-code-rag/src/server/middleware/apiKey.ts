import type { Request, Response, NextFunction } from "express";

function extractHeader(req: Request, key: string): string | undefined {
    const headerGetter = typeof req.get === "function" ? req.get.bind(req) : undefined;
    const fallback = req.headers?.[key.toLowerCase()];

    const value = headerGetter?.(key) ?? (Array.isArray(fallback) ? fallback[0] : fallback);
    return typeof value === "string" ? value.trim() : undefined;
}

export function createApiKeyMiddleware(expectedKey: string) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const headerKey = extractHeader(req, "x-api-key");
        const authHeader = extractHeader(req, "authorization");

        let providedKey = headerKey;
        if (!providedKey && authHeader?.toLowerCase().startsWith("bearer ")) {
            providedKey = authHeader.slice(7).trim();
        }

        if (!providedKey || providedKey !== expectedKey) {
            res.status(401).json({ status: "error", message: "Invalid or missing API key." });
            return;
        }

        next();
    };
}

