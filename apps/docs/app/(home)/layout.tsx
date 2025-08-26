import type { ReactNode } from 'react';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/app/layout.config';
import {
  NavbarMenu,
  NavbarMenuContent,
  NavbarMenuLink,
  NavbarMenuTrigger,
} from 'fumadocs-ui/layouts/home/navbar';
import { LinkItemType } from 'fumadocs-ui/layouts/links';
import { CloudIcon, BanknotesIcon, WalletIcon, MagnifyingGlassIcon, WrenchScrewdriverIcon, ComputerDesktopIcon, DocumentCheckIcon, AcademicCapIcon, DocumentTextIcon, Squares2X2Icon, BookOpenIcon,GlobeAltIcon, UserGroupIcon, FilmIcon, HeartIcon, PaintBrushIcon,ScaleIcon, LightBulbIcon } from "@heroicons/react/24/solid";
import { iconResolver } from "@/lib/iconResolver";
import {
  SiDiscord,
  SiX
} from "@icons-pack/react-simple-icons";
import { Banner } from 'fumadocs-ui/components/banner';
import { LargeSearchToggle, SearchToggle } from 'fumadocs-ui/components/layout/search-toggle';
import { Sparkles } from 'lucide-react';
import { AISearchTrigger } from '@/components/ai';
import { cn } from '@/lib/cn';
import { buttonVariants } from '@/components/ui/button';
import Footer from '@/components/ui/Footer';
import Link from 'fumadocs-core/link';
import { WrapperLayout } from '@/components/layout/WrapperLayout';
import { AISidebarProvider } from '../../context/AISidebarContext';

