import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'Mimir',
    },
    githubUrl: process.env.NEXT_PUBLIC_GITHUB_URL || "https://github.com/MeshJS/mimir",
    links: [],
  };
}
