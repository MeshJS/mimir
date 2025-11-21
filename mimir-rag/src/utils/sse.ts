export interface SSEvent {
    event?: string;
    data: string;
    raw: string;
}

export async function readEventStream(response: Response, onEvent: (event: SSEvent) => boolean | void): Promise<void> {
    if (!response.body) {
        throw new Error("Streaming response is missing a readable body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let shouldStop = false;

    const emitEvents = (flush: boolean): void => {
        while (!shouldStop) {
            const separatorIndex = buffer.indexOf("\n\n");
            if (separatorIndex === -1) {
                break;
            }

            const rawEvent = buffer.slice(0, separatorIndex);
            buffer = buffer.slice(separatorIndex + 2);
            const parsed = parseEvent(rawEvent);
            if (!parsed) {
                continue;
            }

            const result = onEvent(parsed);
            if (result === false) {
                shouldStop = true;
                return;
            }
        }

        if (flush) {
            const trimmed = buffer.trim();
            buffer = "";
            if (!trimmed) {
                return;
            }

            const parsed = parseEvent(trimmed);
            if (!parsed) {
                return;
            }

            const result = onEvent(parsed);
            if (result === false) {
                shouldStop = true;
            }
        }
    };

    try {
        while (!shouldStop) {
            const { done, value } = await reader.read();
            if (value) {
                const chunkText = decoder.decode(value, { stream: true }).replace(/\r/g, "");
                buffer += chunkText;
                emitEvents(false);
            }

            if (done) {
                const finalText = decoder.decode().replace(/\r/g, "");
                buffer += finalText;
                emitEvents(true);
                break;
            }
        }
    } finally {
        if (shouldStop) {
            await reader.cancel().catch(() => undefined);
        } else {
            reader.releaseLock();
        }
    }
}

function parseEvent(raw: string): SSEvent | undefined {
    const trimmed = raw.trim();
    if (!trimmed) {
        return undefined;
    }

    const event: SSEvent = { raw, data: "" };
    const lines = trimmed.split(/\r?\n/);

    for (const line of lines) {
        if (line.startsWith("event:")) {
            event.event = line.slice(6).trim();
            continue;
        }

        if (line.startsWith("data:")) {
            const value = line.slice(5).trimStart();
            event.data = event.data.length === 0 ? value : `${event.data}\n${value}`;
        }
    }

    if (!event.data) {
        return undefined;
    }

    return event;
}
