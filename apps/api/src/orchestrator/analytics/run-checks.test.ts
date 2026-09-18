import { describe, expect, it } from 'vitest';

import {
  checkInput,
  detail,
  ga4Summary,
  page,
  row,
  searchConsoleSummary,
  snapshotWith,
} from '../../test-utils/analytics-fixtures.ts';
import { runAnalyticsChecks } from './run-checks.ts';
import type { AnalyticsCheck, AnalyticsCheckInput } from './types.ts';

// D-219: connecting Google used to add numbers to the report and check nothing.
// Each test below pins one check: what it looks at, and when it stays quiet
// because the data cannot carry a verdict.

function check(input: AnalyticsCheckInput, ruleId: string): AnalyticsCheck {
  const found = runAnalyticsChecks(input).checks.find((entry) => entry.ruleId === ruleId);
  if (found === undefined) throw new Error(`no ${ruleId} in the run`);
  return found;
}

describe('the organic search trend (ANALYTICS-SC-001)', () => {
  it('flags clicks that fell by 30% or more against the previous 28 days', () => {
    const input = checkInput({
      snapshot: snapshotWith(
        searchConsoleSummary({
          totals: { clicks: 60, impressions: 5000, ctr: 0.01, position: 10 },
          previousTotals: { clicks: 100, impressions: 5000, ctr: 0.02, position: 10 },
        }),
        ga4Summary(),
      ),
    });

    const trend = check(input, 'ANALYTICS-SC-001');

    expect(trend).toMatchObject({ applicableTargets: 1, affectedTargets: 1 });
    expect(trend.findings[0]).toMatchObject({
      targetKind: 'site',
      targetUrl: 'https://example.com',
      evidence: {
        code: 'analytics-sc-001.evidence.clicks',
        params: { previous: 100, current: 60, drop: 40 },
      },
    });
    expect(runAnalyticsChecks(input).analysis.trend).toEqual({
      metric: 'clicks',
      previous: 100,
      current: 60,
    });
  });

  it('passes a fall smaller than 30%', () => {
    const input = checkInput({
      snapshot: snapshotWith(
        searchConsoleSummary({
          totals: { clicks: 75, impressions: 5000, ctr: 0.01, position: 10 },
          previousTotals: { clicks: 100, impressions: 5000, ctr: 0.02, position: 10 },
        }),
        ga4Summary(),
      ),
    });

    expect(check(input, 'ANALYTICS-SC-001')).toMatchObject({
      applicableTargets: 1,
      affectedTargets: 0,
    });
  });

  it('measures impressions when the site has too few clicks for a trend', () => {
    const input = checkInput({
      snapshot: snapshotWith(
        searchConsoleSummary({
          totals: { clicks: 0, impressions: 130, ctr: 0, position: 22 },
          previousTotals: { clicks: 2, impressions: 400, ctr: 0, position: 20 },
        }),
        ga4Summary(),
      ),
    });

    expect(check(input, 'ANALYTICS-SC-001').findings[0]?.evidence).toMatchObject({
      code: 'analytics-sc-001.evidence.impressions',
      params: { previous: 400, current: 130, drop: 68 },
    });
  });

  it('stays quiet on a site too small for either measure, or with no previous period', () => {
    const tiny = checkInput({
      snapshot: snapshotWith(
        searchConsoleSummary({
          totals: { clicks: 0, impressions: 10, ctr: 0, position: 30 },
          previousTotals: { clicks: 3, impressions: 80, ctr: 0, position: 30 },
        }),
        ga4Summary(),
      ),
    });
    const noHistory = checkInput({
      snapshot: snapshotWith(searchConsoleSummary({ previousTotals: null }), ga4Summary()),
    });

    for (const input of [tiny, noHistory]) {
      expect(check(input, 'ANALYTICS-SC-001')).toMatchObject({
        ran: true,
        applicableTargets: 0,
        findings: [],
      });
    }
  });
});

