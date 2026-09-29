// The comparison response is validated on the way OUT, by the route that builds
// it, so the shape is the contract and not a comment about one. These tests pin
// the two halves a client depends on: that a comparable read round-trips whole,
// and that every way of saying "not comparable" is a closed list — a reason the
// client cannot recognise is a reason it cannot render.

import { describe, expect, it } from 'vitest';

import {
  COMPARISON_INCOMPARABLE_REASONS,
  COMPARISON_SAMPLE_LIMIT,
  MODULE_COMPARISON_REASONS,
  PAGE_COMPARISON_REASONS,
  scanComparisonSchema,
  type ScanComparison,
} from './api.js';

function scopeFacts(): ScanComparison['current']['scope'] {
  return {
    entryUrl: 'https://example.com',
    maxPages: 500,
    maxDepth: 5,
    includeSubdomains: false,
    queryPolicy: 'ignore',
    urlPatterns: [],
    excludePatterns: ['/cart'],
    seedUrls: [],
    renderJs: false,
    respectRobots: true,
    userAgent: 'desktop',
    egressLocation: 'ua',
    egressLocationView: {
      id: 'ua',
      countryCode: 'UA',
      city: 'Kyiv',
      label: { en: 'Ukraine, Kyiv', uk: 'Україна, Київ' },
    },
    scopeKey: 'scope-v3:abc',
  };
}

function comparison(): ScanComparison {
  return {
    current: {
      id: 'scan-2',
      plan: 'Complete',
      status: 'Completed',
      completedAt: '2026-09-27T10:00:00.000Z',
      pagesRead: 120,
      urlsDiscovered: 120,
      urlsOverLimit: 0,
      scope: scopeFacts(),
      readable: true,
    },
    previous: {
      id: 'scan-1',
      plan: 'Complete',
      status: 'Completed',
      completedAt: '2026-09-01T10:00:00.000Z',
      pagesRead: 118,
      urlsDiscovered: 118,
      urlsOverLimit: 0,
      scope: scopeFacts(),
      readable: true,
    },
    comparable: { ok: true },
    overall: { previousScore: 71.5, currentScore: 80, delta: 8.5 },
    modules: [
      {
        module: 'SEO',
        previousScore: 60,
        currentScore: 72.25,
        delta: 12.25,
        comparable: { ok: true },
      },
      {
        module: 'Analytics',
        previousScore: null,
        currentScore: 40,
        delta: null,
        comparable: { ok: false, reason: 'module-not-scored-previously' },
      },
    ],
    pages: {
      comparable: { ok: true },
      identity: 'canonical-document',
      added: 3,
      removed: 1,
      kept: 117,
      currentTotal: 120,
      previousTotal: 118,
      addedSample: ['https://example.com/new'],
      removedSample: ['https://example.com/gone'],
    },
    issues: {
      new: 2,
      resolved: 4,
      reopened: 1,
      stillOpen: 9,
      settled: 1,
      byModule: [{ module: 'SEO', new: 2, resolved: 4, reopened: 1, stillOpen: 9, settled: 1 }],
      bySeverity: [
        { severity: 'High', new: 2, resolved: 4, reopened: 1, stillOpen: 9, settled: 1 },
      ],
      newSample: [
        {
          fingerprint: 'fp-new',
          ruleId: 'SEO-ONPAGE-001',
          module: 'SEO',
          severity: 'High',
          normalizedUrl: 'https://example.com/new',
        },
      ],
      resolvedSample: [
        {
          fingerprint: 'fp-old',
          ruleId: 'SEO-TECH-008',
          module: 'SEO',
          severity: 'Medium',
          normalizedUrl: 'https://example.com/old',
        },
      ],
      firstChecked: {
        known: true,
        count: 1,
        byModule: [{ module: 'SEO', count: 1 }],
        bySeverity: [{ severity: 'High', count: 1 }],
        ruleIds: ['SEO-TECH-011'],
        sample: [
          {
            fingerprint: 'fp-first',
            ruleId: 'SEO-TECH-011',
            module: 'SEO',
            severity: 'High',
            normalizedUrl: 'https://example.com/deep',
          },
        ],
      },
      noLongerChecked: ['SEO-TECH-009'],
    },
  };
}

