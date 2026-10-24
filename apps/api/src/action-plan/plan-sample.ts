// How a rule's sample addresses are cut before they may reach a provider.
//
// Shared by the issue rows and the GEO fact row of the Action Plan input, so a
// page address leaves the product under one rule, whichever path produced it.

export const MAX_SAMPLE_URLS = 3;

/**
 * The URL as it may be shown to a provider: origin and path only.
 *
 * Query and fragment are noise for a plan and routinely carry personal data
 * (session ids, emails in unsubscribe links, tracking parameters). Credentials
 * embedded in the URL are worse — `https://user:pass@host/` is a password, and
 * crawlers do meet such links — so a URL carrying them is dropped rather than
 * cleaned: the point is that it never reaches a prompt. Anything that is not
 * http(s) (`javascript:`, `data:`, `mailto:`) is not a page and is dropped too.
 */
export function pathOnly(targetUrl: string): string | null {
  try {
    const url = new URL(targetUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username !== '' || url.password !== '') return null;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/** The first `limit` distinct non-empty values, in order. */
export function takeDistinct(values: readonly string[], limit: number): readonly string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (value === '' || seen.has(value)) continue;
    seen.add(value);
    if (seen.size === limit) break;
  }
  return [...seen];
}