describe('first-page impressions without clicks (ANALYTICS-SC-002)', () => {
  it('flags a page shown often on the first page that nobody clicked', () => {
    const input = checkInput({
      searchConsoleDetail: detail({
        pages: [
          row('https://example.com/pricing', { clicks: 0, impressions: 80, position: 4.26 }),
          row('https://example.com/', { clicks: 12, impressions: 900, position: 3 }),
          // Second page: nobody is expected to click it.
          row('https://example.com/blog', { clicks: 0, impressions: 300, position: 16.9 }),
          // Too few impressions to judge a click-through rate.
          row('https://example.com/about', { clicks: 0, impressions: 12, position: 2 }),
        ],
      }),
    });

    const result = check(input, 'ANALYTICS-SC-002');

    expect(result).toMatchObject({ applicableTargets: 2, affectedTargets: 1 });
    expect(result.findings).toEqual([
      expect.objectContaining({
        targetKind: 'page',
        targetUrl: 'https://example.com/pricing',
        evidence: {
          code: 'analytics-sc-002.evidence',
          params: { impressions: 80, position: '4.3' },
        },
      }),
    ]);
  });

  it('counts a page Search Console lists under two spellings once', () => {
    const input = checkInput({
      searchConsoleDetail: detail({
        pages: [
          row('https://example.com/pricing/', { clicks: 0, impressions: 80, position: 4 }),
          row('http://example.com/pricing', { clicks: 0, impressions: 60, position: 5 }),
        ],
      }),
    });

    expect(check(input, 'ANALYTICS-SC-002')).toMatchObject({
      applicableTargets: 1,
      affectedTargets: 1,
    });
  });
});

describe('queries close to the top results (ANALYTICS-SC-003)', () => {
  it('lists queries at positions 8 to 20 by impressions without costing anything', () => {
    const input = checkInput({
      searchConsoleDetail: detail({
        queries: [
          row('jobber ai', { impressions: 13, position: 21.3 }),
          row('jobber blog', { impressions: 40, position: 12 }),
          row('job cover', { impressions: 90, position: 18.5 }),
          row('jobber login', { impressions: 25, position: 8.4 }),
          row('jobber', { impressions: 500, position: 2 }),
          row('rare query', { impressions: 3, position: 14 }),
        ],
      }),
    });
    const run = runAnalyticsChecks(input);

    expect(run.analysis.nearTop).toEqual([
      { query: 'job cover', impressions: 90, position: 18.5 },
      { query: 'jobber blog', impressions: 40, position: 12 },
      { query: 'jobber login', impressions: 25, position: 8.4 },
    ]);
    expect(check(input, 'ANALYTICS-SC-003')).toMatchObject({ affectedTargets: 1, findings: [] });
  });
});

describe('crawled pages without search impressions (ANALYTICS-SC-004)', () => {
  const shown = detail({
    pages: [row('https://example.com/'), row('https://example.com/blog/')],
  });

  it('flags an indexable crawled page Search Console never showed', () => {
    const input = checkInput({
      searchConsoleDetail: shown,
      pages: [
        page('/'),
        // Search Console lists it with a trailing slash; it is the same page.
        page('/blog'),
        page('/pricing'),
        // Google is told not to show it, so no impressions is expected.
        page('/thank-you', { indexable: false }),
      ],
    });

    const result = check(input, 'ANALYTICS-SC-004');

    expect(result).toMatchObject({ applicableTargets: 3, affectedTargets: 1 });
    expect(result.findings.map((finding) => finding.targetUrl)).toEqual([
      'https://example.com/pricing',
    ]);
  });

  it('leaves out pages the Search Console property does not cover', () => {
    const input = checkInput({
      snapshot: snapshotWith(
        searchConsoleSummary({ siteUrl: 'https://example.com/blog/' }),
        ga4Summary(),
      ),
      searchConsoleDetail: shown,
      pages: [page('/pricing'), page('/blog/new-post')],
    });

    expect(check(input, 'ANALYTICS-SC-004')).toMatchObject({
      applicableTargets: 1,
      affectedTargets: 1,
    });
  });

  it('does not judge against a page list cut off at the row limit', () => {
    const input = checkInput({
      searchConsoleDetail: detail({ pages: [row('https://example.com/')], pagesComplete: false }),
      pages: [page('/pricing')],
    });

    expect(check(input, 'ANALYTICS-SC-004')).toMatchObject({ ran: true, applicableTargets: 0 });
  });
});

