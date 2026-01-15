import { source } from '@/lib/source';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/mdx-components';
import type { Metadata } from 'next';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { baseOptions } from '@/lib/layout.shared';
import { LLMCopyButton, ViewOptions } from '@/components/ai/page-actions';
import { DocsNavigation } from '@/components/docs-navigation';

const DOCS_ORDER = [
  '/docs',
  '/docs/getting-started',
  '/docs/configuration',
  '/docs/deployment',
  '/docs/api-reference',
  '/docs/mcp',
];

export default async function Page(props: {
  params: Promise<{ slug?: string[] }>;
}) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const markdownUrl = `/llms.mdx${page.url}`;
  const githubUrl = `${baseOptions().githubUrl}/tree/main/mimir-docs/content/docs/${page.path}`;

  // Get previous and next pages
  const currentIndex = DOCS_ORDER.indexOf(page.url);
  let prevPage, nextPage;
  
  if (currentIndex > 0) {
    const prevSlug = DOCS_ORDER[currentIndex - 1].replace('/docs', '').split('/').filter(Boolean);
    prevPage = source.getPage(prevSlug.length > 0 ? prevSlug : undefined);
  }
  
  if (currentIndex < DOCS_ORDER.length - 1) {
    const nextSlug = DOCS_ORDER[currentIndex + 1].replace('/docs', '').split('/').filter(Boolean);
    nextPage = source.getPage(nextSlug.length > 0 ? nextSlug : undefined);
  }

  return (
    <div className="*:[[id]]:scroll-mt-22 py-12">
      <h1 className="text-4xl sm:text-5xl mb-4 leading-tight font-semibold">
        {page.data.title}
      </h1>
      {page.data.description && (
        <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
          {page.data.description}
        </p>
      )}
      <div className="flex flex-row gap-2 items-center border-b pb-6 mb-8">
        <LLMCopyButton markdownUrl={markdownUrl} />
        <ViewOptions githubUrl={githubUrl} markdownUrl={markdownUrl} />
      </div>
      <div className="prose prose-neutral dark:prose-invert max-w-none">
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, page),
          })}
        />
      </div>
      <DocsNavigation
        prev={prevPage ? { title: prevPage.data.title, href: prevPage.url } : undefined}
        next={nextPage ? { title: nextPage.data.title, href: nextPage.url } : undefined}
      />
    </div>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<'/docs/[[...slug]]'>): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
