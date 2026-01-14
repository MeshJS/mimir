import fs from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import type { AppConfig, CodeRepoConfig, DocsRepoConfig } from "../config/types";
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
import { downloadGithubTypescriptFiles, GithubTypescriptDocument } from "./github/typescript";
import { downloadGithubPythonFiles, GithubPythonDocument } from "./github/python";
import { downloadGithubRustFiles, GithubRustDocument } from "./github/rust";

const GITHUB_API_BASE = "https://api.github.com";
const RAW_GITHUB_BASE = "https://raw.githubusercontent.com";
const USER_AGENT = "mimir-rag-core";
const FILE_DOWNLOAD_CONCURRENCY = 8;

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

interface GithubTreeEntry {
    path: string;
    mode: string;
    type: "blob" | "tree" | "commit";
    sha: string;
    size?: number;
    url: string;
}

export interface GithubMdxDocument {
    path: string;
    relativePath: string;
    content: string;
    sha: string;
    size: number;
    sourceUrl: string;
}

export type GithubDocumentType = "mdx" | "typescript" | "python" | "rust";

export interface GithubDocument {
    type: GithubDocumentType;
    path: string;
    relativePath: string;
    content: string;
    sha: string;
    size: number;
    sourceUrl: string;
    sourceRepoUrl?: string; // The GitHub repository URL this document came from
    sourceRepoConfig?: CodeRepoConfig | DocsRepoConfig; // Per-repo configuration for source URL generation
}