describe('scanComparisonSchema', () => {
  it('round-trips a comparable read unchanged', () => {
    const value = comparison();
    const parsed = scanComparisonSchema.parse(JSON.parse(JSON.stringify(value)));
    expect(parsed).toEqual(value);
  });

  it('round-trips the first report of a plan, which has no previous scan', () => {
    const first: ScanComparison = {
      ...comparison(),
      previous: null,
      comparable: { ok: false, reason: 'no-previous-scan' },
      overall: { previousScore: null, currentScore: 80, delta: null },
      modules: [],
      pages: {
        comparable: { ok: false, reason: 'page-evidence-missing' },
        identity: null,
        added: 0,
        removed: 0,
        kept: 0,
        currentTotal: 0,
        previousTotal: 0,
        addedSample: [],
        removedSample: [],
      },
      issues: {
        new: 0,
        resolved: 0,
        reopened: 0,
        stillOpen: 0,
        settled: 0,
        byModule: [],
        bySeverity: [],
        newSample: [],
        resolvedSample: [],
        firstChecked: {
          known: false,
          count: 0,
          byModule: [],
          bySeverity: [],
          ruleIds: [],
          sample: [],
        },
        noLongerChecked: [],
      },
    };
    expect(scanComparisonSchema.parse(JSON.parse(JSON.stringify(first)))).toEqual(first);
  });

  it.each(COMPARISON_INCOMPARABLE_REASONS)('accepts the verdict reason %s', (reason) => {
    const value = { ...comparison(), comparable: { ok: false as const, reason } };
    expect(scanComparisonSchema.parse(value).comparable).toEqual({ ok: false, reason });
  });

  it.each(MODULE_COMPARISON_REASONS)('accepts the module reason %s', (reason) => {
    const modules = [
      {
        module: 'SEO' as const,
        previousScore: null,
        currentScore: null,
        delta: null,
        comparable: { ok: false as const, reason },
      },
    ];
    expect(scanComparisonSchema.parse({ ...comparison(), modules }).modules[0]?.comparable).toEqual(
      {
        ok: false,
        reason,
      },
    );
  });

  it.each(PAGE_COMPARISON_REASONS)('accepts the page reason %s', (reason) => {
    const pages = { ...comparison().pages, comparable: { ok: false as const, reason } };
    expect(scanComparisonSchema.parse({ ...comparison(), pages }).pages.comparable).toEqual({
      ok: false,
      reason,
    });
  });

  it('refuses a reason nobody declared, rather than passing it to the client', () => {
    const value = { ...comparison(), comparable: { ok: false, reason: 'because-i-said-so' } };
    expect(scanComparisonSchema.safeParse(value).success).toBe(false);
  });

  it('refuses a verdict that is neither ok nor reasoned', () => {
    expect(
      scanComparisonSchema.safeParse({ ...comparison(), comparable: { ok: false } }).success,
    ).toBe(false);
  });

  it('refuses a sample longer than the bound the endpoint promises', () => {
    const pages = {
      ...comparison().pages,
      addedSample: Array.from(
        { length: COMPARISON_SAMPLE_LIMIT + 1 },
        (_unused, index) => `https://example.com/${index}`,
      ),
    };
    expect(scanComparisonSchema.safeParse({ ...comparison(), pages }).success).toBe(false);
  });

  it('refuses a module the product does not have', () => {
    const modules = [{ ...comparison().modules[0], module: 'Astrology' }];
    expect(scanComparisonSchema.safeParse({ ...comparison(), modules }).success).toBe(false);
  });

  it('carries a previous scan whose report is no longer readable as identity alone', () => {
    // A reversed payment does not un-observe what that run found, so it stays the
    // baseline the Resolved statuses were written against and it is still named.
    // What it may not carry is anything the report itself says: a score, a page
    // total or a finding count is read out of the rows the refund took away
    // (D-216), so the shape has nowhere to put one.
    const base = comparison();
    const value: ScanComparison = {
      ...base,
      previous: {
        id: 'scan-1',
        plan: 'Complete',
        completedAt: '2026-09-01T10:00:00.000Z',
        readable: false,
      },
      comparable: { ok: false, reason: 'previous-not-readable' },
    };
    const parsed = scanComparisonSchema.parse(JSON.parse(JSON.stringify(value)));
    expect(Object.keys(parsed.previous ?? {}).toSorted()).toEqual([
      'completedAt',
      'id',
      'plan',
      'readable',
    ]);
    expect(parsed.previous?.readable).toBe(false);
  });

  it('drops a paid field a server tried to send with an unreadable previous scan', () => {
    // The route sends what this schema returns, so the boundary is the last line
    // of defence: a build that kept "just the page count" leaks nothing.
    const base = comparison();
    const leaky = { ...base.previous, readable: false };
    const parsed = scanComparisonSchema.parse({
      ...base,
      previous: leaky,
      comparable: { ok: false, reason: 'previous-not-readable' },
    });
    expect(parsed.previous).toEqual({
      id: 'scan-1',
      plan: 'Complete',
      completedAt: '2026-09-01T10:00:00.000Z',
      readable: false,
    });
  });

  it('refuses an unreadable previous scan that is missing its identity', () => {
    const base = comparison();
    expect(scanComparisonSchema.safeParse({ ...base, previous: { readable: false } }).success).toBe(
      false,
    );
  });

  it('refuses a comparison that forgot to say whether a scan is readable', () => {
    const base = comparison();
    const withoutFlag: Record<string, unknown> = { ...base.current };
    delete withoutFlag.readable;
    expect(scanComparisonSchema.safeParse({ ...base, current: withoutFlag }).success).toBe(false);
  });

  it('carries the crawl location as a place, and refuses a scope that states only the id', () => {
    // Which ids exist and what each is called is the server's registry, so the
    // label travels with the scan. Without it the comparison row printed "UA"
    // under a report header reading "Ukraine, Kyiv" (D-228) — and a client has
    // no catalogue to look the id up in.
    const base = comparison();
    const parsed = scanComparisonSchema.parse(JSON.parse(JSON.stringify(base)));
    expect(parsed.current.scope.egressLocationView).toEqual({
      id: 'ua',
      countryCode: 'UA',
      city: 'Kyiv',
      label: { en: 'Ukraine, Kyiv', uk: 'Україна, Київ' },
    });
    const scope: Record<string, unknown> = { ...base.current.scope };
    delete scope.egressLocationView;
    const current = { ...base.current, scope };
    expect(scanComparisonSchema.safeParse({ ...base, current }).success).toBe(false);
  });

  it('accepts a scan that recorded no crawl location, on both sides at once', () => {
    // The earliest scans of this product left from a server in another country
    // with nothing recording it: null is a fact the comparison has to be able to
    // state, not a field a server forgot.
    const base = comparison();
    const unrecorded = { ...base.current.scope, egressLocation: null, egressLocationView: null };
    const parsed = scanComparisonSchema.parse({
      ...base,
      current: { ...base.current, scope: unrecorded },
      previous: { ...base.previous, scope: unrecorded },
    });
    expect(parsed.current.scope.egressLocationView).toBeNull();
  });

  it('refuses a first-checked block that does not say whether coverage is known', () => {
    // A zero count and "nobody recorded which checks ran" are the same zero and
    // opposite claims about the report, so the flag is not optional.
    const base = comparison();
    const firstChecked: Record<string, unknown> = { ...base.issues.firstChecked };
    delete firstChecked.known;
    const issues = { ...base.issues, firstChecked };
    expect(scanComparisonSchema.safeParse({ ...base, issues }).success).toBe(false);
  });

  it('bounds the first-checked sample by the same limit as the others', () => {
    const base = comparison();
    const firstChecked = {
      ...base.issues.firstChecked,
      sample: Array.from({ length: COMPARISON_SAMPLE_LIMIT + 1 }, (_unused, index) => ({
        fingerprint: `fp-${index}`,
        ruleId: 'SEO-TECH-011',
        module: 'SEO',
        severity: 'High',
        normalizedUrl: `https://example.com/${index}`,
      })),
    };
    const issues = { ...base.issues, firstChecked };
    expect(scanComparisonSchema.safeParse({ ...base, issues }).success).toBe(false);
  });
});
