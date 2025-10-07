import Image from 'next/image';
import Link from "fumadocs-core/link";
import {linksApi} from "@/data/links-api";
import {metaGuides} from "@/data/links-guides";
import {metaSolutions} from  "@/data/links-solutions";
import {metaResources} from  "@/data/links-resources";
import {linksAbout} from  "@/data/links-about";

export default function Footer() {
  return (
    <footer className="border-t border-border bg-fd-card py-12 text-muted-foreground bg-transparent dark:bg-transparent backdrop-blur-3xl">
      <div className="container flex flex-col gap-12">
        <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-10">
          <div className="flex flex-col gap-2 min-w-[200px]">
            <div className="flex items-center gap-2">
              <Image
                src="/logo-mesh/black/logo-mesh-vector.svg"
                width={40}
                height={40}
                alt="Mesh Logo"
                className="dark:invert"
              />
              <span className="text-xl font-semibold text-foreground">Mesh</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Mesh is an open-source library to build Web3 applications.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-10 gap-y-20">

          {
            linksApi.map((item) => (
              <div className='flex flex-col gap-3 [&>a]:hover:underline' key={item.link}>
                <Link href={item.link} className='font-bold'>{item.title.toUpperCase()}</Link>
                {
                  "items" in item && item.items.map((childItem) => (
                    <Link href={childItem.link} key={childItem.link}>{childItem.title}</Link>
                  ))
                }
              </div>
            ))
          }

          <div className='flex flex-col gap-3 [&>a]:hover:underline' key={metaSolutions.link}>
            <Link href={metaSolutions.link} className='font-bold'>{metaSolutions.title.toUpperCase()}</Link>
            {
              "items" in metaSolutions && metaSolutions.items.map((item) => (
                <Link href={item.link} key={item.link}>{item.title}</Link>
              ))
            }
          </div>

          <div className='flex flex-col gap-3 [&>a]:hover:underline' key={metaResources.link}>
            <Link href={metaResources.link} className='font-bold'>{metaResources.title.toUpperCase()}</Link>
            {
              "items" in metaResources && metaResources.items.map((item) => (
                <Link href={item.link} key={item.link}>{item.title}</Link>
              ))
            }
          </div>

          <div className='flex flex-col gap-3 [&>a]:hover:underline' key={metaGuides.link}>
            <Link href={metaGuides.link} className='font-bold'>{metaGuides.title.toUpperCase()}</Link>
            {
              "items" in metaGuides && metaGuides.items.map((item) => (
                <Link href={item.link} key={item.link}>{item.title}</Link>
              ))
            }
          </div>

          {/* About Mesh */}
          <div className='flex flex-col gap-3 [&>a]:hover:underline'>
            <div className='font-bold'>ABOUT MESH</div>
            {
              linksAbout.map((item) => (
                <Link href={item.link} key={item.link}>{item.title}</Link>
              ))
            }
          </div>
        </div>

        <div className="border-t border-border pt-8 text-center text-sm">
          <p>
            &copy; 2025 Mesh.{' '}
            <Link
              href="https://github.com/MeshJS/mesh/blob/main/LICENSE.md"
              className="underline hover:text-foreground transition-colors"
            >
              Apache-2.0 license.
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}