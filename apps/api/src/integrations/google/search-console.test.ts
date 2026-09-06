import { describe, expect, it, vi } from 'vitest';

import { fetchSearchConsoleSummary, listSearchConsoleSites } from './search-console.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const RANGE = { startDate: '2026-08-07', endDate: '2026-09-03' };
const noSleep = async (): Promise<void> => undefined;

describe('listSearchConsoleSites', () => {
  it('keeps only properties the account can actually read', async () => {
    const fetcher = vi.fn(async () =>
      json({
        siteEntry: [
          { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
          { siteUrl: 'https://readonly.test/', permissionLevel: 'siteRestrictedUser' },
          { siteUrl: 'https://unverified.test/', permissionLevel: 'siteUnverifiedUser' },
        ],
      }),
    );

    const sites = await listSearchConsoleSites('token', {
      fetcher: fetcher as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(sites.map((site) => site.siteUrl)).toEqual([
      'sc-domain:example.com',
      'https://readonly.test/',
    ]);
  });

  it('returns an empty list when the account has no properties', async () => {
    const fetcher = vi.fn(async () => json({}));

    await expect(
      listSearchConsoleSites('token', {
        fetcher: fetcher as unknown as typeof fetch,
        sleep: noSleep,
      }),
    ).resolves.toEqual([]);
  });
});

describe('fetchSearchConsoleSummary', () => {
  it('normalizes totals and the top queries and pages', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({ rows: [{ clicks: 120, impressions: 4000, ctr: 0.03, position: 12.5 }] }),
      )
      .mockResolvedValueOnce(
        json({
          rows: [{ keys: ['flux radar'], clicks: 30, impressions: 500, ctr: 0.06, position: 4 }],
        }),
      )
      .mockResolvedValueOnce(
        json({
          rows: [
            {
              keys: ['https://example.com/'],
              clicks: 90,
              impressions: 3000,
              ctr: 0.03,
              position: 9,
            },
          ],
        }),
      );

    const summary = await fetchSearchConsoleSummary('token', 'sc-domain:example.com', RANGE, {
      fetcher: fetcher as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(summary).toEqual({
      siteUrl: 'sc-domain:example.com',
      totals: { clicks: 120, impressions: 4000, ctr: 0.03, position: 12.5 },
      topQueries: [{ key: 'flux radar', clicks: 30, impressions: 500, ctr: 0.06, position: 4 }],
      topPages: [
        { key: 'https://example.com/', clicks: 90, impressions: 3000, ctr: 0.03, position: 9 },
      ],
    });
  });

  it('URL-encodes the property so a domain property addresses the right resource', async () => {
    const fetcher = vi.fn(async () => json({ rows: [] }));

    await fetchSearchConsoleSummary('token', 'sc-domain:example.com', RANGE, {
      fetcher: fetcher as unknown as typeof fetch,
      sleep: noSleep,
    });

    const [url] = fetcher.mock.calls[0] as unknown as [string];
    expect(url).toContain('sc-domain%3Aexample.com');
  });

  it('reports an authorized property with no rows as no data rather than an error', async () => {
    const fetcher = vi.fn(async () => json({ rows: [] }));

    await expect(
      fetchSearchConsoleSummary('token', 'https://example.com/', RANGE, {
        fetcher: fetcher as unknown as typeof fetch,
        sleep: noSleep,
      }),
    ).resolves.toBeNull();
  });

  it('propagates a permission failure as no_access', async () => {
    const fetcher = vi.fn(async () => json({ error: {} }, 403));

    await expect(
      fetchSearchConsoleSummary('token', 'https://example.com/', RANGE, {
        fetcher: fetcher as unknown as typeof fetch,
        sleep: noSleep,
      }),
    ).rejects.toMatchObject({ state: 'no_access' });
  });
});