describe('search impressions without clicks (ANALYTICS-SC-005)', () => {
  // The owner's example: "130 показов и 0 кликов — это готовая находка".
  it('flags a site Google shows that nobody clicks through to', () => {
    const input = checkInput({
      snapshot: snapshotWith(
        searchConsoleSummary({ totals: { clicks: 0, impressions: 130, ctr: 0, position: 22.6 } }),
        ga4Summary(),
      ),
    });

    expect(check(input, 'ANALYTICS-SC-005').findings[0]).toMatchObject({
      targetKind: 'site',
      evidence: {
        code: 'analytics-sc-005.evidence',
        params: { impressions: 130, position: '22.6' },
      },
    });
  });

  it('passes a site with clicks and stays quiet on too few impressions', () => {
    const clicked = checkInput();
    const thin = checkInput({
      snapshot: snapshotWith(
        searchConsoleSummary({ totals: { clicks: 0, impressions: 40, ctr: 0, position: 30 } }),
        ga4Summary(),
      ),
    });

    expect(check(clicked, 'ANALYTICS-SC-005')).toMatchObject({
      applicableTargets: 1,
      affectedTargets: 0,
    });
    expect(check(thin, 'ANALYTICS-SC-005')).toMatchObject({ ran: true, applicableTargets: 0 });
  });
});

describe('key events recorded (ANALYTICS-GA-001)', () => {
  it('flags a busy property that recorded no key events', () => {
    const input = checkInput({
      snapshot: snapshotWith(searchConsoleSummary(), ga4Summary({ sessions: 500, keyEvents: 0 })),
    });

    expect(check(input, 'ANALYTICS-GA-001').findings[0]).toMatchObject({
      targetKind: 'site',
      evidence: {
        code: 'analytics-ga-001.evidence',
        params: { property: 'example.com', sessions: 500 },
      },
    });
  });

  // The owner's own property: 9 sessions and no key events is still a finding —
  // any traffic at all shows whether anything is marked as a key event.
  it('flags a small property too', () => {
    const input = checkInput({
      snapshot: snapshotWith(searchConsoleSummary(), ga4Summary({ sessions: 9, keyEvents: 0 })),
    });

    expect(check(input, 'ANALYTICS-GA-001')).toMatchObject({ affectedTargets: 1 });
  });

  it('stays quiet without sessions or on a property that rejects the metric', () => {
    for (const ga4 of [
      ga4Summary({ sessions: 0, keyEvents: 0 }),
      ga4Summary({ sessions: 500, keyEvents: null }),
    ]) {
      const input = checkInput({ snapshot: snapshotWith(searchConsoleSummary(), ga4) });
      expect(check(input, 'ANALYTICS-GA-001')).toMatchObject({ ran: true, applicableTargets: 0 });
    }
  });
});

