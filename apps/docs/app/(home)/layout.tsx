import type { ReactNode } from 'react';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/app/layout.config';
import {
  SiDiscord,
  SiX
} from "@icons-pack/react-simple-icons";
import { LargeSearchToggle, SearchToggle } from 'fumadocs-ui/components/layout/search-toggle';
import { Sparkles, Wand2Icon } from 'lucide-react';
import { AISearchTrigger } from '@/components/ai';
import { cn } from '@/lib/cn';
import { buttonVariants } from '@/components/ui/button';
import Footer from '@/components/ui/Footer';
import { WrapperLayout } from '@/components/layout/WrapperLayout';
import { AISidebarProvider } from '../../context/AISidebarContext';
import { navbarLinks } from '@/components/ui/NavLinks';

export default function Layout({ children }: { children: ReactNode }) {
  return (
  <AISidebarProvider>
    <div className="flex flex-col">
      <HomeLayout
        {...baseOptions}
        nav={{ transparentMode: "always", ...baseOptions.nav }}
        searchToggle={{
          components: {
            lg: (
              <div className="flex justify-end gap-1.5 max-md:hidden">
                <LargeSearchToggle className="flex-1 w-72" />
                <AISearchTrigger
                  aria-label="Ask AI"
                  className={cn(
                    buttonVariants({
                      color: 'outline',
                      size: 'icon',
                      className: 'text-fd-muted-foreground',
                    }),
                    "flex gap-2"
                  )}
                >
                  <Sparkles className="size-4" />
                  Ask Mesh AI
                </AISearchTrigger>
              </div>
            ),
            sm: (
              <div className="flex justify-end items-center gap-1 md:hidden">
                <SearchToggle />
                <AISearchTrigger
                  className={cn(
                    buttonVariants({
                      color: 'secondary',
                      size: 'sm',
                      className: 'text-fd-muted-foreground rounded-lg',
                    }),
                  )}
                >
                  <Sparkles className="size-4.5 fill-current" />
                </AISearchTrigger>
              </div>
            )
          },
        }}
        links={[
          ...navbarLinks,
          {
            text: "X",
            type: "icon",
            icon: <SiX className="w-4 h-4 text-foreground" />,
            url: "https://x.com/meshsdk/"
          },
          {
            text: "Discord",
            type: "icon",
            icon: <SiDiscord className="w-4 h-4 text-foreground" />,
            url: "https://discord.gg/dH48jH3BKa"
          }
        ]}
      >
        <WrapperLayout isHomeLayout={true}>{children}</WrapperLayout>
        <Footer />
      </HomeLayout>
    </div>
  </AISidebarProvider>
  )
}

