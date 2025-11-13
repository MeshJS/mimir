import { extractTitle } from "../utils/extractTitle";
import { calculateChecksum } from "../utils/calculateChecksum";

export interface MdxChunk {
    chunkTitle: string;
    chunkContent: string;
    checksum: string;
}

export function chunkMdxFile(mdxFileContent: string): MdxChunk[] {
    const lines = mdxFileContent.split(/\r?\n/);
    const chunks: MdxChunk[] = []
    let currentChunk = { heading: "", lines: [] as string[], hasContent: false };

    const flushChunk = () => {
        if(!currentChunk.hasContent) return;
        const lines = currentChunk.lines.join("\n");
        chunks.push({
            chunkTitle: currentChunk.heading,
            chunkContent: lines,
            checksum: calculateChecksum(lines)
        })
        currentChunk = { heading: "", lines: [], hasContent: false };
    }

    for(const line of lines) {
        const trimmed = line.trim();
        const isHeading = trimmed.startsWith("#") && !trimmed.endsWith("[!toc]");
        const isFrontmatterTitle = trimmed.startsWith("title");

        if(isHeading || isFrontmatterTitle) {
            flushChunk();
            currentChunk.heading = extractTitle(trimmed, isFrontmatterTitle ? { isFrontmatter: true }: undefined);
            currentChunk.lines.push(trimmed);
        } else {
            currentChunk.lines.push(trimmed);
            if(trimmed && !currentChunk.hasContent) currentChunk.hasContent = true;
        }
    }
    flushChunk();

    return chunks;
}