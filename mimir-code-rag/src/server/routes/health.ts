import type { Request, Response } from "express";

export interface HealthRouteContext {
    ingestionBusy: boolean;
}

export function handleHealthRequest(_req: Request, res: Response, context: HealthRouteContext): void {
    res.json({ status: "ok", ingestionBusy: context.ingestionBusy });
}

