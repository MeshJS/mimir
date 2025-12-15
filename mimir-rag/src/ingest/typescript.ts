import fs from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import type { AppConfig, ParserConfig } from "../config/types";
import {
    DEFAULT_BRANCH,
    buildSourceUrl,
    computeRelativePath,
    joinRepoPaths,
    normalizeRepoPath,
    parseGithubUrl,
} from "../github/utils";
import { getLogger } from "../utils/logger";
import { collectCodeFilesViaTree, collectCodeFilesLegacy } from "./github/common";

export interface GithubTypescriptDocument {
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
 * Downloads all TypeScript files from a GitHub repository
 */
export async function downloadGithubTypescriptFiles(appConfig: AppConfig): Promise<GithubTypescriptDocument[]> {
    const logger = getLogger();
    const config = appConfig.github;

    if (!config) {
        throw new Error("GitHub configuration is required but not provided.");
    }

    const token = config.token ?? process.env.GITHUB_TOKEN;
    const parsed = parseGithubUrl(config.githubUrl);
    const branch = config.branch ?? parsed.branch ?? DEFAULT_BRANCH;
    const scopedPath = joinRepoPaths(parsed.path, config.directory);

    const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": "mimir-rag",
    };

    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    const repoDescriptor = `${parsed.owner}/${parsed.repo}`;
    const scopeDescriptor = scopedPath ? `/${scopedPath}` : "";

    logger.info(`Fetching TypeScript files from ${repoDescriptor}@${branch}${scopeDescriptor}`);

    const tsEntries = await collectTypescriptFiles(
        parsed.owner,
        parsed.repo,
        branch,
        scopedPath,
        headers,
        appConfig.parser,
        config.includeDirectories
    );

    logger.info(`Found ${tsEntries.length} TypeScript file${tsEntries.length === 1 ? "" : "s"}.`);

    if (config.outputDir) {
        await persistDocuments(config.outputDir, tsEntries, logger);
    }

    return tsEntries.map((doc) => ({
        ...doc,
        relativePath: computeRelativePath(scopedPath, doc.path),
        sourceUrl: buildSourceUrl(parsed.owner, parsed.repo, branch, doc.path),
    }));
}

async function collectTypescriptFiles(
    owner: string,
    repo: string,
    branch: string,
    basePath: string,
    headers: Record<string, string>,
    parserConfig?: ParserConfig,
    includeDirectories?: string[]
): Promise<GithubTypescriptDocument[]> {
    try {
        const docs = await collectCodeFilesViaTree(
            owner,
            repo,
            branch,
            basePath,
            headers,
            isTypescriptFile,
            parserConfig,
            includeDirectories
        );
        return docs as GithubTypescriptDocument[];
    } catch (error) {
        getLogger().warn(
            { err: error },
            "Failed to use Git tree API for TypeScript discovery. Falling back to directory walk."
        );
        const docs = await collectCodeFilesLegacy(
            owner,
            repo,
            branch,
            basePath,
            headers,
            isTypescriptFile,
            parserConfig,
            includeDirectories
        );
        return docs as GithubTypescriptDocument[];
    }
}

async function collectTypescriptFilesViaTree(
    owner: string,
    repo: string,
    branch: string,
    basePath: string,
    headers: Record<string, string>,
    parserConfig?: ParserConfig,
    includeDirectories?: string[]
): Promise<GithubTypescriptDocument[]> {
    const docs = await collectCodeFilesViaTree(
        owner,
        repo,
        branch,
        basePath,
        headers,
        isTypescriptFile,
        parserConfig,
        includeDirectories
    );
    return docs as GithubTypescriptDocument[];
}

async function collectTypescriptFilesLegacy(
    owner: string,
    repo: string,
    branch: string,
    basePath: string,
    headers: Record<string, string>,
    parserConfig?: ParserConfig,
    includeDirectories?: string[]
): Promise<GithubTypescriptDocument[]> {
    const docs = await collectCodeFilesLegacy(
        owner,
        repo,
        branch,
        basePath,
        headers,
        isTypescriptFile,
        parserConfig,
        includeDirectories
    );
    return docs as GithubTypescriptDocument[];
}

/**
 * Check if a filename is a TypeScript file
 */
function isTypescriptFile(filename: string): boolean {
    const lower = filename.toLowerCase();
    // Include .ts and .tsx, exclude .d.ts declaration files
    if (lower.endsWith(".d.ts")) {
        return false;
    }
    return lower.endsWith(".ts") || lower.endsWith(".tsx");
}

/**
 * Check if a file path matches any of the exclude patterns
 * (used for all code languages, not just TypeScript)
 */
export function shouldExcludeFile(filepath: string, excludePatterns: string[]): boolean {
    const filename = path.basename(filepath);
    
    for (const pattern of excludePatterns) {
        // Simple glob matching for common patterns
        if (pattern.startsWith("*")) {
            const suffix = pattern.slice(1);
            if (filename.endsWith(suffix) || filepath.endsWith(suffix)) {
                return true;
            }
        } else if (pattern.endsWith("*")) {
            const prefix = pattern.slice(0, -1);
            if (filename.startsWith(prefix) || filepath.includes(prefix)) {
                return true;
            }
        } else if (filename === pattern || filepath.includes(pattern)) {
            return true;
        }
    }

    return false;
}

/**
 * Check if a file path is within any of the included directories
 * (used for all code languages, not just TypeScript)
 */
export function shouldIncludeFile(filepath: string, basePath: string, includeDirectories: string[]): boolean {
    // Normalize paths for comparison
    const normalizedBase = normalizeRepoPath(basePath);
    const normalizedPath = normalizeRepoPath(filepath);
    
    for (const includeDir of includeDirectories) {
        const normalizedInclude = normalizeRepoPath(includeDir);
        
        // Build the full path: basePath + includeDir
        let fullIncludePath: string;
        if (normalizedBase) {
            fullIncludePath = normalizedBase.endsWith("/")
                ? `${normalizedBase}${normalizedInclude}`
                : `${normalizedBase}/${normalizedInclude}`;
        } else {
            fullIncludePath = normalizedInclude;
        }
        
        // Check if file path starts with the include directory path
        // Also handle exact match or directory prefix
        if (
            normalizedPath === fullIncludePath ||
            normalizedPath.startsWith(fullIncludePath + "/") ||
            normalizedPath.startsWith(normalizedInclude + "/") ||
            normalizedPath === normalizedInclude
        ) {
            return true;
        }
    }
    
    return false;
}

async function persistDocuments(
    directory: string,
    documents: GithubTypescriptDocument[],
    logger: Logger
): Promise<void> {
    await resetOutputDirectory(directory, logger);

    for (const doc of documents) {
        const localPath = path.join(directory, ...doc.path.split("/"));
        const localDir = path.dirname(localPath);

        await fs.mkdir(localDir, { recursive: true });
        await fs.writeFile(localPath, doc.content, "utf8");

        logger.debug(`Saved TypeScript file to ${localPath}`);
    }
}

async function resetOutputDirectory(directory: string, logger: Logger): Promise<void> {
    try {
        await fs.rm(directory, { recursive: true, force: true });
        logger.debug({ directory }, "Cleared cached TypeScript directory before download.");
    } catch (error) {
        logger.warn({ directory, err: error }, "Failed to clear cached TypeScript directory; continuing.");
    }

    await fs.mkdir(directory, { recursive: true });
}

