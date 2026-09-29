// The comparability rules, without a database.
//
// Every branch here is a refusal to state a difference, and each one exists
// because the alternative is a sentence that reads as praise or blame the site
// did not earn. The order matters too: a scope the owner changed is named before
// the truncation it caused, so nobody is sent hunting for a site problem behind
// their own setting.

import { describe, expect, it } from 'vitest';
import type { Scan } from '@prisma/client';

import { crawlScopeFactsOf, sameCrawlScope } from './scope-facts.ts';
import {
  comparisonSideOf,
  comparisonVerdict,
  moduleScoreDeltas,
  type ComparedModule,
} from './verdict.ts';
import { crawlSummary } from '../../test-utils/comparison-fixtures.ts';

const SCOPE = {
  includeSubdomains: false,
  maxPages: 500,
  maxDepth: 5,
  renderJs: false,
  queryPolicy: 'ignore',
  respectRobots: true,
  robotsOverrideConfirmed: false,
  userAgent: 'desktop',
  egressLocation: 'ua',
} as const;

function scanRow(overrides: Partial<Scan> = {}): Scan {
  return {
    id: 'scan-1',
    domain: 'https://example.com',
    status: 'Completed',
    scopeJson: JSON.stringify(SCOPE),
    executionConfigJson: null,
    crawlSummaryJson: JSON.stringify(crawlSummary()),
    plan: 'Complete',
    ...overrides,
  } as Scan;
}

function side(overrides: Partial<Scan> = {}, modules: readonly ComparedModule[] = [completed()]) {
  const scan = scanRow(overrides);
  return comparisonSideOf(scan, modules, crawlScopeFactsOf(scan));
}

function completed(overrides: Partial<ComparedModule> = {}): ComparedModule {
  return {
    module: 'SEO',
    runtimeStatus: 'Completed',
    score: 70,
    usableOutput: true,
    coverage: 1,
    ...overrides,
  };
}

describe('the comparison verdict', () => {
  it('compares two finished scans of the same scope', () => {
    expect(
      comparisonVerdict({ current: side(), previous: side(), earlierOtherPlan: false }),
    ).toEqual({ ok: true });
  });

  it('distinguishes "no earlier scan" from "none on this plan"', () => {
    expect(comparisonVerdict({ current: side(), previous: null, earlierOtherPlan: false })).toEqual(
      { ok: false, reason: 'no-previous-scan' },
    );
    expect(comparisonVerdict({ current: side(), previous: null, earlierOtherPlan: true })).toEqual({
      ok: false,
      reason: 'previous-plan-differs',
    });
  });

  it('refuses a previous scan whose modules produced nothing usable', () => {
    const previous = side({}, [completed({ usableOutput: false, score: null })]);
    expect(comparisonVerdict({ current: side(), previous, earlierOtherPlan: false })).toEqual({
      ok: false,
      reason: 'previous-not-usable',
    });
  });

  it.each([
    ['a status that is not Completed', { status: 'Partial' }, [completed()]],
    ['a module that never finished', {}, [completed({ runtimeStatus: 'Unavailable' })]],
  ] as const)('refuses a current run with %s', (_name, overrides, modules) => {
    expect(
      comparisonVerdict({
        current: side(overrides, modules),
        previous: side(),
        earlierOtherPlan: false,
      }),
    ).toEqual({ ok: false, reason: 'current-stopped-early' });
  });

  it('counts a Not applicable module as finished', () => {
    // A section the plan deliberately does not run is a terminal fact, not an
    // unfinished run, and refusing the whole comparison for it would make every
    // Website Audit report incomparable.
    const current = side({}, [
      completed(),
      completed({
        module: 'Analytics',
        runtimeStatus: 'Not applicable',
        score: null,
        usableOutput: false,
      }),
    ]);
    expect(comparisonVerdict({ current, previous: side(), earlierOtherPlan: false })).toEqual({
      ok: true,
    });
  });

  it('names the changed scope before the truncation the change caused', () => {
    // Both are true of this pair; the actionable one is the setting.
    const previous = side({
      scopeJson: JSON.stringify({ ...SCOPE, maxPages: 50 }),
      crawlSummaryJson: JSON.stringify(crawlSummary({ urlsOverLimit: 12 })),
    });
    expect(comparisonVerdict({ current: side(), previous, earlierOtherPlan: false })).toEqual({
      ok: false,
      reason: 'scope-changed',
    });
  });

  it('refuses a crawl that stopped at its page limit', () => {
    const current = side({
      crawlSummaryJson: JSON.stringify(crawlSummary({ urlsOverLimit: 12 })),
    });
    expect(comparisonVerdict({ current, previous: side(), earlierOtherPlan: false })).toEqual({
      ok: false,
      reason: 'current-crawl-truncated',
    });
  });

  it('refuses a scan that recorded no crawl at all', () => {
    const previous = side({ crawlSummaryJson: null });
    expect(comparisonVerdict({ current: side(), previous, earlierOtherPlan: false })).toEqual({
      ok: false,
      reason: 'crawl-not-recorded',
    });
  });

  it('names a previous scan that produced nothing before this scan stopping early', () => {
    // Both hold. "The previous scan produced nothing usable" is about the pair
    // and cannot be fixed by re-running this one; "this scan stopped early" asks
    // the owner to do exactly that. Naming the second first sends them to retry
    // a run that would still have nothing to be compared with.
    const previous = side({}, [completed({ usableOutput: false, score: null })]);
    const current = side({ status: 'Partial' });
    expect(comparisonVerdict({ current, previous, earlierOtherPlan: false })).toEqual({
      ok: false,
      reason: 'previous-not-usable',
    });
  });

  it('names the changed scope before the crawl one of them never recorded', () => {
    // A scan older than `Scan.crawlSummaryJson` compared with a rescoped one:
    // the setting the owner changed is the one they can act on, and the missing
    // record is a fact about an old run that no action reaches.
    const previous = side({
      scopeJson: JSON.stringify({ ...SCOPE, maxPages: 50 }),
      crawlSummaryJson: null,
    });
    expect(comparisonVerdict({ current: side(), previous, earlierOtherPlan: false })).toEqual({
      ok: false,
      reason: 'scope-changed',
    });
  });
});

