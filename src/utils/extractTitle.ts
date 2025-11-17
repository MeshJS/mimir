const WRAPPING_PAIRS: Array<[string, string]> = [
    ["\"", "\""],
    ["'", "'"],
    ["[", "]"],
    ["(", ")"],
    ["“", "”"],
    ["‘", "’"],
];

export function stripWrappingQuotes(value?: string): string {
    let result = (value ?? "").trim();
    for(const [start, end] of WRAPPING_PAIRS) {
        if(result.length >= start.length + end.length && result.startsWith(start) && result.endsWith(end)) {
            result = result.slice(start.length, result.length - end.length).trim();
        }
    }
    return result;
}

export function extractTitle(line: string, options?: { isFrontmatter?: boolean }) {
    let rawTitle: string;
    if(options?.isFrontmatter) {
        const match = line.match(/title\s*:\s*(.+)/);
        rawTitle = match ? match[1] : "";
    } else {
        rawTitle = line.replace(/^#+\s*/, "").trim();
    }

    return stripWrappingQuotes(rawTitle);
}
