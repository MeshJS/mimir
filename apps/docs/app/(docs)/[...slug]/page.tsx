import { source } from '@/lib/source';
import {
  DocsPage,
  DocsBody,
  DocsDescription,
  DocsTitle,
} from 'fumadocs-ui/page';
import { notFound } from 'next/navigation';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { getMDXComponents } from '@/mdx-components';
import { LLMCopyButton, ViewOptions } from '@/components/ai/page-actions';

export default async function Page(props: {
  params: Promise<{ slug?: string[] }>;
}) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDXContent = page.data.body;
  const markdownUrl = `/llms.mdx${page.url}`

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="!mb-2">{page.data.description}</DocsDescription>
      <div className="flex flex-row gap-2 items-center border-b pb-6">
        <LLMCopyButton markdownUrl={markdownUrl} />
        <ViewOptions
          markdownUrl={markdownUrl}
          githubUrl={`https://github.com/MeshJS/mimir/tree/main/apps/docs/content/docs/${page.path}`}
        />
      </div>
      <DocsBody>
        <MDXContent
          components={getMDXComponents({
            // this allows you to link to other pages with relative file paths
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug = [] } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  const image = ['/docs-og', ...slug, 'image.png'].join('/');
  return {
    metadataBase: new URL("https://meshjs.dev"),
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: image,
    },
    twitter: {
      card: 'summary_large_image',
      images: image,
    },
  };
}