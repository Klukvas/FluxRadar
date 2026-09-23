// The Bing section of a report: what it says when it has data, and what it says
// when it does not.
//
// Every state here is one a reader has to be able to tell apart from the others.
// "No site selected", "the grant does not cover this", "Bing has nothing for
// this period" and "Bing did not answer" send an owner to four different places,
// and collapsing any two of them into "unavailable" is the failure this file
// guards against.

import { describe, expect, it, vi } from 'vitest';

import { bingFindings } from './checks.ts';
import { fetchBingScanData, queriesWithin } from './snapshot.ts';
import type { BingAccess } from './tokens.ts';
import type { BingBinding } from './store.ts';

const NOW = new Date('2026-09-22T00:00:00.000Z');
const ACCESS: BingAccess = {
  accessToken: 'token',
  scopes: ['webmaster.read'],
  hasWebmasterScope: true,
};
const BOUND: BingBinding = { siteUrl: 'https://example.com/', verifiedAtSelection: true };

function day(offsetDays: number, clicks: number, impressions: number) {
  const date = new Date(NOW.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return {
    __type: 'RankAndTrafficStats:#Microsoft.Bing.Webmaster.Api',
    Clicks: clicks,
    Impressions: impressions,
    Date: `/Date(${date.getTime()})/`,
  };
}

/**
 * One `QueryStats` row: one query on ONE DAY, which is what Bing actually
 * returns. `offsetDays` places it relative to the scan, so a test can put rows
 * inside and outside the twenty-eight-day window.
 */
function queryOn(
  name: string,
  clicks: number,
  impressions: number,
  offsetDays: number,
  positions: { readonly impression?: number; readonly click?: number } = {},
) {
  const date = new Date(NOW.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return {
    __type: 'QueryStats:#Microsoft.Bing.Webmaster.Api',
    Query: name,
    Clicks: clicks,
    Impressions: impressions,
    AvgClickPosition: positions.click ?? 4,
    AvgImpressionPosition: positions.impression ?? 6,
    Date: `/Date(${date.getTime()})/`,
  };
}

function query(name: string, clicks: number, impressions: number) {
  return queryOn(name, clicks, impressions, 0);
}

/** Answers the traffic call and the query call by the method in the URL. */
function fetcherFor(traffic: unknown[], queries: unknown[], status = 200) {
  return vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = String(input);
    const body = url.includes('GetQueryStats') ? { d: queries } : { d: traffic };
    return new Response(JSON.stringify(body), { status });
  });
}

