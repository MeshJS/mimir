import fs from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import type { GithubConfig } from "../config/types";
import { getLogger } from "../utils/logger";

const GITHUB_API_BASE = "https://api.github.com";
const DEFAULT_BRANCH = "main";
const USER_AGENT = "mimir-rag-core";

interface ParsedGithubUrl {
    owner: string;
    repo: string;
    branch: string;
    path: string;
}

interface GithubDirectoryEntry {
    type: string;
    name: string;
    path: string;
    sha: string;
    size: number;
    download_url: string | null;
    html_url: string;
}

interface GithubFileResponse extends GithubDirectoryEntry {
    type: "file";
    encoding?: string;
    content?: string;
}

export interface GithubMdxDocument {
    path: string;
    relativePath: string;
    content: string;
    sha: string;
    size: number;
    sourceUrl: string;
}

export async function downloadGithubMdxFiles(config: GithubConfig): Promise<GithubMdxDocument[]> {
    const logger = getLogger();

    const token = config?.token ?? process.env.GITHUB_TOKEN;
    const parsed = parseGithubUrl(config.githubUrl);
    const branch = config?.branch ?? parsed.branch ?? DEFAULT_BRANCH;
    const scopedPath = joinRepoPaths(parsed.path, config?.directory);

    const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": USER_AGENT,
    };

    if(token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    const repoDescriptor = `${parsed.owner}/${parsed.repo}`;
    const scopeDescriptor = scopedPath ? `/${scopedPath}` : "";

    logger.info(`Fetching MDX files from ${repoDescriptor}@${branch}${scopeDescriptor}`);

    const mdxEntries = await collectMdxFiles(parsed.owner, parsed.repo, branch, scopedPath, headers);

    logger.info(`Found ${mdxEntries.length} MDX file${mdxEntries.length === 1 ? "" : "s"}.`);

    if(config?.outputDir) {
        await persistDocuments(config.outputDir, mdxEntries, logger);
    }

    return mdxEntries.map((doc) => ({
        ...doc,
        relativePath: computeRelativePath(scopedPath, doc.path),
        sourceUrl: buildSourceUrl(parsed.owner, parsed.repo, branch, doc.path),
    }));
}

function parseGithubUrl(input: string): ParsedGithubUrl {
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(input);
    } catch {
        throw new Error(`Invalid GitHub URL: ${input}`);
    }

    if(!parsedUrl.hostname.endsWith("github.com")) {
        throw new Error(`Unsupported GitHub host in URL: ${input}`);
    }

    const segments = parsedUrl.pathname.split("/").filter(Boolean);

    if(segments.length < 2) {
        throw new Error(`GitHub URL must include an owner and repository: ${input}`);
    }

    const [owner, repoSegment, ...rest] = segments;
    const repo = repoSegment.endsWith(".git") ? repoSegment.slice(0, -4) : repoSegment;

    let branch = DEFAULT_BRANCH;
    let repoPath = "";

    if(rest.length > 0) {
        const qualifier = rest[0];
        if(qualifier === "tree" || qualifier === "blob") {
            branch = rest[1] ?? DEFAULT_BRANCH;
            repoPath = rest.slice(2).join("/");
        } else {
            repoPath = rest.join("/");
        }
    }

    return {
        owner,
        repo,
        branch,
        path: normalizeRepoPath(repoPath),
    };
}

async function collectMdxFiles(
    owner: string,
    repo: string,
    branch: string,
    basePath: string,
    headers: Record<string, string>
): Promise<GithubMdxDocument[]> {
    const queue: string[] = [basePath];
    const visited = new Set<string>();
    const mdxFiles: GithubMdxDocument[] = [];

    while(queue.length > 0) {
        const currentPath = queue.shift() ?? "";
        const normalizedCurrent = normalizeRepoPath(currentPath);

        if(visited.has(normalizedCurrent)) {
            continue;
        }
        visited.add(normalizedCurrent);

        const contents = await fetchContents(owner, repo, branch, normalizedCurrent, headers);

        if(Array.isArray(contents)) {
            for(const entry of contents) {
                if(entry.type === "dir") {
                    queue.push(entry.path);
                    continue;
                }

                if(entry.type === "file" && isMdxFile(entry.name)) {
                    const file = await fetchFile(owner, repo, branch, entry.path, headers);
                    const content = await resolveFileContent(file, headers);

                    mdxFiles.push({
                        path: file.path,
                        relativePath: "", // populated later to avoid repeated computation
                        content,
                        sha: file.sha,
                        size: file.size,
                        sourceUrl: "", // populated later
                    });
                }
            }
        } else if(contents.type === "file" && isMdxFile(contents.name)) {
            const content = await resolveFileContent(contents, headers);
            mdxFiles.push({
                path: contents.path,
                relativePath: "",
                content,
                sha: contents.sha,
                size: contents.size,
                sourceUrl: "",
            });
        }
    }

    return mdxFiles;
}

