import Bottleneck from "bottleneck";

const ONE_MINUTE_MS = 60_000;

export function createRateLimiter(concurrency: number, reservoir?: number): Bottleneck {
    const baseOptions = {
        maxConcurrent: Math.max(1, concurrency),
    };

    if (reservoir && Number.isFinite(reservoir)) {
        const amount = Math.max(1, Math.floor(reservoir));
        const options: Bottleneck.ConstructorOptions = {
            ...baseOptions,
            reservoir: amount,
            reservoirRefreshAmount: amount,
            reservoirRefreshInterval: ONE_MINUTE_MS,
        };
        return new Bottleneck(options);
    }

    return new Bottleneck(baseOptions);
}

