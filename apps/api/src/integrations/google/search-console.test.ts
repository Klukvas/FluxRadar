import { describe, expect, it, vi } from 'vitest';

import { fetchSearchConsoleData, listSearchConsoleSites } from './search-console.ts';

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

interface QueryBody {
  readonly startDate: string;
  readonly dimensions: readonly string[];
  readonly rowLimit: number;
}

function bodyOf(init: RequestInit | undefined): QueryBody {
  return JSON.parse(String(init?.body)) as QueryBody;
}

/** Answers each searchAnalytics.query by what it asked for, not by call order. */
function searchConsole(answers: {
  readonly totals: unknown;
  readonly previousTotals: unknown;
  readonly queries: unknown;
  readonly pages: unknown;
}) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = bodyOf(init);
    if (body.dimensions.length === 0) {
      return json(body.startDate === RANGE.startDate ? answers.totals : answers.previousTotals);
    }
    return json(body.dimensions[0] === 'query' ? answers.queries : answers.pages);
  });
}

function pageRow(index: number) {
  return {
    keys: [`https://example.com/p-${index}`],
    clicks: 100 - index,
    impressions: 1000,
    ctr: 0.1,
    position: 5,
  };
}

describe('fetchSearchConsoleData', () => {
  it('normalizes totals, the previous period and the top queries and pages', async () => {
    const fetcher = searchConsole({
      totals: { rows: [{ clicks: 120, impressions: 4000, ctr: 0.03, position: 12.5 }] },
      previousTotals: { rows: [{ clicks: 200, impressions: 5000, ctr: 0.04, position: 11 }] },
      queries: {
        rows: [{ keys: ['flux radar'], clicks: 30, impressions: 500, ctr: 0.06, position: 4 }],
      },
      pages: {
        rows: [
          { keys: ['https://example.com/'], clicks: 90, impressions: 3000, ctr: 0.03, position: 9 },
        ],
      },
    });

    const data = await fetchSearchConsoleData('token', 'sc-domain:example.com', RANGE, {
      fetcher: fetcher as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(data?.summary).toEqual({
      siteUrl: 'sc-domain:example.com',
      totals: { clicks: 120, impressions: 4000, ctr: 0.03, position: 12.5 },
      previousTotals: { clicks: 200, impressions: 5000, ctr: 0.04, position: 11 },
      topQueries: [{ key: 'flux radar', clicks: 30, impressions: 500, ctr: 0.06, position: 4 }],
      topPages: [
        { key: 'https://example.com/', clicks: 90, impressions: 3000, ctr: 0.03, position: 9 },
      ],
    });
    expect(data?.detail.pagesComplete).toBe(true);
    // The previous period is the 28 days before the report period.
    const previousBody = fetcher.mock.calls
      .map(([, init]) => bodyOf(init))
      .find((body) => body.startDate !== RANGE.startDate);
    expect(previousBody).toMatchObject({ startDate: '2026-07-10', dimensions: [] });
  });

  // The report shows ten rows per table; the Analytics checks read every row,
  // so the top rows are the head of the full list rather than a second request.
  it('shows the first ten rows and keeps the full lists for the checks', async () => {
    const fetcher = searchConsole({
      totals: { rows: [{ clicks: 1, impressions: 1, ctr: 1, position: 1 }] },
      previousTotals: { rows: [] },
      queries: { rows: [] },
      pages: { rows: Array.from({ length: 25 }, (_, index) => pageRow(index)) },
    });

    const data = await fetchSearchConsoleData('token', 'sc-domain:example.com', RANGE, {
      fetcher: fetcher as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(data?.summary.topPages).toHaveLength(10);
    expect(data?.summary.previousTotals).toBeNull();
    expect(data?.detail.pages).toHaveLength(25);
    const pagesBody = fetcher.mock.calls
      .map(([, init]) => bodyOf(init))
      .find((body) => body.dimensions[0] === 'page');
    expect(pagesBody?.rowLimit).toBe(5_000);
  });

  it('marks a page list that reached the row limit as incomplete', async () => {
    const fetcher = searchConsole({
      totals: { rows: [{ clicks: 1, impressions: 1, ctr: 1, position: 1 }] },
      previousTotals: { rows: [] },
      queries: { rows: [] },
      pages: { rows: Array.from({ length: 5_000 }, (_, index) => pageRow(index)) },
    });

    const data = await fetchSearchConsoleData('token', 'sc-domain:example.com', RANGE, {
      fetcher: fetcher as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(data?.detail.pagesComplete).toBe(false);
  });

  it('URL-encodes the property so a domain property addresses the right resource', async () => {
    const fetcher = vi.fn(async () => json({ rows: [] }));

    await fetchSearchConsoleData('token', 'sc-domain:example.com', RANGE, {
      fetcher: fetcher as unknown as typeof fetch,
      sleep: noSleep,
    });

    const [url] = fetcher.mock.calls[0] as unknown as [string];
    expect(url).toContain('sc-domain%3Aexample.com');
  });

  it('reports an authorized property with no rows as no data rather than an error', async () => {
    const fetcher = vi.fn(async () => json({ rows: [] }));

    await expect(
      fetchSearchConsoleData('token', 'https://example.com/', RANGE, {
        fetcher: fetcher as unknown as typeof fetch,
        sleep: noSleep,
      }),
    ).resolves.toBeNull();
  });

  it('propagates a permission failure as no_access', async () => {
    const fetcher = vi.fn(async () => json({ error: {} }, 403));

    await expect(
      fetchSearchConsoleData('token', 'https://example.com/', RANGE, {
        fetcher: fetcher as unknown as typeof fetch,
        sleep: noSleep,
      }),
    ).rejects.toMatchObject({ state: 'no_access' });
  });
});