describe('fetchBingScanData', () => {
  it('reports no_property_selected before it spends a single request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const data = await fetchBingScanData({
      access: ACCESS,
      binding: { siteUrl: null, verifiedAtSelection: false },
      now: NOW,
      requestOptions: { fetcher },
    });

    expect(data.snapshot.webmaster.state).toBe('no_property_selected');
    expect(data.snapshot.webmaster.data).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports no_access for a grant without read scope, without asking Bing', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const data = await fetchBingScanData({
      access: { ...ACCESS, hasWebmasterScope: false },
      binding: BOUND,
      now: NOW,
      requestOptions: { fetcher },
    });

    expect(data.snapshot.webmaster.state).toBe('no_access');
    expect(data.snapshot.webmaster.detail).toContain('Reconnect');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('totals only the days inside the report period, and states how many there were', async () => {
    const fetcher = fetcherFor(
      [day(0, 10, 100), day(-5, 5, 50), day(-40, 999, 9_999)],
      [query('bing seo', 12, 120)],
    );
    const data = await fetchBingScanData({
      access: ACCESS,
      binding: BOUND,
      now: NOW,
      requestOptions: { fetcher },
    });

    const summary = data.snapshot.webmaster.data;
    expect(data.snapshot.webmaster.state).toBe('connected');
    expect(summary?.totals).toEqual({ clicks: 15, impressions: 150, ctr: 0.1, days: 2 });
    expect(summary?.siteUrl).toBe('https://example.com/');
    expect(data.snapshot.readOnly).toBe(true);
    expect(data.snapshot.source).toBe('bing');
  });

  it('compares against the period before, when Bing reported one', async () => {
    const fetcher = fetcherFor([day(0, 10, 100), day(-30, 40, 200)], []);
    const data = await fetchBingScanData({
      access: ACCESS,
      binding: BOUND,
      now: NOW,
      requestOptions: { fetcher },
    });

    expect(data.snapshot.webmaster.data?.previousTotals).toMatchObject({
      clicks: 40,
      impressions: 200,
    });
  });

  it('reports no_data for an authorized site Bing has nothing for', async () => {
    const data = await fetchBingScanData({
      access: ACCESS,
      binding: BOUND,
      now: NOW,
      requestOptions: { fetcher: fetcherFor([], []) },
    });
    expect(data.snapshot.webmaster.state).toBe('no_data');
    expect(data.detail).toBeNull();
  });

  it('keeps the traffic totals when only the query call fails', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) =>
        String(input).includes('GetQueryStats')
          ? new Response(JSON.stringify({ ErrorCode: 9, Message: 'Nope' }), { status: 400 })
          : new Response(JSON.stringify({ d: [day(0, 10, 100)] }), { status: 200 }),
      );
    const data = await fetchBingScanData({
      access: ACCESS,
      binding: BOUND,
      now: NOW,
      requestOptions: { fetcher, maxAttempts: 1 },
    });

    expect(data.snapshot.webmaster.state).toBe('connected');
    expect(data.snapshot.webmaster.data?.totals?.clicks).toBe(10);
    // Null, not an empty list: Bing was asked and did not answer, which is not
    // the same as Bing reporting that this site has no queries.
    expect(data.snapshot.webmaster.data?.topQueries).toBeNull();
    expect(data.snapshot.webmaster.data?.unavailableReads).toEqual(['queries']);
    expect(data.detail).toBeNull();
  });

  it('keeps the query list when only the traffic call fails, and states no totals', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) =>
        String(input).includes('GetRankAndTrafficStats')
          ? new Response(JSON.stringify({ ErrorCode: 9, Message: 'Nope' }), { status: 400 })
          : new Response(JSON.stringify({ d: [query('shoes', 4, 40)] }), { status: 200 }),
      );
    const data = await fetchBingScanData({
      access: ACCESS,
      binding: BOUND,
      now: NOW,
      requestOptions: { fetcher, maxAttempts: 1 },
    });

    expect(data.snapshot.webmaster.state).toBe('connected');
    // Zeroes here would read as "Bing sent this site no clicks at all".
    expect(data.snapshot.webmaster.data?.totals).toBeNull();
    expect(data.snapshot.webmaster.data?.topQueries).toHaveLength(1);
    expect(data.snapshot.webmaster.data?.unavailableReads).toEqual(['traffic']);
  });

  it('reports the provider state when both reads fail', async () => {
    const data = await fetchBingScanData({
      access: ACCESS,
      binding: BOUND,
      now: NOW,
      requestOptions: { fetcher: fetcherFor([], [], 401), maxAttempts: 1 },
    });
    expect(data.snapshot.webmaster.state).toBe('needs_reconnect');
    expect(data.snapshot.webmaster.data).toBeNull();
  });

  it('orders the top queries by clicks rather than trusting the payload order', async () => {
    const fetcher = fetcherFor(
      [day(0, 30, 300)],
      [query('small', 1, 10), query('large', 20, 40), query('middle', 9, 30)],
    );
    const data = await fetchBingScanData({
      access: ACCESS,
      binding: BOUND,
      now: NOW,
      requestOptions: { fetcher },
    });

    expect(data.snapshot.webmaster.data?.topQueries?.map((row) => row.query)).toEqual([
      'large',
      'middle',
      'small',
    ]);
  });

  it('leaves out query rows Bing returned for days outside the period', async () => {
    // Bing returns its whole retained history for queries exactly as it does for
    // traffic. A row from four months ago is not part of a 28-day report.
    const fetcher = fetcherFor(
      [day(0, 10, 100)],
      [queryOn('inside', 3, 30, -2), queryOn('ancient', 900, 9_000, -120)],
    );
    const data = await fetchBingScanData({
      access: ACCESS,
      binding: BOUND,
      now: NOW,
      requestOptions: { fetcher },
    });

    expect(data.snapshot.webmaster.data?.topQueries?.map((row) => row.query)).toEqual(['inside']);
    expect(data.detail?.rowsOutsidePeriod).toBe(1);
    expect(data.detail?.queries).toHaveLength(1);
  });

  it('adds one query’s days up instead of listing it once per day', async () => {
    const fetcher = fetcherFor(
      [day(0, 10, 100)],
      [
        queryOn('running shoes', 6, 100, 0, { impression: 2, click: 1 }),
        queryOn('running shoes', 4, 300, -3, { impression: 10, click: 5 }),
        queryOn('walking boots', 1, 50, -1),
      ],
    );
    const data = await fetchBingScanData({
      access: ACCESS,
      binding: BOUND,
      now: NOW,
      requestOptions: { fetcher },
    });

    const rows = data.snapshot.webmaster.data?.topQueries ?? [];
    expect(rows.map((row) => row.query)).toEqual(['running shoes', 'walking boots']);
    expect(rows[0]).toEqual({
      query: 'running shoes',
      clicks: 10,
      impressions: 400,
      // Recomputed over the period, not averaged from the daily rates.
      ctr: 0.025,
      // Impression-weighted: (2·100 + 10·300) / 400. A plain mean would say 6,
      // which no day of this query ever was.
      avgImpressionPosition: 8,
      // Click-weighted: (1·6 + 5·4) / 10.
      avgClickPosition: 2.6,
      days: 2,
    });
    expect(data.detail?.queriesComplete).toBe(true);
  });

  it('fails the query read when Bing states a day it cannot read, rather than guessing', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (input) =>
      String(input).includes('GetQueryStats')
        ? new Response(
            JSON.stringify({
              d: [{ ...query('shoes', 2, 20), Date: 'the day before yesterday' }],
            }),
            { status: 200 },
          )
        : new Response(JSON.stringify({ d: [day(0, 10, 100)] }), { status: 200 }),
    );
    const data = await fetchBingScanData({
      access: ACCESS,
      binding: BOUND,
      now: NOW,
      requestOptions: { fetcher, maxAttempts: 1 },
    });

    // A row that belongs to no day cannot be placed in a period, and a query
    // table that quietly left it out would look complete. The read is the thing
    // that failed, and the section says so.
    expect(data.snapshot.webmaster.data?.topQueries).toBeNull();
    expect(data.snapshot.webmaster.data?.unavailableReads).toEqual(['queries']);
    expect(data.snapshot.webmaster.data?.totals?.clicks).toBe(10);
  });
});

