// Разбор HTML снимков страниц: один parse на снимок (WeakMap-кэш), плюс
// мелкие DOM-хелперы, общие для нескольких SEO-правил.

import type { PageSnapshot } from '@fluxradar/crawler';
import type { HTMLElement } from 'node-html-parser';
import { parse } from 'node-html-parser';

const documentCache = new WeakMap<PageSnapshot, HTMLElement>();

/** Распарсенный документ снимка; html=null даёт пустой документ. */
export function parsePage(page: PageSnapshot): HTMLElement {
  const cached = documentCache.get(page);
  if (cached !== undefined) {
    return cached;
  }
  const root = parse(page.html ?? '');
  documentCache.set(page, root);
  return root;
}

/** content первого <meta name="..."> (имя — case-insensitive); null — тега нет. */
export function metaContent(root: HTMLElement, name: string): string | null {
  const wanted = name.toLowerCase();
  const meta = root
    .querySelectorAll('meta')
    .find((element) => element.getAttribute('name')?.trim().toLowerCase() === wanted);
  if (meta === undefined) {
    return null;
  }
  return meta.getAttribute('content') ?? '';
}

/** rel-токены элемента <link> lowercase (rel="Shortcut Icon" → ['shortcut','icon']). */
export function relTokens(link: HTMLElement): readonly string[] {
  return (link.getAttribute('rel') ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token !== '');
}

/** Длина в Unicode code points — та же метрика, что у лимитов §16. */
export function codePointLength(text: string): number {
  return [...text].length;
}
