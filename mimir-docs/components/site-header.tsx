"use client";

import Link from "next/link";
import { Nav } from "./nav";
import { ThemeToggle } from "./theme-toggle";
import { cn } from "@/lib/cn";

const MAIN_NAV = [
  {
    title: "Docs",
    href: "/docs",
  },
];

export function SiteHeader() {
  return (
    <header
      className={cn(
        "sticky top-0 z-50 max-w-screen overflow-x-hidden bg-background/80 backdrop-blur-sm px-2 pt-2 border-b border-edge"
      )}
    >
      <div
        className="screen-line-before screen-line-after mx-auto flex h-12 items-center justify-between gap-2 border-x border-edge px-2 sm:gap-4 md:max-w-4xl"
      >
        <Link
          href="/"
          className="font-semibold text-lg"
          aria-label="Home"
        >
          Mimir
        </Link>

        <div className="flex-1" />

        <Nav items={MAIN_NAV} />

        <div className="flex items-center gap-2">
          <span className="mx-2 flex h-4 w-px bg-border" />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
