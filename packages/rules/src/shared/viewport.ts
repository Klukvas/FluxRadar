import type { PageSnapshot } from '@fluxradar/crawler';
import { parsePage } from '../seo/dom.js';

export function viewportContents(page: PageSnapshot): readonly string[] {
  return parsePage(page)
    .querySelectorAll('meta')
    .filter((element) => element.getAttribute('name')?.trim().toLowerCase() === 'viewport')
    .map((element) => element.getAttribute('content') ?? '');
}

export function viewportDirectives(content: string): ReadonlyMap<string, string> {
  return new Map(
    content.split(/[,;]/).flatMap((part) => {
      const match = /^\s*([\w-]+)\s*=\s*(.*?)\s*$/.exec(part);
      return match?.[1] === undefined
        ? []
        : [[match[1].toLowerCase(), (match[2] ?? '').toLowerCase()] as const];
    }),
  );
}
