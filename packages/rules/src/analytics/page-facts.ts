// What the Analytics module needs to know about each crawled page (D-219).
//
// Analytics runs after the scan outcome is settled, when the crawl is gone, so
// the scan hands it these facts instead of the pages: whether Google may show
// the page in search at all, and whether its HTML loads a Google tag. Both are
// read from the fetched HTML and headers only — nothing here runs the page.

import type { PageSnapshot } from '@fluxradar/crawler';
import { normalizeUrl } from '@fluxradar/fingerprint';

import { isSuccessfulHtmlPage, type SiteContext } from '../engine/types.js';
import { metaContent, parsePage } from '../seo/dom.js';
import { canonicalHref, hasNoindexToken, resolveCanonical } from '../seo/indexing.js';
import { headerValue } from '../shared/headers.js';

export interface AnalyticsPageFact {
  /** The URL the page was served from, after redirects. */
  readonly url: string;
  /** No noindex signal and no canonical pointing at another URL. */
  readonly indexable: boolean;
  /** The HTML loads gtag.js or Google Tag Manager. */
  readonly hasGoogleTag: boolean;
}

/**
 * The ways a page loads a Google tag in its HTML: the gtag.js loader (also when
 * a first-party proxy serves it), an inline `gtag('config', 'G-…')` call, the
 * Tag Manager loader, or a Tag Manager container id.
 */
const GOOGLE_TAG_PATTERNS: readonly RegExp[] = [
  /\/gtag\/js\?id=(?:G|GT|AW)-/i,
  /gtag\(\s*['"]config['"]\s*,\s*['"]G-[A-Z0-9]+['"]/i,
  /googletagmanager\.com\/gtm\.js/i,
  /\bGTM-[A-Z0-9]{4,}\b/,
];

export function analyticsPageFacts(ctx: SiteContext): readonly AnalyticsPageFact[] {
  return ctx.crawl.pages.filter(isSuccessfulHtmlPage).flatMap((page) => {
    const url = normalizedOrNull(page.finalUrl);
    if (url === null) return [];
    return [
      {
        url: page.finalUrl,
        indexable: isIndexable(page, url),
        hasGoogleTag: GOOGLE_TAG_PATTERNS.some((pattern) => pattern.test(page.html ?? '')),
      },
    ];
  });
}

function isIndexable(page: PageSnapshot, normalizedUrl: string): boolean {
  const metaRobots = metaContent(parsePage(page), 'robots');
  const headerRobots = headerValue(page, 'x-robots-tag');
  if ([metaRobots, headerRobots].some((value) => value !== null && hasNoindexToken(value))) {
    return false;
  }
  const href = canonicalHref(page);
  if (href === null) return true;
  const target = resolveCanonical(href, page.finalUrl);
  // An unreadable canonical says nothing about where the page belongs.
  return target === null || normalizedOrNull(target.toString()) === normalizedUrl;
}

function normalizedOrNull(url: string): string | null {
  try {
    return normalizeUrl(url);
  } catch {
    // Not a URL fingerprinting can read (userinfo, a non-web scheme): there is
    // no page key to compare it by, so the caller treats it as absent.
    return null;
  }
}
