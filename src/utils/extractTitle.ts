export function extractTitle(line: string, options?: { isFrontmatter?: Boolean }) {
    if(options?.isFrontmatter) {
        const match = line.match(/title\s*:\s*(.+)/);
        return match ? match[1] : "";
    } else {
        return line.replace(/^#+\s*/, "").trim();
    }
}