describe('queriesWithin', () => {
  const RANGE = { startDate: '2026-08-26', endDate: '2026-09-22' };

  function row(
    query: string,
    clicks: number,
    impressions: number,
    date: string | null,
    positions: { readonly impression?: number | null; readonly click?: number | null } = {},
  ) {
    return {
      query,
      clicks,
      impressions,
      ctr: impressions === 0 ? 0 : clicks / impressions,
      avgImpressionPosition: positions.impression === undefined ? 5 : positions.impression,
      avgClickPosition: positions.click === undefined ? 3 : positions.click,
      date,
    };
  }

  it('counts a row with no day at all rather than folding it into the period', () => {
    const detail = queriesWithin(
      [row('inside', 4, 40, '2026-09-01'), row('nowhere', 100, 1_000, null)],
      RANGE,
    );

    expect(detail.queries.map((entry) => entry.query)).toEqual(['inside']);
    expect(detail.rowsWithoutDate).toBe(1);
    // The totals cannot be called the period's totals while a row sits outside
    // time, so nothing derived from them may claim completeness either.
    expect(detail.queriesComplete).toBe(false);
  });

  it('leaves a query with no impressions without an invented position', () => {
    const detail = queriesWithin([row('zero', 0, 0, '2026-09-01')], RANGE);
    expect(detail.queries[0]).toMatchObject({
      ctr: 0,
      avgImpressionPosition: null,
      avgClickPosition: null,
    });
  });

  it('averages a position over the days that reported one, not over every impression', () => {
    // Bing answers `null` for a day it has no position for. Those impressions are
    // not evidence of any position, so they stay out of the denominator: counting
    // them would divide a real numerator by a larger weight and print a better
    // position than the site ever held.
    const detail = queriesWithin(
      [
        row('running shoes', 5, 100, '2026-09-01', { impression: 8, click: 3 }),
        row('running shoes', 5, 300, '2026-09-02', { impression: null, click: null }),
      ],
      RANGE,
    );

    expect(detail.queries[0]).toMatchObject({
      clicks: 10,
      impressions: 400,
      // 8, the one day that reported a position — not (8·100 + 0·300) / 400 = 2.
      avgImpressionPosition: 8,
      avgClickPosition: 3,
    });
  });

  it('leaves the position empty when no day of the query reported one', () => {
    const detail = queriesWithin(
      [row('running shoes', 5, 100, '2026-09-01', { impression: null, click: null })],
      RANGE,
    );

    expect(detail.queries[0]).toMatchObject({
      impressions: 100,
      avgImpressionPosition: null,
      avgClickPosition: null,
    });
  });

  it('says so when more queries answered than it keeps', () => {
    const many = Array.from({ length: 1_200 }, (_, index) =>
      row(`query ${index}`, index, index * 10, '2026-09-02'),
    );
    const detail = queriesWithin(many, RANGE);

    expect(detail.queries).toHaveLength(1_000);
    expect(detail.queriesComplete).toBe(false);
    // The cap keeps the leaders, so the figures shown are the real leaders'.
    expect(detail.queries[0]?.clicks).toBe(1_199);
  });
});

