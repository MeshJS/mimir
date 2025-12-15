import type { ParserConfig } from "../../config/types";
import {
    joinRepoPaths,
    normalizeRepoPath,
    encodeRepoPath,
} from "../../github/utils";
import { shouldExcludeFile, shouldIncludeFile } from "../typescript";

export interface GithubTreeEntry {
    path: string;
    mode: string;
    type: "blob" | "tree" | "commit";
    sha: string;
    size?: number;
    url: string;
}

export interface GithubDirectoryEntry {
    type: string;
    name: string;
    path: string;
    sha: string;
    size: number;
    download_url: string | null;
    html_url: string;
}

export interface GithubFileResponse extends GithubDirectoryEntry {
    type: "file";
    encoding?: string;
    content?: string;
}

export interface GithubCodeDocument {
    /** Full path in the repository */
    path: string;
    /** Path relative to the configured directory scope */
    relativePath: string;
    /** File content */
    content: string;
    /** Git SHA of the file */
    sha: string;
    /** File size in bytes */
    size: number;
    /** GitHub URL to view the file */
    sourceUrl: string;
}

export async function fetchRepoTree(
    owner: string,
    repo: string,
    branch: string,
    headers: Record<string, string>
): Promise<GithubTreeEntry[]> {
    const GITHUB_API_BASE = "https://api.github.com";
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
    const response = await fetch(url, { headers });

    if (!response.ok) {
        throw new Error(
            `Failed to fetch repo tree for ${owner}/${repo}@${branch}: ${response.status} ${response.statusText}`
        );
    }

    const payload = (await response.json()) as { tree?: GithubTreeEntry[] };
    if (!Array.isArray(payload.tree)) {
        throw new Error(`Git tree response for ${owner}/${repo}@${branch} is malformed.`);
    }

    return payload.tree;
}

export async function downloadRawFile(
    owner: string,
    repo: string,
    branch: string,
    repoPath: string,
    headers: Record<string, string>
): Promise<string> {
    const RAW_GITHUB_BASE = "https://raw.githubusercontent.com";
    const USER_AGENT = "mimir-rag";

    const encodedPath = encodeRepoPath(repoPath);
    const url = `${RAW_GITHUB_BASE}/${owner}/${repo}/${encodeURIComponent(branch)}/${encodedPath}`;
    const rawHeaders: Record<string, string> = {
        "User-Agent": USER_AGENT,
    };

    if (headers["Authorization"]) {
        rawHeaders["Authorization"] = headers["Authorization"];
    }

    const response = await fetch(url, { headers: rawHeaders });

    if (!response.ok) {
        throw new Error(
            `Failed to download raw contents for "${repoPath}" from ${owner}/${repo}@${branch}: ${response.status} ${response.statusText}`
        );
    }

    return response.text();
}

