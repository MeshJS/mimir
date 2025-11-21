import crypto from 'node:crypto';

export function calculateChecksum(content: string): string {
    return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}