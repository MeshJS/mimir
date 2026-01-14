import type { AppConfig, DocumentationConfig, GithubConfig, CodeRepoConfig, DocsRepoConfig } from "../config/types";
import {
    DEFAULT_BRANCH,
    buildSourceUrl,
    joinRepoPaths,
    parseGithubUrl,
} from "../github/utils";
import { slugifyHeading } from "./slugify";
import { stripWrappingQuotes } from "./extractTitle";

export interface SourceLinkResult {
    githubUrl?: string;
    docsUrl?: string;
    finalUrl?: string;
    sanitizedTitle: string;
    slug?: string;
}

export function resolveSourceLinks(
    filepath: string,
    chunkTitle?: string,
    config?: AppConfig,
    existingSourceUrl?: string,
    sourceRepoConfig?: CodeRepoConfig | DocsRepoConfig
): SourceLinkResult {
    const sanitizedTitle = sanitizeSourceTitle(chunkTitle, filepath);
    const slug = slugifyHeading(sanitizedTitle);

    const isDocFile = /\.(md|mdx)$/i.test(filepath);

    // Prefer the ingestion-time sourceUrl (from GitHub download) as the canonical GitHub URL.
    // Fall back to computing from current GitHub config if it's not available.
    const baseGithubUrl =
        existingSourceUrl ||
        computeGithubUrl(filepath, config?.github, sourceRepoConfig);

    // Use per-repo docs config if available, otherwise fall back to global config
    const docsConfigForFile = isDocFile && sourceRepoConfig && 'baseUrl' in sourceRepoConfig
        ? { baseUrl: sourceRepoConfig.baseUrl, contentPath: sourceRepoConfig.contentPath }
        : config?.docs;
    const baseDocsUrl = isDocFile ? computeDocsUrl(filepath, docsConfigForFile) : undefined;

    const githubUrl = appendSlug(baseGithubUrl, slug);
    const docsUrl = appendSlug(baseDocsUrl, slug);

    // For docs, prefer docsUrl; for code (any language), prefer githubUrl.
    const finalUrl = isDocFile
        ? (docsUrl ?? githubUrl ?? baseDocsUrl ?? baseGithubUrl)
        : (githubUrl ?? baseGithubUrl ?? docsUrl ?? baseDocsUrl);

    return { githubUrl, docsUrl, finalUrl, sanitizedTitle, slug };
}

export function sanitizeSourceTitle(title?: string, fallback?: string): string {
    const candidate = title ?? fallback ?? "";
    const sanitized = stripWrappingQuotes(candidate);
    return sanitized || (fallback ?? "");
}

function computeGithubUrl(
    filepath: string, 
    githubConfig?: GithubConfig,
    sourceRepoConfig?: CodeRepoConfig | DocsRepoConfig
): string | undefined {
    // Use source repo config if available (from document)
    if (sourceRepoConfig) {
        try {
            const parsed = parseGithubUrl(sourceRepoConfig.url);
            const branch = githubConfig?.branch ?? parsed.branch ?? DEFAULT_BRANCH;
            const directory = sourceRepoConfig.directory;
            const scopedPath = joinRepoPaths(parsed.path, directory);
            const repoPath = joinRepoPaths(scopedPath, filepath);
            return buildSourceUrl(parsed.owner, parsed.repo, branch, repoPath);
        } catch {
            return undefined;
        }
    }

    // Fall back to global config (backward compatibility)
    const url = githubConfig?.githubUrl || githubConfig?.codeUrl;
    if (!url) {
        return undefined;
    }

    try {
        const parsed = parseGithubUrl(url);
        const branch = githubConfig.branch ?? parsed.branch ?? DEFAULT_BRANCH;
        // Use codeDirectory if codeUrl is used, otherwise use directory
        const directory = githubConfig.codeUrl ? githubConfig.codeDirectory : githubConfig.directory;
        const scopedPath = joinRepoPaths(parsed.path, directory);
        const repoPath = joinRepoPaths(scopedPath, filepath);
        return buildSourceUrl(parsed.owner, parsed.repo, branch, repoPath);
    } catch {
        return undefined;
    }
}

function computeDocsUrl(filepath: string, docsConfig?: DocumentationConfig): string | undefined {
    const baseUrl = docsConfig?.baseUrl;
    if (!baseUrl) {
        return undefined;
    }

    if (!/\.(md|mdx)$/i.test(filepath)) {
        return undefined;
    }

    const contentPrefix = docsConfig.contentPath ?? "content/docs";
    let relativePath = filepath;

    if (relativePath.startsWith(`${contentPrefix}/`)) {
        relativePath = relativePath.slice(contentPrefix.length + 1);
    }

    relativePath = relativePath.replace(/\.(md|mdx)$/i, "");

    if (relativePath.endsWith("/index")) {
        relativePath = relativePath.slice(0, -"/index".length);
    }

    const normalizedBase = stripTrailingSlash(baseUrl);

    if (!relativePath) {
        return normalizedBase || "/";
    }

    const encodedRelative = relativePath
        .split("/")
        .filter((segment) => segment.length > 0)
        .map((segment) => encodeURIComponent(segment))
        .join("/");

    if (!normalizedBase) {
        return `/${encodedRelative}`;
    }

    return `${normalizedBase}/${encodedRelative}`;
}

function stripTrailingSlash(value: string): string {
    if (value === "") {
        return "";
    }
    return value.endsWith("/") ? value.slice(0, -1) : value;
}

function appendSlug(url?: string, slug?: string): string | undefined {
    if (!url) {
        return undefined;
    }
    if (!slug || url.includes("#")) {
        return url;
    }
    return `${url}#${slug}`;
}