export async function fetchContents(
    owner: string,
    repo: string,
    branch: string,
    repoPath: string,
    headers: Record<string, string>
): Promise<GithubDirectoryEntry[] | GithubFileResponse> {
    const GITHUB_API_BASE = "https://api.github.com";
    const encodedPath = encodeRepoPath(repoPath);
    const pathSuffix = encodedPath ? `/${encodedPath}` : "";
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents${pathSuffix}?ref=${encodeURIComponent(branch)}`;

    const response = await fetch(url, { headers });

    if (response.status === 404) {
        throw new Error(`Path "${repoPath || "/"}" does not exist in ${owner}/${repo}@${branch}`);
    }

    if (!response.ok) {
        throw new Error(
            `Failed to read "${repoPath || "/"}" from ${owner}/${repo}@${branch}: ${response.status} ${response.statusText}`
        );
    }

    return response.json() as Promise<GithubDirectoryEntry[] | GithubFileResponse>;
}

export async function fetchFile(
    owner: string,
    repo: string,
    branch: string,
    repoPath: string,
    headers: Record<string, string>
): Promise<GithubFileResponse> {
    const GITHUB_API_BASE = "https://api.github.com";
    const encodedPath = encodeRepoPath(repoPath);
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;

    const response = await fetch(url, { headers });

    if (!response.ok) {
        throw new Error(
            `Failed to download "${repoPath}" from ${owner}/${repo}@${branch}: ${response.status} ${response.statusText}`
        );
    }

    const payload = (await response.json()) as GithubFileResponse;

    if (payload.type !== "file") {
        throw new Error(
            `Expected a file response when downloading "${repoPath}", received type "${payload.type}" instead.`
        );
    }

    return payload;
}

export async function resolveFileContent(file: GithubFileResponse, headers: Record<string, string>): Promise<string> {
    if (file.encoding === "base64" && file.content) {
        return Buffer.from(file.content, "base64").toString("utf-8");
    }

    if (file.download_url) {
        const rawHeaders: Record<string, string> = {
            "User-Agent": "mimir-rag",
        };

        if (headers["Authorization"]) {
            rawHeaders["Authorization"] = headers["Authorization"];
        }

        const response = await fetch(file.download_url, { headers: rawHeaders });

        if (!response.ok) {
            throw new Error(`Unable to download raw contents for "${file.path}": ${response.status} ${response.statusText}`);
        }

        return response.text();
    }

    throw new Error(`Unable to retrieve the contents of "${file.path}".`);
}

/**
 * Generic helper to collect code files for any language via Git tree API.
 */
export async function collectCodeFilesViaTree(
    owner: string,
    repo: string,
    branch: string,
    basePath: string,
    headers: Record<string, string>,
    isMatch: (path: string) => boolean,
    parserConfig?: ParserConfig,
    includeDirectories?: string[]
): Promise<GithubCodeDocument[]> {
    const tree = await fetchRepoTree(owner, repo, branch, headers);
    const normalizedBase = normalizeRepoPath(basePath);
    const prefix = normalizedBase ? `${normalizedBase}/` : "";
    const excludePatterns = parserConfig?.excludePatterns ?? [];

    const entries = tree.filter((entry) => {
        if (entry.type !== "blob") {
            return false;
        }
        if (!isMatch(entry.path)) {
            return false;
        }
        if (shouldExcludeFile(entry.path, excludePatterns)) {
            return false;
        }

        if (normalizedBase) {
            if (entry.path !== normalizedBase && !entry.path.startsWith(prefix)) {
                return false;
            }
        }

        if (includeDirectories && includeDirectories.length > 0) {
            return shouldIncludeFile(entry.path, normalizedBase, includeDirectories);
        }

        return true;
    });

    const pLimit = (await import("p-limit")).default;
    const FILE_DOWNLOAD_CONCURRENCY = 8;
    const limit = pLimit(FILE_DOWNLOAD_CONCURRENCY);

    const documents = await Promise.all(
        entries.map((entry) =>
            limit(async () => {
                const content = await downloadRawFile(owner, repo, branch, entry.path, headers);
                return {
                    path: entry.path,
                    relativePath: "",
                    content,
                    sha: entry.sha,
                    size: entry.size ?? Buffer.byteLength(content, "utf8"),
                    sourceUrl: "",
                } as GithubCodeDocument;
            })
        )
    );

    return documents;
}

/**
 * Generic helper to collect code files for any language via legacy directory walk.
 */
export async function collectCodeFilesLegacy(
    owner: string,
    repo: string,
    branch: string,
    basePath: string,
    headers: Record<string, string>,
    isMatch: (name: string) => boolean,
    parserConfig?: ParserConfig,
    includeDirectories?: string[]
): Promise<GithubCodeDocument[]> {
    const queue: string[] = [basePath];
    const visited = new Set<string>();
    const files: GithubCodeDocument[] = [];
    const normalizedBase = normalizeRepoPath(basePath);
    const excludePatterns = parserConfig?.excludePatterns ?? [];

    while (queue.length > 0) {
        const currentPath = queue.shift() ?? "";
        const normalizedCurrent = normalizeRepoPath(currentPath);

        if (visited.has(normalizedCurrent)) {
            continue;
        }
        visited.add(normalizedCurrent);

        const contents = await fetchContents(owner, repo, branch, normalizedCurrent, headers);

        if (Array.isArray(contents)) {
            for (const entry of contents) {
                if (entry.type === "dir") {
                    queue.push(entry.path);
                    continue;
                }

                if (entry.type === "file" && isMatch(entry.name)) {
                    if (shouldExcludeFile(entry.path, excludePatterns)) {
                        continue;
                    }

                    if (includeDirectories && includeDirectories.length > 0) {
                        if (!shouldIncludeFile(entry.path, normalizedBase, includeDirectories)) {
                            continue;
                        }
                    }

                    const file = await fetchFile(owner, repo, branch, entry.path, headers);
                    const content = await resolveFileContent(file, headers);

                    files.push({
                        path: file.path,
                        relativePath: "",
                        content,
                        sha: file.sha,
                        size: file.size,
                        sourceUrl: "",
                    });
                }
            }
        } else if (contents.type === "file" && isMatch(contents.name)) {
            if (shouldExcludeFile(contents.path, excludePatterns)) {
                continue;
            }

            if (includeDirectories && includeDirectories.length > 0) {
                if (!shouldIncludeFile(contents.path, normalizedBase, includeDirectories)) {
                    continue;
                }
            }

            const content = await resolveFileContent(contents, headers);
            files.push({
                path: contents.path,
                relativePath: "",
                content,
                sha: contents.sha,
                size: contents.size,
                sourceUrl: "",
            });
        }
    }

    return files;
}


