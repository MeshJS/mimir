import type { AppConfig, DocumentationConfig, GithubConfig } from "../config/types";
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
    existingSourceUrl?: string
): SourceLinkResult {
    const sanitizedTitle = sanitizeSourceTitle(chunkTitle, filepath);
    const slug = slugifyHeading(sanitizedTitle);

    // For TypeScript files, compute GitHub URL (which checks codeUrl/codeDirectory)
    const isTypeScriptFile = filepath?.endsWith(".ts") || filepath?.endsWith(".tsx");
    let baseGithubUrl: string | undefined;
    if (isTypeScriptFile) {
        // Always compute GitHub URL for TypeScript files (uses codeUrl/codeDirectory if available)
        baseGithubUrl = computeGithubUrl(filepath, config?.github) || existingSourceUrl;
    } else {
        // For MDX files, compute it or use existing sourceUrl
        baseGithubUrl = computeGithubUrl(filepath, config?.github) || existingSourceUrl;
    }
    
    const baseDocsUrl = computeDocsUrl(filepath, config?.docs);

    const githubUrl = appendSlug(baseGithubUrl, slug);
    const docsUrl = appendSlug(baseDocsUrl, slug);
    
    // For TypeScript files, always prefer githubUrl over docsUrl
    const finalUrl = isTypeScriptFile 
        ? (githubUrl ?? baseGithubUrl)
        : (docsUrl ?? githubUrl ?? baseDocsUrl ?? baseGithubUrl);

    return { githubUrl, docsUrl, finalUrl, sanitizedTitle, slug };
}

export function sanitizeSourceTitle(title?: string, fallback?: string): string {
    const candidate = title ?? fallback ?? "";
    const sanitized = stripWrappingQuotes(candidate);
    return sanitized || (fallback ?? "");
}

function computeGithubUrl(filepath: string, githubConfig?: GithubConfig): string | undefined {
    // Try githubUrl first, then fall back to codeUrl for TypeScript files
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
