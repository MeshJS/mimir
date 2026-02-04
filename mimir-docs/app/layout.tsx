import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';
import { Inter } from 'next/font/google';
import type { Metadata } from 'next';
import { Providers } from '@/components/providers';

const inter = Inter({
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_DOCS_URL || 'https://your-docs-domain.com'),
  title: {
    default: 'Mimir - Contextual RAG for Code & Documentation',
    template: '%s | Mimir',
  },
  description: 'Mimir is a comprehensive contextual RAG (Retrieval Augmented Generation) system with MCP integration. Ingest code and documentation from multiple GitHub repositories into PostgreSQL (pgvector). Supports TypeScript, Python, and more. OpenAI-compatible API and MCP protocol for AI assistants.',
  keywords: [
    'RAG',
    'Retrieval Augmented Generation',
    'Contextual RAG',
    'MCP',
    'Model Context Protocol',
    'Documentation Search',
    'Codebase Search',
    'Vector Database',
    'PostgreSQL',
    'pgvector',
    'TypeScript',
    'Python',
    'AI Documentation',
    'Code Intelligence',
    'Semantic Search',
    'GitHub Integration',
  ],
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <Providers>
          <RootProvider>{children}</RootProvider>
        </Providers>
      </body>
    </html>
  );
}