describe('what counts as the same crawl scope', () => {
  const facts = (overrides: Record<string, unknown> = {}) =>
    crawlScopeFactsOf(scanRow({ scopeJson: JSON.stringify({ ...SCOPE, ...overrides }) }));

  it('accepts two crawls configured identically', () => {
    expect(sameCrawlScope(facts(), facts())).toBe(true);
  });

  it.each([
    ['the page limit', { maxPages: 50 }],
    ['the depth', { maxDepth: 2 }],
    ['subdomains', { includeSubdomains: true }],
    ['the query policy', { queryPolicy: 'include' }],
    ['an exclude pattern', { excludePatterns: ['/cart'] }],
    ['an include pattern', { urlPatterns: ['/blog'] }],
    ['the render mode', { renderJs: true }],
    // The device is not part of `crawlScopeKey` — it rides in the request context
    // the Resolved policy compares — so this asserts the comparison asks for it
    // itself. Without that, a mobile re-run of a site with its own mobile layout
    // compared as if it were the same measurement.
    ['the device', { userAgent: 'mobile' }],
    ['the robots.txt rule', { respectRobots: false, robotsOverrideConfirmed: true }],
    ['the crawl location', { egressLocation: 'de' }],
    ['a seed URL', { seedUrls: ['https://example.com/hidden'] }],
  ] as const)('rejects a change to %s', (_name, overrides) => {
    expect(sameCrawlScope(facts(), facts(overrides))).toBe(false);
  });

  it('ignores the order and duplicates of the seed list', () => {
    const left = facts({ seedUrls: ['https://example.com/a', 'https://example.com/b'] });
    const right = facts({
      seedUrls: ['https://example.com/b', 'https://example.com/a', 'https://example.com/b'],
    });
    expect(sameCrawlScope(left, right)).toBe(true);
  });

  it('rejects a different entry URL even with identical filters', () => {
    const current = crawlScopeFactsOf(scanRow({ scopeJson: JSON.stringify(SCOPE) }));
    const moved = crawlScopeFactsOf(
      scanRow({ domain: 'https://other.example', scopeJson: JSON.stringify(SCOPE) }),
    );
    expect(current.scopeKey).toBe(moved.scopeKey);
    expect(sameCrawlScope(current, moved)).toBe(false);
  });

  it('carries the crawl location as a place as well as an id', () => {
    // The id is what equality is asked over; the place is what the reader is
    // shown. The registry that turns one into the other is the server's, so a
    // scope that travelled with the id alone had the comparison row printing
    // "UA" under a report header reading "Ukraine, Kyiv" (D-228).
    expect(facts().egressLocationView).toEqual({
      id: 'ua',
      countryCode: 'UA',
      city: 'Kyiv',
      label: { en: 'Ukraine, Kyiv', uk: 'Україна, Київ' },
    });
  });

  it('records no place for a scan that predates the choice', () => {
    const unrecorded = crawlScopeFactsOf(
      scanRow({ scopeJson: JSON.stringify({ includeSubdomains: false }) }),
    );
    expect(unrecorded.egressLocation).toBeNull();
    expect(unrecorded.egressLocationView).toBeNull();
  });
});

describe('per-module score deltas', () => {
  it('subtracts two scores and rounds to two decimals', () => {
    const deltas = moduleScoreDeltas([completed({ score: 81.256 })], [completed({ score: 70.1 })]);
    expect(deltas).toEqual([
      {
        module: 'SEO',
        previousScore: 70.1,
        currentScore: 81.256,
        delta: 11.16,
        comparable: { ok: true },
      },
    ]);
  });

  it.each([
    ['module-absent-previously', [completed()], []],
    ['module-absent-now', [], [completed()]],
    ['module-not-scored-previously', [completed()], [completed({ score: null })]],
    ['module-not-scored-now', [completed({ score: null })], [completed()]],
  ] as const)('reports %s instead of a delta', (reason, current, previous) => {
    const [delta] = moduleScoreDeltas(current, previous);
    expect(delta?.comparable).toEqual({ ok: false, reason });
    expect(delta?.delta).toBeNull();
  });

  it('lists modules in the tariff table order, not in row order', () => {
    const deltas = moduleScoreDeltas(
      [completed({ module: 'Privacy' }), completed({ module: 'SEO' })],
      [completed({ module: 'Privacy' }), completed({ module: 'SEO' })],
    );
    expect(deltas.map((entry) => entry.module)).toEqual(['SEO', 'Privacy']);
  });
});
