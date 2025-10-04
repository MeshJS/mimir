import * as heroIcons from '@heroicons/react/24/solid';
import * as simpleIcons from '@icons-pack/react-simple-icons';
import { createElement } from 'react';
import type { ReactElement } from 'react';

const invertIcons = [
  "icons/utxos-white.png",
  "icons/midnight.svg",
]

export function iconResolver(iconName?: string | null, className: string = ""): ReactElement | undefined {
  if (!iconName) {
    return undefined;
  }

  const HeroIcon = heroIcons[iconName as keyof typeof heroIcons];
  if (HeroIcon) {
    return createElement(HeroIcon, { className: 'w-6 h-6' });
  }

  const simpleIcon = simpleIcons[iconName as keyof typeof simpleIcons];
  if (simpleIcon) {
    return createElement(simpleIcon, { className: 'w-6 h-6' });
  }

  const invertClass = invertIcons.includes(iconName) ? "invert dark:invert-0" : "";

  return createElement('img', {
    src: `/${iconName}`,
    key: `${iconName}`,
    alt: `${iconName} icon`,
    className: `${className} ${invertClass}`,
    style: {
      width: className?.match(/w-(\d+)/) ? undefined : "16px",
      height: className?.match(/h-(\d+)/) ? undefined : "16px",
      objectFit: "contain",
    },
  });
}
