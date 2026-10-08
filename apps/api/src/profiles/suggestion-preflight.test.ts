import type { SafeFetchResult } from '@fluxradar/safe-fetch';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../http/errors.ts';
import { assertSiteReadable } from './suggestion-preflight.ts';

function response(url: string, status: number, body: string, extraHeaders = {}): SafeFetchResult {
  return {
    finalUrl: url,
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...extraHeaders },
    body,
    redirectChain: [],
    timingMs: 3,
    truncated: false,
  };
}

function site(start: (url: string) => SafeFetchResult, robots?: SafeFetchResult) {
  return vi.fn(async (url: string) =>
    url.endsWith('/robots.txt') ? (robots ?? response(url, 404, 'not found')) : start(url),
  );
}

async function refusal(fetcher: (url: string) => Promise<SafeFetchResult>): Promise<ApiError> {
  try {
    await assertSiteReadable('https://example.test', { fetcher });
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected the preflight to refuse');
}

describe('autofill reachability preflight', () => {
  it('lets a readable homepage through and hands back what the site answered', async () => {
    const result = await assertSiteReadable('https://example.test', {
      fetcher: site((url) => response(url, 200, '<html><body>hi</body></html>')),
    });

    expect(result.state).toBe('reachable');
    expect(result.startStatus).toBe(200);
  });

  it('refuses a homepage its own robots.txt disallows, without fetching it', async () => {
    const fetcher = site(
      (url) => response(url, 200, '<html><body>secret</body></html>'),
      response('https://example.test/robots.txt', 200, 'User-agent: *\nDisallow: /', {
        'content-type': 'text/plain',
      }),
    );

    const error = await refusal(fetcher);

    expect(error.status).toBe(409);
    expect(error.code).toBe('SITE_BLOCKED_BY_ROBOTS');
    // The one request that went out was the robots.txt that said no.
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['https://example.test/robots.txt']);
  });

  it('names a crawler refusal apart from a broken site', async () => {
    const denied = await refusal(
      site((url) => response(url, 403, '<html>blocked</html>', { server: 'cloudflare' })),
    );
    // 503 is deliberately not used here: the crawler counts it among the
    // statuses an access-control layer answers with, and this case is a site
    // that is broken for everybody.
    const broken = await refusal(site((url) => response(url, 500, 'upstream error')));

    expect(denied.code).toBe('SITE_ACCESS_DENIED');
    expect(broken.code).toBe('SITE_BAD_RESPONSE');
  });

  it('reports a site that never answered', async () => {
    const error = await refusal(
      vi.fn(async (url: string) => {
        if (url.endsWith('/robots.txt')) return response(url, 404, 'not found');
        throw new Error('getaddrinfo ENOTFOUND example.test');
      }),
    );

    expect(error.code).toBe('SITE_UNREACHABLE');
    // What the resolver said stays in the probe result for the log; the message
    // the owner reads is about their site, not about our network.
    expect(error.message).not.toContain('ENOTFOUND');
  });

  it('treats a page served without HTML as unreadable rather than reachable', async () => {
    const error = await refusal(
      site((url) => response(url, 200, '%PDF-1.7', { 'content-type': 'application/pdf' })),
    );

    expect(error.code).toBe('SITE_BAD_RESPONSE');
  });
});