describe('the Google tag on crawled pages (ANALYTICS-GA-002)', () => {
  it('flags the pages without the tag the rest of the site carries', () => {
    const input = checkInput({
      pages: [page('/'), page('/blog'), page('/landing', { hasGoogleTag: false })],
    });

    const result = check(input, 'ANALYTICS-GA-002');

    expect(result).toMatchObject({ applicableTargets: 3, affectedTargets: 1 });
    expect(result.findings[0]).toMatchObject({
      targetUrl: 'https://example.com/landing',
      evidenceType: 'dom',
      evidence: { params: { tagged: 2, checked: 3 } },
    });
  });

  // A site whose GA4 has sessions but whose HTML carries no tag loads it from a
  // script bundle; "untagged" would be wrong on every page.
  it('does not judge a site whose HTML carries no tag at all', () => {
    const input = checkInput({
      pages: [page('/', { hasGoogleTag: false }), page('/blog', { hasGoogleTag: false })],
    });

    expect(check(input, 'ANALYTICS-GA-002')).toMatchObject({ ran: true, applicableTargets: 0 });
  });
});

describe('findings on top search pages (ANALYTICS-LINK-001)', () => {
  it('lists the busiest search pages with the findings the report raised on them', () => {
    const input = checkInput({
      searchConsoleDetail: detail({
        pages: [
          row('https://example.com/', { impressions: 900, clicks: 40 }),
          row('https://example.com/blog/', { impressions: 300, clicks: 3 }),
          row('https://example.com/old', { impressions: 0, clicks: 0 }),
        ],
      }),
      reportIssues: [
        { ruleId: 'A11Y-002', normalizedUrl: 'https://example.com/blog', severity: 'Medium' },
        { ruleId: 'SEO-TECH-004', normalizedUrl: 'https://example.com/blog', severity: 'High' },
        { ruleId: 'A11Y-002', normalizedUrl: 'https://example.com/blog', severity: 'Medium' },
        {
          ruleId: 'SEC-PASSIVE-001',
          normalizedUrl: 'https://example.com/other',
          severity: 'Critical',
        },
      ],
    });
    const run = runAnalyticsChecks(input);

    expect(run.analysis.topPages).toEqual([
      {
        url: 'https://example.com/',
        impressions: 900,
        clicks: 40,
        findings: 0,
        highestSeverity: null,
        ruleIds: [],
      },
      {
        url: 'https://example.com/blog/',
        impressions: 300,
        clicks: 3,
        findings: 3,
        highestSeverity: 'High',
        ruleIds: ['SEO-TECH-004', 'A11Y-002'],
      },
    ]);
    expect(check(input, 'ANALYTICS-LINK-001')).toMatchObject({
      applicableTargets: 2,
      affectedTargets: 1,
      findings: [],
    });
  });
});

describe('running the Analytics checks', () => {
  it('runs every check in report order when both sources answered', () => {
    const run = runAnalyticsChecks(checkInput());

    expect(run.checks.map((entry) => [entry.ruleId, entry.ran])).toEqual([
      ['ANALYTICS-SC-001', true],
      ['ANALYTICS-SC-002', true],
      ['ANALYTICS-SC-003', true],
      ['ANALYTICS-SC-004', true],
      ['ANALYTICS-SC-005', true],
      ['ANALYTICS-GA-001', true],
      ['ANALYTICS-GA-002', true],
      ['ANALYTICS-LINK-001', true],
    ]);
  });

  it('does not run the checks of a source that gave no data', () => {
    const searchOnly = runAnalyticsChecks(
      checkInput({ snapshot: snapshotWith(searchConsoleSummary(), null) }),
    );
    const ga4Only = runAnalyticsChecks(
      checkInput({ snapshot: snapshotWith(null, ga4Summary()), searchConsoleDetail: null }),
    );

    expect(searchOnly.checks.filter((entry) => !entry.ran).map((entry) => entry.ruleId)).toEqual([
      'ANALYTICS-GA-001',
      'ANALYTICS-GA-002',
    ]);
    expect(ga4Only.checks.filter((entry) => entry.ran).map((entry) => entry.ruleId)).toEqual([
      'ANALYTICS-GA-001',
      'ANALYTICS-GA-002',
    ]);
    expect(ga4Only.analysis).toEqual({ trend: null, nearTop: [], topPages: [] });
  });
});
