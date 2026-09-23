// Who we say we are when we knock on a customer's site.
//
// The name alone was `FluxRadarBot/0.1`, which is enough to be recognised and
// not enough to be let in. An owner whose WAF had refused us — see the
// 2026-09-21 Cloudflare block — had a string in their logs, no way to find out
// what it was, and nothing to put in an allowlist. The `+URL` comment is the
// convention every serious crawler follows for exactly that reason, and it
// points at a page that tells them who we are and gives them the rule to paste.
//
// Robots matching is unaffected: `selectRules` matches a `User-agent:` token as
// a case-insensitive substring of this string, so a `User-agent: FluxRadarBot`
// group still applies (`robots.test.ts` pins that).

/** The page the `+URL` comment points at. Public, and named in `/robots.txt`. */
export const CRAWLER_INFO_URL = 'https://fluxradar.net/bot';

/** The product token a site's robots.txt names to address us specifically. */
export const CRAWLER_PRODUCT_TOKEN = 'FluxRadarBot';

export const CRAWLER_VERSION = '0.1';

/** What every FluxRadar request sends as its `user-agent`. */
export const CRAWLER_USER_AGENT = `${CRAWLER_PRODUCT_TOKEN}/${CRAWLER_VERSION} (+${CRAWLER_INFO_URL})`;

/**
 * The user agent for one crawl, by the device it is emulating.
 *
 * The suffix is what tells a site to serve its mobile markup; the product token
 * stays first so an allowlist entry written for one device covers both.
 */
export function crawlerUserAgent(device: 'desktop' | 'mobile'): string {
  return device === 'mobile' ? `${CRAWLER_USER_AGENT} Mobile` : CRAWLER_USER_AGENT;
}