const navbarLinks: LinkItemType[] = [
  {
    type: "custom",
    on: "nav",
    children: (
      <NavbarMenu>
        <NavbarMenuTrigger>SDK</NavbarMenuTrigger>
        <NavbarMenuContent>
          <NavbarMenuLink href="/apis/wallets">
            <WalletIcon className="mr-3 h-5 w-5 text-blue-500" />
            <div className="flex flex-col">
              <span className="font-medium">Wallets</span>
              <span className="text-sm text-fd-muted-foreground">
                Wallets APIs for interacting with the blockchain
              </span>
            </div>
          </NavbarMenuLink>
          <NavbarMenuLink href="/apis/txbuilder">
            <BanknotesIcon className="mr-3 h-5 w-5 text-purple-500" />
            <div className="flex flex-col">
              <span className="font-medium">Transaction Builder</span>
              <span className="text-sm text-fd-muted-foreground">
                Build transactions with cardano-cli like APIs
              </span>
            </div>
          </NavbarMenuLink>
          <NavbarMenuLink href="/apis/txparser">
            <MagnifyingGlassIcon className="mr-3 h-5 w-5 text-pink-500" />
            <div className="flex flex-col">
              <span className="font-medium">Transaction Parser</span>
              <span className="text-sm text-fd-muted-foreground">
                Parse transactions for testing and rebuilding
              </span>
            </div>
          </NavbarMenuLink>
          <NavbarMenuLink href="/providers">
            <CloudIcon className="mr-3 h-5 w-5 text-green-500" />
            <div className="flex flex-col">
              <span className="font-medium">Providers</span>
              <span className="text-sm text-fd-muted-foreground">
                Data providers for connecting to the blockchain
              </span>
            </div>
          </NavbarMenuLink>
          <NavbarMenuLink href="/apis/utilities">
            <WrenchScrewdriverIcon className="mr-3 h-5 w-5 text-red-500" />
            <div className="flex flex-col">
              <span className="font-medium">Utilities</span>
              <span className="text-sm text-fd-muted-foreground">
                Serializers, resolvers and data types for converting between different formats
              </span>
            </div>
          </NavbarMenuLink>
          <NavbarMenuLink href="/react">
            <ComputerDesktopIcon className="mr-3 h-5 w-5 text-yellow-500" />
            <div className="flex flex-col">
              <span className="font-medium">React Components</span>
              <span className="text-sm text-fd-muted-foreground">
                Frontend React UI components and React hooks
              </span>
            </div>
          </NavbarMenuLink>
          <NavbarMenuLink href="/svelte">
            <ComputerDesktopIcon className="mr-3 h-5 w-5 text-teal-500" />
            <div className="flex flex-col">
              <span className="font-medium">Svelte Components</span>
              <span className="text-sm text-fd-muted-foreground">
                Svelte UI components for wallet connections
              </span>
            </div>
          </NavbarMenuLink>
          <NavbarMenuLink href="/smart-contracts">
            <DocumentCheckIcon className="mr-3 h-5 w-5 text-amber-500" />
            <div className="flex flex-col">
              <span className="font-medium">Smart Contract Library</span>
              <span className="text-sm text-fd-muted-foreground">
                Open-source smart contracts, complete with documentation, and live demos
              </span>
            </div>
          </NavbarMenuLink>
          <NavbarMenuLink href="/aiken">
            <div className="mr-3 h-5 w-5">
              {iconResolver("icons/aiken.png")}
            </div>
            <div className="flex flex-col">
              <span className="font-medium">Aiken</span>
              <span className="text-sm text-fd-muted-foreground">
                Function programming language created for Cardano smart contract development
              </span>
            </div>
          </NavbarMenuLink>
          <NavbarMenuLink href="/hydra">
            <div className="mr-3 h-5 w-5">
              {iconResolver("icons/hydra.svg")}
            </div>
            <div className="flex flex-col">
              <span className="font-medium">Hydra</span>
              <span className="text-sm text-fd-muted-foreground">
                Layer 2 scaling solution for Cardano
              </span>
            </div>
          </NavbarMenuLink>
          <NavbarMenuLink href="/yaci">
            <div className="mr-3 h-5 w-5">
              {iconResolver("icons/yaci.png")}
            </div>
            <div className="flex flex-col">
              <span className="font-medium">Yaci</span>
              <span className="text-sm text-fd-muted-foreground">
               Custom devnet to tailor your devnet needs with a builtin indexer
              </span>
            </div>
          </NavbarMenuLink>
          <NavbarMenuLink href="https://midnight.meshjs.dev/en">
            <div className="mr-3 h-5 w-5">
              {iconResolver("icons/midnight.svg")}
            </div>
            <div className="flex flex-col">
              <span className="font-medium">Midnight</span>
              <span className="text-sm text-fd-muted-foreground">
               Leveraging zero-knowledge technology to enable data protection
              </span>
            </div>
          </NavbarMenuLink>
          <NavbarMenuLink href="https://polkadot.meshjs.dev/en">
            <div className="mr-3 h-5 w-5">
              {iconResolver("icons/polkadot.svg")}
            </div>
            <div className="flex flex-col">
              <span className="font-medium">Polkadot</span>
              <span className="text-sm text-fd-muted-foreground">
               Tools and resources for developers to build on Polkadot
              </span>
            </div>
          </NavbarMenuLink>
          <NavbarMenuLink href="https://utxos.dev/">
            <div className="mr-3 h-5 w-5">
              {iconResolver("icons/mesh.svg")}
            </div>
            <div className="flex flex-col">
              <span className="font-medium">Wallet as a Service</span>
              <span className="text-sm text-fd-muted-foreground">
               Access self-custodial wallet using social logins
              </span>
            </div>
          </NavbarMenuLink>
        </NavbarMenuContent>
      </NavbarMenu>
    ),
  },

  {
    type: "custom",
    on: "nav",
    children: (
      <NavbarMenu>
        <NavbarMenuTrigger>Resources</NavbarMenuTrigger>
        <NavbarMenuContent>
          <NavbarMenuLink href="/guides">
            <BookOpenIcon className="mr-3 h-5 w-5 text-purple-500" />
            <div className="flex flex-col">
              <span className="font-medium">Guides</span>
              <span className="text-sm text-fd-muted-foreground">
                Whether you are new to web development or a seasoned blockchain full-stack developer, these guides will help you get started
              </span>
            </div>
          </NavbarMenuLink>
          <NavbarMenuLink href="https://docs.meshjs.dev/">
            <DocumentTextIcon className="mr-3 h-5 w-5 text-blue-500" />
            <div className="flex flex-col">
              <span className="font-medium">Documentation</span>
              <span className="text-sm text-fd-muted-foreground">
                Full documentation for MeshJS
              </span>
            </div>
          </NavbarMenuLink>
          <NavbarMenuLink href="https://github.com/MeshJS/examples">
            <Squares2X2Icon className="mr-3 h-5 w-5 text-green-500" />
            <div className="flex flex-col">
              <span className="font-medium">Examples</span>
              <span className="text-sm text-fd-muted-foreground">
                Explore our examples to get started
              </span>
            </div>
          </NavbarMenuLink>
          <NavbarMenuLink href="https://pbl.meshjs.dev/">
            <AcademicCapIcon className="mr-3 h-5 w-5 text-orange-500" />
            <div className="flex flex-col">
              <span className="font-medium">Project Based Learning</span>
              <span className="text-sm text-fd-muted-foreground">
                Start your building journey
              </span>
            </div>
          </NavbarMenuLink>
        </NavbarMenuContent>
      </NavbarMenu>
    ),
  },

  {
    type: "custom",
    on: "nav",
    children: (
      <NavbarMenu>
        <NavbarMenuTrigger>Solutions</NavbarMenuTrigger>
        <NavbarMenuContent>
          <NavbarMenuLink href="https://utxos.dev/">
            <GlobeAltIcon className="mr-3 h-5 w-5 text-sky-500" />
            <div className="flex flex-col">
              <span className="font-medium">Web3 Services</span>
              <span className="text-sm text-fd-muted-foreground">
                Streamline user onboarding and Web3 integration, accelerating your app's time to market
              </span>
            </div>
          </NavbarMenuLink>
          <NavbarMenuLink href="/smart-contracts">
            <DocumentCheckIcon className="mr-3 h-5 w-5 text-emerald-500" />
            <div className="flex flex-col">
              <span className="font-medium">Smart Contracts Library</span>
              <span className="text-sm text-fd-muted-foreground">
                Open-source smart contracts, complete with documentation, and live demos
              </span>
            </div>
          </NavbarMenuLink>
          <NavbarMenuLink href="https://multisig.meshjs.dev/">
            <UserGroupIcon className="mr-3 h-5 w-5 text-indigo-500" />
            <div className="flex flex-col">
              <span className="font-medium">Multisig platform</span>
              <span className="text-sm text-fd-muted-foreground">
                Secure your treasury and participant in Cardano governance as a team with multi-signature
              </span>
            </div>
          </NavbarMenuLink>
          <NavbarMenuLink href="https://cloud.meshjs.dev/cquisitor">
            <MagnifyingGlassIcon className="mr-3 h-5 w-5 text-fuchsia-500" />
            <div className="flex flex-col">
              <span className="font-medium">Cquisitor</span>
              <span className="text-sm text-fd-muted-foreground">
                Debug, validate and inspect any CBOR and Cardano objects
              </span>
            </div>
          </NavbarMenuLink>
        </NavbarMenuContent>
      </NavbarMenu>
    ),
  },

  {
    type: "custom",
    on: "nav",
    children: (
      <NavbarMenu>
        <NavbarMenuTrigger>About</NavbarMenuTrigger>
        <NavbarMenuContent>
          <NavbarMenuLink href="/about">
            <HeartIcon className="mr-3 h-5 w-5 text-red-500" />
            <span className="font-medium">About Us</span>
          </NavbarMenuLink>
          <NavbarMenuLink href="https://gov.meshjs.dev/">
            <ScaleIcon className="mr-3 h-5 w-5 text-stone-500" />
            <span className="font-medium">Governance</span>
          </NavbarMenuLink>
          <NavbarMenuLink href="/about/catalyst">
            <LightBulbIcon className="mr-3 h-5 w-5 text-emerald-500" />
            <span className="font-medium">Project Catalyst</span>
          </NavbarMenuLink>
          <NavbarMenuLink href="/about/support-us">
            <HeartIcon className="mr-3 h-5 w-5 text-pink-500" />
            <span className="font-medium">Support Us</span>
          </NavbarMenuLink>
          <NavbarMenuLink href="/about/branding">
            <PaintBrushIcon className="mr-3 h-5 w-5 text-cyan-500" />
            <span className="font-medium">Branding</span>
          </NavbarMenuLink>
        </NavbarMenuContent>
      </NavbarMenu>
    ),
  },
];

export default function Layout({ children }: { children: ReactNode }) {
  return (
  <AISidebarProvider>
    <div className="flex flex-col">
      <HomeLayout
        {...baseOptions}
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
            url: "https://discord.gg/WvnCNqmAxy"
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

