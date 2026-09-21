// Which network the crawler's requests leave from.
//
// The API runs on a hosting network that some audited sites block outright,
// and a blocked crawl does not look like a blocked crawl in a report — it looks
// like a site with no robots.txt that never answers 200. CRAWL_EGRESS_PROXY_URL
// points the crawl at a proxy on a network those sites accept.
//
// Absent is a valid, supported state: the crawl goes out directly, exactly as
// it did before. A value that is present but unusable is not: it would silently
// fall back to the blocked network, so it fails the boot by NAME. The value is
// a URL with a password in it and is never logged.

import type { EgressProxy } from '@fluxradar/safe-fetch';
import { parseEgressProxyUrl, ProxyConfigError } from '@fluxradar/safe-fetch';

export const CRAWL_EGRESS_PROXY_ENV_VAR = 'CRAWL_EGRESS_PROXY_URL';

export type CrawlEgressConfigResult =
  | { readonly state: 'configured'; readonly proxy: EgressProxy }
  | { readonly state: 'not_configured' }
  | { readonly state: 'invalid'; readonly missing: readonly string[]; readonly reason: string };

export function readCrawlEgressConfig(
  env: NodeJS.ProcessEnv = process.env,
): CrawlEgressConfigResult {
  const raw = env[CRAWL_EGRESS_PROXY_ENV_VAR]?.trim() ?? '';
  if (raw === '') {
    return { state: 'not_configured' };
  }
  try {
    return { state: 'configured', proxy: parseEgressProxyUrl(raw) };
  } catch (error) {
    const reason = error instanceof ProxyConfigError ? error.reason : 'unreadable value';
    return {
      state: 'invalid',
      missing: [CRAWL_EGRESS_PROXY_ENV_VAR],
      reason: `${CRAWL_EGRESS_PROXY_ENV_VAR} is set but unusable: ${reason}`,
    };
  }
}

/**
 * The proxy to crawl through, or null for a direct crawl. An unusable value
 * reads as null here — production never reaches this function with one,
 * because `validateRuntimeConfig` refuses to boot on it first.
 */
export function readCrawlEgressProxy(env: NodeJS.ProcessEnv = process.env): EgressProxy | null {
  const result = readCrawlEgressConfig(env);
  return result.state === 'configured' ? result.proxy : null;
}
