import fs from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import type { AppConfig, ParserConfig } from "../config/types";
import {
    DEFAULT_BRANCH,
    buildSourceUrl,
    computeRelativePath,
    encodeRepoPath,
    joinRepoPaths,
    normalizeRepoPath,
    parseGithubUrl,
} from "../github/utils";
import { getLogger } from "../utils/logger";
import pLimit from "p-limit";
import { shouldExcludeFile, shouldIncludeFile } from "./typescript";

const GITHUB_API_BASE = "https://api.github.com";
const RAW_GITHUB_BASE = "https://raw.githubusercontent.com";
const USER_AGENT = "mimir-rag";
const FILE_DOWNLOAD_CONCURRENCY = 8;

interface GithubTreeEntry {
    path: string;
    mode: string;
    type: "blob" | "tree" | "commit";
    sha: string;
    size?: number;
    url: string;
}

export interface GithubPythonDocument {
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

/**
 * Downloads all Python files from a GitHub repository
 */
export async function downloadGithubPythonFiles(appConfig: AppConfig): Promise<GithubPythonDocument[]> {
    const logger = getLogger();
    const config = appConfig.github;

    if (!config) {
        throw new Error("GitHub configuration is required but not provided.");
    }

    const token = config.token ?? process.env.GITHUB_TOKEN;
    const parsed = parseGithubUrl(config.githubUrl);
    const branch = config.branch ?? parsed.branch ?? DEFAULT_BRANCH;
    const scopedPath = joinRepoPaths(parsed.path, config.directory);
    const parserConfig: ParserConfig | undefined = appConfig.parser;

    const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": USER_AGENT,
    };

    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    const repoDescriptor = `${parsed.owner}/${parsed.repo}`;
    const scopeDescriptor = scopedPath ? `/${scopedPath}` : "";

    logger.info(`Fetching Python files from ${repoDescriptor}@${branch}${scopeDescriptor}`);

    const pyEntries = await collectPythonFiles(
        parsed.owner,
        parsed.repo,
        branch,
        scopedPath,
        headers,
        parserConfig,
        config.includeDirectories
    );

    logger.info(`Found ${pyEntries.length} Python file${pyEntries.length === 1 ? "" : "s"}.`);

    if (config.outputDir) {
        await persistDocuments(config.outputDir, pyEntries, logger);
    }

    return pyEntries.map((doc) => ({
        ...doc,
        relativePath: computeRelativePath(scopedPath, doc.path),
        sourceUrl: buildSourceUrl(parsed.owner, parsed.repo, branch, doc.path),
    }));
}

async function collectPythonFiles(
    owner: string,
    repo: string,
    branch: string,
    basePath: string,
    headers: Record<string, string>,
    parserConfig?: ParserConfig,
    includeDirectories?: string[]
): Promise<GithubPythonDocument[]> {
    try {
        return await collectPythonFilesViaTree(owner, repo, branch, basePath, headers, parserConfig, includeDirectories);
    } catch (error) {
        getLogger().warn(
            { err: error },
            "Failed to use Git tree API for Python discovery. Falling back to directory walk."
        );
        return collectPythonFilesLegacy(owner, repo, branch, basePath, headers);
    }
}

