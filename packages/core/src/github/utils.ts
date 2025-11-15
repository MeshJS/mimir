export const DEFAULT_BRANCH = "main";

export interface ParsedGithubUrl {
    owner: string;
    repo: string;
    branch: string;
    path: string;
}

export function parseGithubUrl(input: string): ParsedGithubUrl {
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(input);
    } catch {
        throw new Error(`Invalid GitHub URL: ${input}`);
    }

    if (!parsedUrl.hostname.endsWith("github.com")) {
        throw new Error(`Unsupported GitHub host in URL: ${input}`);
    }

    const segments = parsedUrl.pathname.split("/").filter(Boolean);

    if (segments.length < 2) {
        throw new Error(`GitHub URL must include an owner and repository: ${input}`);
    }

    const [owner, repoSegment, ...rest] = segments;
    const repo = repoSegment.endsWith(".git") ? repoSegment.slice(0, -4) : repoSegment;

    let branch = DEFAULT_BRANCH;
    let repoPath = "";

    if (rest.length > 0) {
        const qualifier = rest[0];
        if (qualifier === "tree" || qualifier === "blob") {
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

export function encodeRepoPath(repoPath: string): string {
    if (repoPath === "") {
        return "";
    }

    return repoPath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

export function normalizeRepoPath(repoPath: string): string {
    if (!repoPath) {
        return "";
    }

    const segments = repoPath
        .split("/")
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);

    for (const segment of segments) {
        if (segment === "." || segment === "..") {
            throw new Error(`Relative path segments ("." or "..") are not supported in repository paths.`);
        }
    }

    return segments.join("/");
}

export function joinRepoPaths(...parts: Array<string | undefined>): string {
    const segments: string[] = [];

    for (const part of parts) {
        if (!part) {
            continue;
        }

        const normalizedPart = normalizeRepoPath(part);
        if (normalizedPart.length === 0) {
            continue;
        }

        normalizedPart.split("/").forEach((segment) => segments.push(segment));
    }

    return segments.join("/");
}

export function computeRelativePath(basePath: string, fullPath: string): string {
    if (!basePath) {
        return fullPath;
    }

    const prefix = basePath.endsWith("/") ? basePath : `${basePath}/`;

    if (fullPath.startsWith(prefix)) {
        return fullPath.slice(prefix.length);
    }

    return fullPath;
}

export function buildSourceUrl(owner: string, repo: string, branch: string, filePath: string): string {
    const encodedPath = encodeRepoPath(filePath);
    return `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(branch)}/${encodedPath}`;
}
