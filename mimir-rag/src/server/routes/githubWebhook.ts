import type { Request, Response } from "express";
import type { Logger } from "pino";
import type { IngestRouteContext } from "./ingest";
import { triggerIngestion } from "./ingest";
import { getHeaderValue, verifyGithubWebhookSignature } from "../../github/utils";

export type RequestWithRawBody = Request & { rawBody?: Buffer };

export interface GithubWebhookRouteContext extends IngestRouteContext {
    githubWebhookSecret?: string;
}

export async function handleGithubWebhookRequest(
    req: RequestWithRawBody,
    res: Response,
    context: GithubWebhookRouteContext,
    logger: Logger
): Promise<void> {
    const secret = context.githubWebhookSecret;

    if (!secret) {
        res.status(501).json({
            status: "error",
            message: "GitHub webhook secret is not configured on the server.",
        });
        return;
    }

    const signatureHeader = getHeaderValue(req.headers["x-hub-signature-256"]);
    const rawBody = req.rawBody;

    if (!verifyGithubWebhookSignature(secret, signatureHeader, rawBody)) {
        res.status(401).json({ status: "error", message: "Invalid GitHub signature." });
        return;
    }

    const eventType = getHeaderValue(req.headers["x-github-event"]) ?? "unknown";

    if (eventType === "ping") {
        res.json({ status: "ok", message: "pong" });
        return;
    }

    const repoName = req.body?.repository?.full_name ?? "unknown-repo";

    await triggerIngestion(res, context, logger, `github-webhook:${repoName}:${eventType}`, {
        busyStatus: 202,
        busyState: "pending",
        busyMessage: "Ingestion already running. Webhook acknowledged.",
    });
}
