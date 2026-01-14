import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: 'Mimir',
    },
    githubUrl: "https://github.com/your-org/mimir",
    links: [],
  };
}
