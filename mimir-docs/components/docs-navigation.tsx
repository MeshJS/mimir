"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

type PageLink = {
  title: string;
  href: string;
};

export function DocsNavigation({
  prev,
  next,
}: {
  prev?: PageLink;
  next?: PageLink;
}) {
  if (!prev && !next) return null;

  return (
    <div className="mt-16 pt-8 border-t border-edge flex items-center justify-between gap-4">
      {prev ? (
        <Link
          href={prev.href}
          className={cn(
            "flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors group"
          )}
        >
          <ChevronLeft className="w-4 h-4" />
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground/70">Previous</span>
            <span className="font-medium">{prev.title}</span>
          </div>
        </Link>
      ) : (
        <div />
      )}

      {next ? (
        <Link
          href={next.href}
          className={cn(
            "flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors group ml-auto"
          )}
        >
          <div className="flex flex-col text-right">
            <span className="text-xs text-muted-foreground/70">Next</span>
            <span className="font-medium">{next.title}</span>
          </div>
          <ChevronRight className="w-4 h-4" />
        </Link>
      ) : null}
    </div>
  );
}
