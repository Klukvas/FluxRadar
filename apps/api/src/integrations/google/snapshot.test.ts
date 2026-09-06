import { describe, expect, it, vi } from 'vitest';

import { fetchGoogleDataSnapshot, hasGoogleData, type GoogleBinding } from './snapshot.ts';
import type { GoogleAccess } from './tokens.ts';

const NOW = new Date('2026-09-06T12:00:00.000Z');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const noSleep = async (): Promise<void> => undefined;

const FULL_ACCESS: GoogleAccess = {
  accessToken: 'token',
  scopes: [],
  hasSearchConsoleScope: true,
  hasAnalyticsScope: true,
};

const BOUND: GoogleBinding = {
  searchConsoleSiteUrl: 'sc-domain:example.com',
  ga4PropertyId: '123456',
  ga4PropertyName: 'example',
};

function routedFetcher(routes: Readonly<Record<string, () => Response>>) {
  return vi.fn(async (url: unknown) => {
    const key = Object.keys(routes).find((candidate) => String(url).includes(candidate));
    if (key === undefined) throw new Error(`unexpected request: ${String(url)}`);
    return routes[key]?.() ?? json({});
  });
}

describe('fetchGoogleDataSnapshot', () => {
  it('reports each service independently when only one of them fails', async () => {
    const fetcher = routedFetcher({
      'webmasters/v3': () => json({ rows: [{ clicks: 1, impressions: 2, ctr: 0.5, position: 3 }] }),
      analyticsdata: () => json({ error: {} }, 403),
    });

    const snapshot = await fetchGoogleDataSnapshot({
      access: FULL_ACCESS,
      binding: BOUND,
      now: NOW,
      requestOptions: { fetcher: fetcher as unknown as typeof fetch, sleep: noSleep },
    });

    expect(snapshot.searchConsole.state).toBe('connected');
    expect(snapshot.searchConsole.data?.totals.clicks).toBe(1);
    expect(snapshot.analytics.state).toBe('no_access');
    expect(snapshot.analytics.data).toBeNull();
    expect(hasGoogleData(snapshot)).toBe(true);
  });

  it('marks an unbound service as no_property_selected without calling Google', async () => {
    const fetcher = routedFetcher({
      analyticsdata: () => json({ rows: [{ metricValues: [{ value: '1' }] }] }),
    });

    const snapshot = await fetchGoogleDataSnapshot({
      access: FULL_ACCESS,
      binding: { ...BOUND, searchConsoleSiteUrl: null },
      now: NOW,
      requestOptions: { fetcher: fetcher as unknown as typeof fetch, sleep: noSleep },
    });

    expect(snapshot.searchConsole.state).toBe('no_property_selected');
    expect(fetcher.mock.calls.some((call) => String(call[0]).includes('webmasters'))).toBe(false);
  });

  it('does not call a service the grant does not cover', async () => {
    const fetcher = routedFetcher({
      'webmasters/v3': () => json({ rows: [{ clicks: 1, impressions: 2, ctr: 0.5, position: 3 }] }),
    });

    const snapshot = await fetchGoogleDataSnapshot({
      access: { ...FULL_ACCESS, hasAnalyticsScope: false },
      binding: BOUND,
      now: NOW,
      requestOptions: { fetcher: fetcher as unknown as typeof fetch, sleep: noSleep },
    });

    expect(snapshot.analytics.state).toBe('no_access');
    expect(snapshot.analytics.detail).toContain('Reconnect Google');
  });

  it('records the period and read-only nature of the data it returns', async () => {
    const fetcher = routedFetcher({
      'webmasters/v3': () => json({ rows: [] }),
      analyticsdata: () => json({ rows: [] }),
    });

    const snapshot = await fetchGoogleDataSnapshot({
      access: FULL_ACCESS,
      binding: BOUND,
      now: NOW,
      requestOptions: { fetcher: fetcher as unknown as typeof fetch, sleep: noSleep },
    });

    expect(snapshot.readOnly).toBe(true);
    expect(snapshot.dateRange).toEqual({ startDate: '2026-08-07', endDate: '2026-09-03' });
    expect(snapshot.searchConsole.state).toBe('no_data');
    expect(snapshot.analytics.state).toBe('no_data');
    expect(hasGoogleData(snapshot)).toBe(false);
  });
});
