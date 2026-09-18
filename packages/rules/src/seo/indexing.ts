// How a page tells search engines whether and where to index it: the noindex
// directive and the canonical link. Shared by the SEO rules that judge these
// signals and by the Analytics page facts, which need the same reading to tell
// which crawled pages Google is allowed to show.

import type { PageSnapshot } from '@fluxradar/crawler';

import { parsePage, relTokens } from './dom.js';

const NOINDEX_TOKENS: ReadonlySet<string> = new Set(['noindex', 'none']);

/** Токены noindex/none в comma/colon-separated значении (case-insensitive). */
export function hasNoindexToken(value: string): boolean {
  return value
    .toLowerCase()
    .split(/[,:;]/)
    .map((token) => token.trim())
    .some((token) => NOINDEX_TOKENS.has(token));
}

/** Первый непустой href среди <link rel="canonical">; null — canonical нет. */
export function canonicalHref(page: PageSnapshot): string | null {
  const links = parsePage(page)
    .querySelectorAll('link')
    .filter((link) => relTokens(link).includes('canonical'));
  const href = links
    .map((link) => link.getAttribute('href')?.trim())
    .find((value): value is string => value !== undefined && value !== '');
  return href ?? null;
}

/** href против finalUrl; null — не разрешается в абсолютный http(s)-URL. */
export function resolveCanonical(href: string, baseUrl: string): URL | null {
  try {
    const resolved = new URL(href, baseUrl);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved : null;
  } catch {
    return null;
  }
}
