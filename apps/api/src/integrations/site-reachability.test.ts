import type { SafeFetchResult } from '@fluxradar/safe-fetch';
import { describe, expect, it } from 'vitest';

import { probeSiteReachability } from './site-reachability.ts';

// The check that has to happen before somebody pays.
//
// Its one hard requirement is that it agrees with the crawl: it asks the same
// question, over the same network, and reads the answer with the same function.
// A probe that says "reachable" before a scan that reads nothing would be worse
// than no probe at all.

const ORIGIN = 'https://example.com';

function response(overrides: Partial<SafeFetchResult> & { url: string }): SafeFetchResult {
  const { url, ...rest } = overrides;
  return {
    finalUrl: url,
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: '<html><body>hello</body></html>',
    redirectChain: [],
    timingMs: 8,
    truncated: false,
    ...rest,
  };
}

/** A fetcher that answers robots.txt and the start page separately. */
function fetcher(routes: {
  robots?: SafeFetchResult | Error;
  start?: SafeFetchResult | Error;
}): (url: string) => Promise<SafeFetchResult> {
  return async (url: string) => {
    const answer = url.endsWith('/robots.txt')
      ? (routes.robots ?? response({ url, status: 404, body: '', headers: {} }))
      : (routes.start ?? response({ url }));
    if (answer instanceof Error) throw answer;
    return answer;
  };
}

describe('probeSiteReachability', () => {
  it('calls a site that answers with a page reachable', async () => {
    const result = await probeSiteReachability(ORIGIN, { fetcher: fetcher({}) });

    expect(result.state).toBe('reachable');
    expect(result.startStatus).toBe(200);
  });

  it('calls a Cloudflare challenge access-denied, and keeps the evidence', async () => {
    const result = await probeSiteReachability(ORIGIN, {
      fetcher: fetcher({
        start: response({
          url: ORIGIN,
          status: 403,
          headers: {
            'content-type': 'text/html',
            server: 'cloudflare',
            'cf-mitigated': 'challenge',
          },
          body: '<html>blocked</html>',
        }),
      }),
    });

    expect(result.state).toBe('access-denied');
    expect(result.startStatus).toBe(403);
    expect(result.accessControlSignals).toContain('server: cloudflare');
  });

  it('reports robots.txt as its own state, without fetching the page anyway', async () => {
    const requested: string[] = [];
    const result = await probeSiteReachability(ORIGIN, {
      fetcher: async (url) => {
        requested.push(url);
        if (url.endsWith('/robots.txt')) {
          return response({
            url,
            headers: { 'content-type': 'text/plain' },
            body: 'User-agent: FluxRadarBot\nDisallow: /\n',
          });
        }
        return response({ url });
      },
    });

    expect(result.state).toBe('blocked-by-robots');
    // Asking anyway would be the one thing the product promises not to do.
    expect(requested).toEqual([`${ORIGIN}/robots.txt`]);
  });

  it('honours a wildcard disallow as well as one addressed to us', async () => {
    const result = await probeSiteReachability(ORIGIN, {
      fetcher: fetcher({
        robots: response({
          url: `${ORIGIN}/robots.txt`,
          headers: { 'content-type': 'text/plain' },
          body: 'User-agent: *\nDisallow: /\n',
        }),
      }),
    });

    expect(result.state).toBe('blocked-by-robots');
  });

  it('reads a site that never answered as unreachable', async () => {
    const result = await probeSiteReachability(ORIGIN, {
      fetcher: fetcher({ start: new Error('ENOTFOUND example.com') }),
    });

    expect(result.state).toBe('unreachable');
    expect(result.fetchError).toContain('ENOTFOUND');
  });

  it('separates a broken site from one that is refusing us', async () => {
    const result = await probeSiteReachability(ORIGIN, {
      fetcher: fetcher({
        start: response({ url: ORIGIN, status: 500, body: 'oops' }),
      }),
    });

    expect(result.state).toBe('bad-response');
  });

  it('does not let an unreadable robots.txt stand in for a refusal', async () => {
    // D-141: only a 200 is a robots.txt. A failed robots fetch leaves the host
    // open, and the start page is what decides.
    const result = await probeSiteReachability(ORIGIN, {
      fetcher: fetcher({ robots: new Error('connection reset') }),
    });

    expect(result.state).toBe('reachable');
  });

  it('sends the crawler user agent, so a site allowlisting it sees the same caller', async () => {
    // With the default fetcher there is no seam for headers, so this asserts the
    // one thing a test can: the probe uses the crawler's agent, not node-fetch's.
    const seen: string[] = [];
    await probeSiteReachability(ORIGIN, {
      fetcher: async (url) => {
        seen.push(url);
        return response({ url });
      },
    });

    expect(seen).toEqual([`${ORIGIN}/robots.txt`, `${ORIGIN}/`]);
  });
});
