// Matching a crawled URL against Search Console. Search Console reports pages
// by the URL Google indexed, the crawl by the URL the server answered on, and
// the two disagree on things that do not make them different pages: the scheme
// and a trailing slash.

import { normalizeUrl } from '@fluxradar/fingerprint';

const DOMAIN_PROPERTY_PREFIX = 'sc-domain:';

/** One key for every spelling of the same page; null for a URL that cannot be read. */
export function pageKey(url: string): string | null {
  try {
    const normalized = new URL(normalizeUrl(url));
    const path =
      normalized.pathname.length > 1
        ? normalized.pathname.replace(/\/+$/, '')
        : normalized.pathname;
    return `${normalized.host}${path}${normalized.search}`;
  } catch {
    return null;
  }
}

/**
 * Whether a Search Console property reports on this URL at all: a domain
 * property covers the domain and its subdomains on any scheme, a URL-prefix
 * property only the URLs that start with its prefix.
 */
export function isInPropertyScope(siteUrl: string, url: string): boolean {
  let target: URL;
  try {
    target = new URL(normalizeUrl(url));
  } catch {
    return false;
  }
  if (siteUrl.startsWith(DOMAIN_PROPERTY_PREFIX)) {
    const domain = siteUrl.slice(DOMAIN_PROPERTY_PREFIX.length).toLowerCase();
    return target.hostname === domain || target.hostname.endsWith(`.${domain}`);
  }
  try {
    return target.toString().startsWith(normalizeUrl(siteUrl));
  } catch {
    return false;
  }
}