export async function downloadGithubMdxFiles(appConfig: AppConfig): Promise<GithubMdxDocument[]> {
    const logger = getLogger();
    const config = appConfig.github;
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

async function collectMdxFiles(
    owner: string,
    repo: string,
    branch: string,
    basePath: string,
    headers: Record<string, string>
): Promise<GithubMdxDocument[]> {
    try {
        return await collectMdxFilesViaTree(owner, repo, branch, basePath, headers);
    } catch (error) {
        getLogger().warn(
            { err: error },
            "Failed to use Git tree API for MDX discovery. Falling back to directory walk."
        );
        return collectMdxFilesLegacy(owner, repo, branch, basePath, headers);
    }
}

async function collectMdxFilesViaTree(
    owner: string,
    repo: string,
    branch: string,
    basePath: string,
    headers: Record<string, string>
): Promise<GithubMdxDocument[]> {
    const tree = await fetchRepoTree(owner, repo, branch, headers);
    const normalizedBase = normalizeRepoPath(basePath);
    const prefix = normalizedBase ? `${normalizedBase}/` : "";

    const mdxEntries = tree.filter((entry) => {
        if(entry.type !== "blob") {
            return false;
        }
        if(!isMdxFile(entry.path)) {
            return false;
        }
        if(!normalizedBase) {
            return true;
        }
        return entry.path === normalizedBase || entry.path.startsWith(prefix);
    });

    const limit = pLimit(FILE_DOWNLOAD_CONCURRENCY);
    const documents = await Promise.all(
        mdxEntries.map((entry) =>
            limit(async () => {
                const content = await downloadRawFile(owner, repo, branch, entry.path, headers);
                return {
                    path: entry.path,
                    relativePath: "",
                    content,
                    sha: entry.sha,
                    size: entry.size ?? Buffer.byteLength(content, "utf8"),
                    sourceUrl: "",
                } as GithubMdxDocument;
            })
        )
    );

    return documents;
}

async function collectMdxFilesLegacy(
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
                        relativePath: "",
                        content,
                        sha: file.sha,
                        size: file.size,
                        sourceUrl: "",
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

async function fetchRepoTree(
    owner: string,
    repo: string,
    branch: string,
    headers: Record<string, string>
): Promise<GithubTreeEntry[]> {
    const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
    const response = await fetch(url, { headers });

    if(!response.ok) {
        throw new Error(`Failed to fetch repo tree for ${owner}/${repo}@${branch}: ${response.status} ${response.statusText}`);
    }

    const payload = await response.json() as { tree?: GithubTreeEntry[] };
    if(!Array.isArray(payload.tree)) {
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

    if(headers["Authorization"]) {
        rawHeaders["Authorization"] = headers["Authorization"];
    }

    const response = await fetch(url, { headers: rawHeaders });

    if(!response.ok) {
        throw new Error(`Failed to download raw contents for "${repoPath}" from ${owner}/${repo}@${branch}: ${response.status} ${response.statusText}`);
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

async function persistDocuments(directory: string, documents: GithubMdxDocument[], logger: Logger): Promise<void> {
    await resetOutputDirectory(directory, logger);

    for(const doc of documents) {
        const localPath = path.join(directory, ...doc.path.split("/"));
        const localDir = path.dirname(localPath);

        await fs.mkdir(localDir, { recursive: true });
        await fs.writeFile(localPath, doc.content, "utf8");

        logger.debug(`Saved MDX file to ${localPath}`);
    }
}

async function resetOutputDirectory(directory: string, logger: Logger): Promise<void> {
    try {
        await fs.rm(directory, { recursive: true, force: true });
        logger.debug({ directory }, "Cleared cached MDX directory before download.");
    } catch (error) {
        logger.warn({ directory, err: error }, "Failed to clear cached MDX directory; continuing.");
    }

    await fs.mkdir(directory, { recursive: true });
}

/**
 * Downloads both MDX and TypeScript files from GitHub repositories
 * Supports separate repos for code and docs, or a single repo for both
 * Supports multiple repos with per-repo configuration
 * Returns a unified array of documents with type information
 */
export async function downloadGithubFiles(appConfig: AppConfig): Promise<GithubDocument[]> {
    const logger = getLogger();
    const documents: GithubDocument[] = [];
    const config = appConfig.github;

    // Determine which repos to use - check for multiple repos first, then fall back to single repos
    // If codeRepos/docsRepos arrays exist (even if empty), use them; otherwise fall back to single-repo config
    let docsRepos: DocsRepoConfig[] = [];
    if (config.docsRepos && config.docsRepos.length > 0) {
        docsRepos = config.docsRepos;
    } else if (config.docsUrl) {
        docsRepos = [{
            url: config.docsUrl,
            directory: config.docsDirectory,
            includeDirectories: config.docsIncludeDirectories,
        }];
    } else if (config.githubUrl) {
        // Fall back to main githubUrl for docs if nothing else is configured
        docsRepos = [{
            url: config.githubUrl,
            directory: config.docsDirectory ?? config.directory,
            includeDirectories: config.docsIncludeDirectories ?? config.includeDirectories,
        }];
    }
    
    let codeRepos: CodeRepoConfig[] = [];
    if (config.codeRepos && config.codeRepos.length > 0) {
        codeRepos = config.codeRepos;
    } else if (config.codeUrl) {
        codeRepos = [{
            url: config.codeUrl,
            directory: config.codeDirectory,
            includeDirectories: config.codeIncludeDirectories,
        }];
    } else if (config.githubUrl) {
        // Fall back to main githubUrl for code if nothing else is configured
        codeRepos = [{
            url: config.githubUrl,
            directory: config.codeDirectory ?? config.directory,
            includeDirectories: config.codeIncludeDirectories ?? config.includeDirectories,
        }];
    }

    if (docsRepos.length === 0 && codeRepos.length === 0) {
        throw new Error("At least one of MIMIR_GITHUB_URL, MIMIR_GITHUB_DOCS_URL, MIMIR_GITHUB_CODE_URL, or numbered repo variables must be set.");
    }

    // Download MDX files from all docs repos
    for (const docsRepo of docsRepos) {
        try {
            const docsDir = docsRepo.directory ?? config.directory;
            const docsIncludeDirs = docsRepo.includeDirectories ?? config.includeDirectories;
            const docsConfig = { 
                ...appConfig, 
                github: { 
                    ...config, 
                    githubUrl: docsRepo.url,
                    directory: docsDir,
                    includeDirectories: docsIncludeDirs,
                } 
            };
            const mdxFiles = await downloadGithubMdxFiles(docsConfig);
            documents.push(...mdxFiles.map((doc) => ({
                type: "mdx" as const,
                ...doc,
                sourceRepoUrl: docsRepo.url,
                sourceRepoConfig: docsRepo,
            })));
            logger.info(`Found ${mdxFiles.length} MDX file${mdxFiles.length === 1 ? "" : "s"} from ${docsRepo.url}.`);
        } catch (error) {
            logger.warn({ err: error, url: docsRepo.url }, "Failed to download MDX files from repo; continuing with other repos.");
        }
    }

    // Download TypeScript, Python, and Rust files from all code repos
    for (const codeRepo of codeRepos) {
        try {
            const codeDir = codeRepo.directory ?? config.directory;
            const codeIncludeDirs = codeRepo.includeDirectories ?? config.includeDirectories;
            
            // Merge repo-specific excludePatterns with global parser excludePatterns
            const globalExcludePatterns = appConfig.parser?.excludePatterns ?? [];
            const repoExcludePatterns = codeRepo.excludePatterns ?? [];
            const mergedExcludePatterns = [...new Set([...globalExcludePatterns, ...repoExcludePatterns])];
            
            const mergedParserConfig = {
                ...appConfig.parser,
                excludePatterns: mergedExcludePatterns,
            };

            const codeConfig = { 
                ...appConfig, 
                parser: mergedParserConfig,
                github: { 
                    ...config, 
                    githubUrl: codeRepo.url,
                    directory: codeDir,
                    includeDirectories: codeIncludeDirs,
                } 
            };

            const [tsFiles, pyFiles, rustFiles] = await Promise.all([
                downloadGithubTypescriptFiles(codeConfig),
                downloadGithubPythonFiles(codeConfig),
                downloadGithubRustFiles(codeConfig),
            ]);

            documents.push(
                ...tsFiles.map((doc) => ({
                    type: "typescript" as const,
                    ...doc,
                    sourceRepoUrl: codeRepo.url,
                    sourceRepoConfig: codeRepo,
                })),
                ...pyFiles.map((doc) => ({
                    type: "python" as const,
                    ...doc,
                    sourceRepoUrl: codeRepo.url,
                    sourceRepoConfig: codeRepo,
                })),
                ...rustFiles.map((doc) => ({
                    type: "rust" as const,
                    ...doc,
                    sourceRepoUrl: codeRepo.url,
                    sourceRepoConfig: codeRepo,
                })),
            );

            logger.info(`Found ${tsFiles.length} TypeScript file${tsFiles.length === 1 ? "" : "s"}, ${pyFiles.length} Python file${pyFiles.length === 1 ? "" : "s"}, and ${rustFiles.length} Rust file${rustFiles.length === 1 ? "" : "s"} from ${codeRepo.url}.`);
        } catch (error) {
            logger.warn({ err: error, url: codeRepo.url }, "Failed to download code files from repo; continuing with other repos.");
        }
    }

    return documents;
}