async function collectPythonFilesViaTree(
    owner: string,
    repo: string,
    branch: string,
    basePath: string,
    headers: Record<string, string>,
    parserConfig?: ParserConfig,
    includeDirectories?: string[]
): Promise<GithubPythonDocument[]> {
    const tree = await fetchRepoTree(owner, repo, branch, headers);
    const normalizedBase = normalizeRepoPath(basePath);
    const prefix = normalizedBase ? `${normalizedBase}/` : "";
    const excludePatterns = parserConfig?.excludePatterns ?? [];

    const pyEntries = tree.filter((entry) => {
        if (entry.type !== "blob") {
            return false;
        }
        if (!isPythonFile(entry.path)) {
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

        // If includeDirectories is specified, only include files from those directories
        if (includeDirectories && includeDirectories.length > 0) {
            return shouldIncludeFile(entry.path, normalizedBase, includeDirectories);
        }

        return true;
    });

    const limit = pLimit(FILE_DOWNLOAD_CONCURRENCY);
    const documents = await Promise.all(
        pyEntries.map((entry) =>
            limit(async () => {
                const content = await downloadRawFile(owner, repo, branch, entry.path, headers);
                return {
                    path: entry.path,
                    relativePath: "",
                    content,
                    sha: entry.sha,
                    size: entry.size ?? Buffer.byteLength(content, "utf8"),
                    sourceUrl: "",
                } as GithubPythonDocument;
            })
        )
    );

    return documents;
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

async function collectPythonFilesLegacy(
    owner: string,
    repo: string,
    branch: string,
    basePath: string,
    headers: Record<string, string>
): Promise<GithubPythonDocument[]> {
    const queue: string[] = [basePath];
    const visited = new Set<string>();
    const pyFiles: GithubPythonDocument[] = [];
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

                if (entry.type === "file" && isPythonFile(entry.name)) {
                    if (shouldExcludeFile(entry.path, excludePatterns)) {
                        continue;
                    }

                    // Check include directories if specified
                    if (includeDirectories && includeDirectories.length > 0) {
                        if (!shouldIncludeFile(entry.path, normalizedBase, includeDirectories)) {
                            continue;
                        }
                    }

                    const file = await fetchFile(owner, repo, branch, entry.path, headers);
                    const content = await resolveFileContent(file, headers);

                    pyFiles.push({
                        path: file.path,
                        relativePath: "",
                        content,
                        sha: file.sha,
                        size: file.size,
                        sourceUrl: "",
                    });
                }
            }
        } else if (contents.type === "file" && isPythonFile(contents.name)) {
            if (shouldExcludeFile(contents.path, excludePatterns)) {
                continue;
            }

            // Check include directories if specified
            if (includeDirectories && includeDirectories.length > 0) {
                if (!shouldIncludeFile(contents.path, normalizedBase, includeDirectories)) {
                    continue;
                }
            }

            const content = await resolveFileContent(contents, headers);
            pyFiles.push({
                path: contents.path,
                relativePath: "",
                content,
                sha: contents.sha,
                size: contents.size,
                sourceUrl: "",
            });
        }
    }

    return pyFiles;
}

async function fetchRepoTree(
    owner: string,
    repo: string,
    branch: string,
    headers: Record<string, string>
): Promise<GithubTreeEntry[]> {
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

async function downloadRawFile(
    owner: string,
    repo: string,
    branch: string,
    repoPath: string,
    headers: Record<string, string>
): Promise<string> {
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

async function resolveFileContent(file: GithubFileResponse, headers: Record<string, string>): Promise<string> {
    if (file.encoding === "base64" && file.content) {
        return Buffer.from(file.content, "base64").toString("utf-8");
    }

    if (file.download_url) {
        const rawHeaders: Record<string, string> = {
            "User-Agent": USER_AGENT,
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

function isPythonFile(filename: string): boolean {
    const lower = filename.toLowerCase();
    return lower.endsWith(".py");
}

async function persistDocuments(
    directory: string,
    documents: GithubPythonDocument[],
    logger: Logger
): Promise<void> {
    await resetOutputDirectory(directory, logger);

    for (const doc of documents) {
        const localPath = path.join(directory, ...doc.path.split("/"));
        const localDir = path.dirname(localPath);

        await fs.mkdir(localDir, { recursive: true });
        await fs.writeFile(localPath, doc.content, "utf8");

        logger.debug(`Saved Python file to ${localPath}`);
    }
}

async function resetOutputDirectory(directory: string, logger: Logger): Promise<void> {
    try {
        await fs.rm(directory, { recursive: true, force: true });
        logger.debug({ directory }, "Cleared cached Python directory before download.");
    } catch (error) {
        logger.warn({ directory, err: error }, "Failed to clear cached Python directory; continuing.");
    }

    await fs.mkdir(directory, { recursive: true });
}


