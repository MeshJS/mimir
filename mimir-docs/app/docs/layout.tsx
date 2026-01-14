import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/site-header';
import { DocsSidebar } from '@/components/docs-sidebar';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="max-w-screen overflow-x-hidden px-2">
        <div className="screen-line-before screen-line-after mx-auto md:max-w-4xl relative border-x border-edge py-4">
          <DocsSidebar />
          <div className="w-full px-6">
            {children}
          </div>
        </div>
      </main>
    </>
  );
}
