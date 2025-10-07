import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import Image from 'next/image';
import {
  SiDiscord,
  SiX
} from "@icons-pack/react-simple-icons";

/**
 * Shared layout configurations
 *
 * you can customise layouts individually from:
 * Home Layout: app/(home)/layout.tsx
 * Docs Layout: app/docs/layout.tsx
 */
export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <>
        <Image
          src="/logo-mesh/black/logo-mesh-vector.svg"
          width={40}
          height={40}
          alt="Mesh Logo"
          className="dark:invert"
        />
        Mesh
      </>
    ),
  },
  githubUrl: "https://github.com/MeshJS/mesh",
  links: [
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
  ],
};
