import { describe, expect, it, vi } from 'vitest';

import { fetchGa4Summary, listGa4Properties } from './analytics.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const RANGE = { startDate: '2026-08-07', endDate: '2026-09-03' };
const noSleep = async (): Promise<void> => undefined;

function report(values: readonly string[]): Response {
  return json({ rows: [{ metricValues: values.map((value) => ({ value })) }] });
}

describe('listGa4Properties', () => {
  it('flattens account summaries into selectable properties', async () => {
    const fetcher = vi.fn(async () =>
      json({
        accountSummaries: [
          {
            displayName: 'FluxLab',
            propertySummaries: [
              { property: 'properties/123456', displayName: 'fluxradar.net' },
              { property: 'not-a-property', displayName: 'ignored' },
            ],
          },
        ],
      }),
    );

    const properties = await listGa4Properties('token', {
      fetcher: fetcher as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(properties).toEqual([
      { propertyId: '123456', displayName: 'fluxradar.net', accountName: 'FluxLab' },
    ]);
  });
});

describe('fetchGa4Summary', () => {
  it('normalizes the core metrics and the renamed key-events metric', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(report(['1200', '1500', '4300', '9000']))
      .mockResolvedValueOnce(report(['42']));

    const summary = await fetchGa4Summary('token', '123456', 'fluxradar.net', RANGE, {
      fetcher: fetcher as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(summary).toEqual({
      propertyId: '123456',
      propertyName: 'fluxradar.net',
      users: 1200,
      sessions: 1500,
      pageViews: 4300,
      events: 9000,
      keyEvents: 42,
    });
  });

  // D-219: GA4 omits an all-zero row, so a property with no key events used to
  // read as "does not report key events" and the key-events check never fired.
  it('reads a period without key events as zero, not as unknown', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(report(['7', '9', '26', '46']))
      .mockResolvedValueOnce(json({ rows: [] }));

    const summary = await fetchGa4Summary('token', '123456', null, RANGE, {
      fetcher: fetcher as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(summary?.keyEvents).toBe(0);
    const [, init] = fetcher.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      metrics: [{ name: 'keyEvents' }],
      keepEmptyRows: true,
    });
  });

  it('keeps the core metrics when the property rejects keyEvents', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(report(['10', '12', '30', '55']))
      .mockResolvedValueOnce(json({ error: {} }, 400));

    const summary = await fetchGa4Summary('token', '123456', null, RANGE, {
      fetcher: fetcher as unknown as typeof fetch,
      sleep: noSleep,
    });

    expect(summary?.keyEvents).toBeNull();
    expect(summary?.users).toBe(10);
  });

  it('still surfaces a revoked grant discovered on the optional metric', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(report(['10', '12', '30', '55']))
      .mockResolvedValueOnce(json({ error: {} }, 401));

    await expect(
      fetchGa4Summary('token', '123456', null, RANGE, {
        fetcher: fetcher as unknown as typeof fetch,
        sleep: noSleep,
      }),
    ).rejects.toMatchObject({ state: 'needs_reconnect' });
  });

  it('reports a property with no rows as no data', async () => {
    const fetcher = vi.fn(async () => json({ rows: [] }));

    await expect(
      fetchGa4Summary('token', '123456', null, RANGE, {
        fetcher: fetcher as unknown as typeof fetch,
        sleep: noSleep,
      }),
    ).resolves.toBeNull();
  });
});
