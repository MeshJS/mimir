import { extractTitle } from "../utils/extractTitle";

export interface MdxChunk {
    chunkTitle: string;
    chunkContent: string;
}

export function chunkMdxFile(mdxFileContent: string): MdxChunk[] {
    const lines = mdxFileContent.split(/\r?\n/);
    const chunks: MdxChunk[] = []
    let currentChunk = { heading: "", lines: [] as string[] };

    const flushChunk = () => {
        if(currentChunk.lines.length === 0 && currentChunk.heading === "") return;
        const lines = currentChunk.lines.join("\n");
        chunks.push({
            chunkTitle: currentChunk.heading,
            chunkContent: lines
        })
        currentChunk = { heading: "", lines: [] };
    }

    for(const line of lines) {
        const trimmed = line.trim();
        if(trimmed.startsWith("#") && !trimmed.endsWith("[!toc]")) {
            flushChunk();
            currentChunk.heading = extractTitle(trimmed);
            currentChunk.lines.push(trimmed);
        } else if (trimmed.startsWith("title")) {
            currentChunk.heading = extractTitle(trimmed, { isFrontmatter: true });
            currentChunk.lines.push(trimmed);
        } else {
            currentChunk.lines.push(trimmed);
        }
    }
    flushChunk();

    return chunks;
}