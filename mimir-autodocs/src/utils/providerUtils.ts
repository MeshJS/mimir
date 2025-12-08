import type { ProviderRateLimits } from "../llm/base";
import type { ProviderLimitsConfig } from "../config/types";

export function resolveBaseUrl(url: string | undefined, defaultUrl: string): string {
    if (!url) {
        return defaultUrl;
    }
    return url.endsWith("/") ? url : `${url}/`;
}

export function mergeLimits(defaults: ProviderRateLimits, override?: ProviderLimitsConfig): ProviderRateLimits {
    if (!override) {
        return defaults;
    }

    return {
        ...defaults,
        ...override,
    };
}