describe('bingFindings', () => {
  async function auditOf(traffic: unknown[], queries: unknown[]) {
    const data = await fetchBingScanData({
      access: ACCESS,
      binding: BOUND,
      now: NOW,
      requestOptions: { fetcher: fetcherFor(traffic, queries) },
    });
    return { data, findings: bingFindings(data.snapshot, data.detail) };
  }

  /** A full period of steady days, so the partial-period finding stays quiet. */
  function steadyPeriod(clicks: number, impressions: number, offset = 0) {
    return Array.from({ length: 28 }, (_, index) => day(-index - offset, clicks, impressions));
  }

  it('says nothing at all when there is no data behind it', async () => {
    const { findings } = await auditOf([], []);
    expect(findings).toEqual([]);
  });

  it('names a period-over-period collapse in clicks', async () => {
    const { findings } = await auditOf(
      [...steadyPeriod(1, 20), ...steadyPeriod(10, 20, 28)],
      [query('q', 28, 560)],
    );
    expect(findings.map((finding) => finding.code)).toContain('BING-TRAFFIC-DROP');
  });

  it('names impressions without a single click', async () => {
    const { findings } = await auditOf(steadyPeriod(0, 40), []);
    const noClicks = findings.find((finding) => finding.code === 'BING-NO-CLICKS');
    expect(noClicks?.evidence.impressions).toBe(1_120);
  });

  it('stays quiet about a rate it cannot compute from enough impressions', async () => {
    const { findings } = await auditOf(steadyPeriod(0, 1), []);
    expect(findings.map((finding) => finding.code)).not.toContain('BING-NO-CLICKS');
  });

  it('states a period Bing only partly reported instead of averaging over it', async () => {
    const { findings } = await auditOf([day(0, 5, 50), day(-1, 5, 50)], []);
    const partial = findings.find((finding) => finding.code === 'BING-PARTIAL-PERIOD');
    expect(partial?.evidence).toMatchObject({ reportedDays: 2, windowDays: 28 });
  });

  it('names traffic resting on one query', async () => {
    const { findings } = await auditOf(steadyPeriod(4, 40), [
      query('one query', 100, 400),
      query('another', 5, 40),
    ]);
    const concentration = findings.find((finding) => finding.code === 'BING-QUERY-CONCENTRATION');
    expect(concentration?.evidence.query).toBe('one query');
    expect(concentration?.summary).toContain('in this period');
  });

  it('measures concentration over the period, not over Bing’s whole history', async () => {
    // Inside the period the two queries are level. The apparent leader owes its
    // clicks to days before the period started, and used to carry the finding —
    // "one query brings 94% of this site's Bing clicks" — on a denominator that
    // was neither this period nor this query's own total.
    const { findings } = await auditOf(steadyPeriod(4, 40), [
      queryOn('history', 500, 5_000, -60),
      queryOn('history', 10, 100, -1),
      queryOn('steady', 10, 100, -2),
    ]);

    expect(findings.map((finding) => finding.code)).not.toContain('BING-QUERY-CONCENTRATION');
  });

  it('counts the same query’s days once in the table it draws its share from', async () => {
    const { data, findings } = await auditOf(steadyPeriod(4, 40), [
      queryOn('leader', 40, 400, 0),
      queryOn('leader', 40, 400, -1),
      queryOn('follower', 5, 100, -1),
    ]);
    const concentration = findings.find((finding) => finding.code === 'BING-QUERY-CONCENTRATION');

    expect(data.snapshot.webmaster.data?.topQueries?.map((row) => row.query)).toEqual([
      'leader',
      'follower',
    ]);
    // 80 of 85 clicks, from the two rows added up — not 40 of 85.
    expect(concentration?.evidence).toMatchObject({
      queryClicks: 80,
      totalClicks: 85,
      queriesCounted: 2,
      queriesComplete: 'yes',
    });
  });

  // The per-query detail is deliberately never persisted, so anything that
  // recomputes findings from a stored snapshot has only the capped leaderboard
  // to divide by. The share is then over those queries, and the sentence has to
  // say so rather than claim the site's whole period.
  it('does not claim a site total when it only has the capped leaderboard', async () => {
    const data = await fetchBingScanData({
      access: ACCESS,
      binding: BOUND,
      now: NOW,
      requestOptions: {
        fetcher: fetcherFor(steadyPeriod(4, 40), [
          query('leader', 100, 400),
          query('other', 5, 40),
        ]),
      },
    });

    const withoutDetail = bingFindings(data.snapshot, null).find(
      (finding) => finding.code === 'BING-QUERY-CONCENTRATION',
    );

    expect(withoutDetail?.evidence.queriesComplete).toBe('no');
    expect(withoutDetail?.summary).not.toContain("this site's Bing clicks");
    expect(withoutDetail?.summary).toContain('2 queries');
  });
});
