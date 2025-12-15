import fs from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import type { AppConfig, ParserConfig } from "../config/types";
import {
    DEFAULT_BRANCH,
    buildSourceUrl,
    computeRelativePath,
    joinRepoPaths,
    parseGithubUrl,
} from "../github/utils";
import { getLogger } from "../utils/logger";
import { collectCodeFilesViaTree, collectCodeFilesLegacy } from "./github/common";

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
        "User-Agent": "mimir-rag",
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
        const docs = await collectPythonFilesViaTree(
            owner,
            repo,
            branch,
            basePath,
            headers,
            parserConfig,
            includeDirectories
        );
        return docs;
    } catch (error) {
        getLogger().warn(
            { err: error },
            "Failed to use Git tree API for Python discovery. Falling back to directory walk."
        );
        return collectPythonFilesLegacy(owner, repo, branch, basePath, headers, parserConfig, includeDirectories);
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
    const docs = await collectCodeFilesViaTree(
        owner,
        repo,
        branch,
        basePath,
        headers,
        isPythonFile,
        parserConfig,
        includeDirectories
    );
    return docs as GithubPythonDocument[];
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
    headers: Record<string, string>,
    parserConfig?: ParserConfig,
    includeDirectories?: string[]
): Promise<GithubPythonDocument[]> {
    const docs = await collectCodeFilesLegacy(
        owner,
        repo,
        branch,
        basePath,
        headers,
        isPythonFile,
        parserConfig,
        includeDirectories
    );
    return docs as GithubPythonDocument[];
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


