import fs from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";
import type { AppConfig, ParserConfig } from "../../config/types";
import {
    DEFAULT_BRANCH,
    buildSourceUrl,
    computeRelativePath,
    joinRepoPaths,
    parseGithubUrl,
} from "../../github/utils";
import { getLogger } from "../../utils/logger";
import { collectCodeFilesViaTree, collectCodeFilesLegacy } from "./common";

export interface GithubRustDocument {
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
 * Downloads all Rust files from a GitHub repository
 */
export async function downloadGithubRustFiles(appConfig: AppConfig): Promise<GithubRustDocument[]> {
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

    logger.info(`Fetching Rust files from ${repoDescriptor}@${branch}${scopeDescriptor}`);

    const rustEntries = await collectRustFiles(
        parsed.owner,
        parsed.repo,
        branch,
        scopedPath,
        headers,
        parserConfig,
        config.includeDirectories
    );

    logger.info(`Found ${rustEntries.length} Rust file${rustEntries.length === 1 ? "" : "s"}.`);

    if (config.outputDir) {
        await persistDocuments(config.outputDir, rustEntries, logger);
    }

    return rustEntries.map((doc) => ({
        ...doc,
        relativePath: computeRelativePath(scopedPath, doc.path),
        sourceUrl: buildSourceUrl(parsed.owner, parsed.repo, branch, doc.path),
    }));
}

async function collectRustFiles(
    owner: string,
    repo: string,
    branch: string,
    basePath: string,
    headers: Record<string, string>,
    parserConfig?: ParserConfig,
    includeDirectories?: string[]
): Promise<GithubRustDocument[]> {
    try {
        const docs = await collectRustFilesViaTree(
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
            "Failed to use Git tree API for Rust discovery. Falling back to directory walk."
        );
        return collectRustFilesLegacy(owner, repo, branch, basePath, headers, parserConfig, includeDirectories);
    }
}

async function collectRustFilesViaTree(
    owner: string,
    repo: string,
    branch: string,
    basePath: string,
    headers: Record<string, string>,
    parserConfig?: ParserConfig,
    includeDirectories?: string[]
): Promise<GithubRustDocument[]> {
    const docs = await collectCodeFilesViaTree(
        owner,
        repo,
        branch,
        basePath,
        headers,
        isRustFile,
        parserConfig,
        includeDirectories
    );
    return docs as GithubRustDocument[];
}

async function collectRustFilesLegacy(
    owner: string,
    repo: string,
    branch: string,
    basePath: string,
    headers: Record<string, string>,
    parserConfig?: ParserConfig,
    includeDirectories?: string[]
): Promise<GithubRustDocument[]> {
    const docs = await collectCodeFilesLegacy(
        owner,
        repo,
        branch,
        basePath,
        headers,
        isRustFile,
        parserConfig,
        includeDirectories
    );
    return docs as GithubRustDocument[];
}

function isRustFile(filename: string): boolean {
    const lower = filename.toLowerCase();
    return lower.endsWith(".rs");
}

async function persistDocuments(
    directory: string,
    documents: GithubRustDocument[],
    logger: Logger
): Promise<void> {
    await resetOutputDirectory(directory, logger);

    for (const doc of documents) {
        const localPath = path.join(directory, ...doc.path.split("/"));
        const localDir = path.dirname(localPath);

        await fs.mkdir(localDir, { recursive: true });
        await fs.writeFile(localPath, doc.content, "utf8");

        logger.debug(`Saved Rust file to ${localPath}`);
    }
}

async function resetOutputDirectory(directory: string, logger: Logger): Promise<void> {
    try {
        await fs.rm(directory, { recursive: true, force: true });
        logger.debug({ directory }, "Cleared cached Rust directory before download.");
    } catch (error) {
        logger.warn({ directory, err: error }, "Failed to clear cached Rust directory; continuing.");
    }

    await fs.mkdir(directory, { recursive: true });
}

