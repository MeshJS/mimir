import GithubSlugger from "github-slugger";

export function slugifyHeading(input: string | undefined | null): string {
    const normalized = (input ?? "").trim();
    if (normalized.length === 0) {
        return "";
    }

    const slugger = new GithubSlugger();
    return slugger.slug(normalized);
}
