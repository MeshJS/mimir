import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import * as TabsComponents from 'fumadocs-ui/components/tabs';
import * as CardsComponents from 'fumadocs-ui/components/card';
import { InfoCard } from '@/components/ui/info-card';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    ...TabsComponents,
    Cards: CardsComponents.Cards,
    Card: CardsComponents.Card,
    InfoCard,
    ...components,
  };
}
