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
        firstChecked: { count: 0, byModule: [], bySeverity: [], ruleIds: [], sample: [] },
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

  it('carries a previous scan whose report is no longer readable', () => {
    // A reversed payment does not un-observe what that run found, so it stays
    // the baseline; the flag is what tells the panel not to link to it.
    const base = comparison();
    const value: ScanComparison = {
      ...base,
      previous: { ...base.previous!, readable: false },
    };
    expect(scanComparisonSchema.parse(JSON.parse(JSON.stringify(value))).previous?.readable).toBe(
      false,
    );
  });

  it('refuses a comparison that forgot to say whether a scan is readable', () => {
    const base = comparison();
    const withoutFlag: Record<string, unknown> = { ...base.current };
    delete withoutFlag.readable;
    expect(scanComparisonSchema.safeParse({ ...base, current: withoutFlag }).success).toBe(false);
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
