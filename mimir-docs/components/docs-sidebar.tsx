"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

type Page = {
  title: string;
  href: string;
};

const DOCS_PAGES: Page[] = [
  { title: "Introduction", href: "/docs" },
  { title: "Getting Started", href: "/docs/getting-started" },
  { title: "Configuration", href: "/docs/configuration" },
  { title: "Deployment", href: "/docs/deployment" },
  { title: "API Reference", href: "/docs/api-reference" },
  { title: "MCP Integration", href: "/docs/mcp" },
];

export function DocsSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:block absolute -left-40 top-0 w-56">
      <nav className="fixed top-16 h-[calc(100vh-4rem)] pt-8 pr-1 overflow-y-auto">
        <div className="space-y-1">
          {DOCS_PAGES.map((page) => {
            const isActive = pathname === page.href;
            
            return (
              <Link
                key={page.href}
                href={page.href}
                className={cn(
                  "block pl-2 pr-2 py-2 text-sm rounded-lg transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                )}
              >
                {page.title}
              </Link>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
