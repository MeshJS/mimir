"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

type Page = {
  title: string;
  href: string;
};

export function DocsDropdown({ pages }: { pages: Page[] }) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = React.useState(false);

  const isActive = pathname?.startsWith("/docs");

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "text-sm font-medium transition-colors hover:text-foreground flex items-center gap-1",
          isActive ? "text-foreground" : "text-muted-foreground"
        )}
      >
        Docs
        <ChevronDown className={cn("w-3 h-3 transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute top-full left-0 mt-2 w-56 rounded-lg border border-edge bg-background shadow-lg z-50 py-2">
            {pages.map((page) => {
              const pageIsActive = pathname === page.href;
              
              return (
                <Link
                  key={page.href}
                  href={page.href}
                  onClick={() => setIsOpen(false)}
                  className={cn(
                    "block px-4 py-2 text-sm transition-colors",
                    pageIsActive
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  )}
                >
                  {page.title}
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