async function fetchContents(
    owner: string,
    repo: string,
    branch: string,
    repoPath: string,
    headers: Record<string, string>
): Promise<GithubDirectoryEntry[] | GithubFileResponse> {
    const encodedPath = encodeRepoPath(repoPath);
    const pathSuffix = encodedPath ? `/${encodedPath}` : "";
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents${pathSuffix}?ref=${encodeURIComponent(branch)}`;

    const response = await fetch(url, { headers });

    if(response.status === 404) {
        throw new Error(`Path "${repoPath || "/"}" does not exist in ${owner}/${repo}@${branch}`);
    }

    if(!response.ok) {
        throw new Error(`Failed to read "${repoPath || "/"}" from ${owner}/${repo}@${branch}: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<GithubDirectoryEntry[] | GithubFileResponse>;
}

async function fetchFile(
    owner: string,
    repo: string,
    branch: string,
    repoPath: string,
    headers: Record<string, string>
): Promise<GithubFileResponse> {
    const encodedPath = encodeRepoPath(repoPath);
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;

    const response = await fetch(url, { headers });

    if(!response.ok) {
        throw new Error(`Failed to download "${repoPath}" from ${owner}/${repo}@${branch}: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json() as GithubFileResponse;

    if(payload.type !== "file") {
        throw new Error(`Expected a file response when downloading "${repoPath}", received type "${payload.type}" instead.`);
    }

    return payload;
}

async function resolveFileContent(file: GithubFileResponse, headers: Record<string, string>): Promise<string> {
    if(file.encoding === "base64" && file.content) {
        return Buffer.from(file.content, "base64").toString("utf-8");
    }

    if(file.download_url) {
        const rawHeaders: Record<string, string> = {
            "User-Agent": USER_AGENT,
        };

        if(headers["Authorization"]) {
            rawHeaders["Authorization"] = headers["Authorization"];
        }

        const response = await fetch(file.download_url, { headers: rawHeaders });

        if(!response.ok) {
            throw new Error(`Unable to download raw contents for "${file.path}": ${response.status} ${response.statusText}`);
        }

        return response.text();
    }

    throw new Error(`Unable to retrieve the contents of "${file.path}".`);
}

function isMdxFile(filename: string): boolean {
    return filename.toLowerCase().endsWith(".mdx");
}

function encodeRepoPath(repoPath: string): string {
    if(repoPath === "") {
        return "";
    }

    return repoPath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function normalizeRepoPath(repoPath: string): string {
    if(!repoPath) {
        return "";
    }

    const segments = repoPath.split("/").map((segment) => segment.trim()).filter((segment) => segment.length > 0);

    for(const segment of segments) {
        if(segment === "." || segment === "..") {
            throw new Error(`Relative path segments ("." or "..") are not supported in repository paths.`);
        }
    }

    return segments.join("/");
}

function joinRepoPaths(...parts: Array<string | undefined>): string {
    const segments: string[] = [];

    for(const part of parts) {
        if(!part) {
            continue;
        }

        const normalizedPart = normalizeRepoPath(part);
        if(normalizedPart.length === 0) {
            continue;
        }

        normalizedPart.split("/").forEach((segment) => segments.push(segment));
    }

    return segments.join("/");
}

function computeRelativePath(basePath: string, fullPath: string): string {
    if(!basePath) {
        return fullPath;
    }

    const prefix = basePath.endsWith("/") ? basePath : `${basePath}/`;

    if(fullPath.startsWith(prefix)) {
        return fullPath.slice(prefix.length);
    }

    return fullPath;
}

function buildSourceUrl(owner: string, repo: string, branch: string, filePath: string): string {
    const encodedPath = encodeRepoPath(filePath);
    return `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(branch)}/${encodedPath}`;
}

async function persistDocuments(directory: string, documents: GithubMdxDocument[], logger: Logger): Promise<void> {
    await fs.mkdir(directory, { recursive: true });

    for(const doc of documents) {
        const localPath = path.join(directory, ...doc.path.split("/"));
        const localDir = path.dirname(localPath);

        await fs.mkdir(localDir, { recursive: true });
        await fs.writeFile(localPath, doc.content, "utf8");

        logger.debug(`Saved MDX file to ${localPath}`);
    }
}
