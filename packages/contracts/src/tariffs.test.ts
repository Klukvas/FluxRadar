import { describe, expect, it } from 'vitest';

import { PLANS } from './enums.js';
import {
  ENTITLEMENT_DAYS,
  FREE_CHECK_RULE_IDS,
  SEARCH_MODULES,
  SIDE_SCORE_MODULES,
  TARIFFS,
  normalizeScoreWeights,
  planRunsModule,
  planSupports,
} from './tariffs.js';

const weightSum = (weights: Readonly<Partial<Record<string, number>>>): number =>
  Object.values(weights).reduce((sum: number, weight) => sum + (weight ?? 0), 0);

describe('tariff matrix §18', () => {
  it('sums score weights of scoring plans to exactly 1.0', () => {
    expect(weightSum(TARIFFS.Basic.scoreWeights)).toBeCloseTo(1, 10);
    expect(weightSum(TARIFFS.Complete.scoreWeights)).toBeCloseTo(1, 10);
    expect(weightSum(TARIFFS.WebsiteAudit.scoreWeights)).toBeCloseTo(1, 10);
  });

  it('computes no score for Free', () => {
    expect(TARIFFS.Free.scoreWeights).toEqual({});
  });

  it('fixes the §15 weights per module', () => {
    expect(TARIFFS.Basic.scoreWeights).toEqual({ SEO: 0.6, 'AI SEO / GEO': 0.4 });
    expect(TARIFFS.Complete.scoreWeights).toEqual({
      SEO: 0.2,
      'AI SEO / GEO': 0.15,
      Security: 0.2,
      Performance: 0.15,
      Accessibility: 0.1,
      Reliability: 0.1,
      'Content Quality': 0.05,
      Privacy: 0.05,
    });
  });

  it('assigns weights only to modules available in the plan', () => {
    for (const plan of PLANS) {
      const tariff = TARIFFS[plan];
      for (const moduleName of Object.keys(tariff.scoreWeights)) {
        expect(tariff.modules).toContain(moduleName);
      }
    }
  });

  it('keeps UX/Conversion and Analytics outside the overall score', () => {
    for (const sideModule of SIDE_SCORE_MODULES) {
      expect(TARIFFS.Complete.modules).toContain(sideModule);
      expect(TARIFFS.Complete.scoreWeights).not.toHaveProperty(sideModule);
    }
  });

  it('fixes run limits, retention, and prices per plan', () => {
    expect(TARIFFS.Free).toMatchObject({
      priceUsd: 0,
      urlLimit: 1,
      aiRequestLimit: 0,
      retentionDays: 30,
    });
    expect(TARIFFS.Basic).toMatchObject({
      priceUsd: 55,
      urlLimit: 5000,
      aiRequestLimit: 50,
      retentionDays: 30,
      label: 'Basic Scan',
    });
    expect(TARIFFS.Complete).toMatchObject({
      priceUsd: 120,
      urlLimit: 50_000,
      aiRequestLimit: 500,
      retentionDays: 365,
      label: 'Complete Scan',
    });
  });

  it('sells Website Audit as the eight non-search modules at $79', () => {
    expect(TARIFFS.WebsiteAudit).toMatchObject({
      priceUsd: 79,
      urlLimit: 50_000,
      aiRequestLimit: 500,
      retentionDays: 365,
      label: 'Website Audit Scan',
    });
    expect(TARIFFS.WebsiteAudit.modules).toEqual([
      'Security',
      'Performance',
      'Accessibility',
      'Reliability',
      'Content Quality',
      'Privacy',
      'UX/Conversion',
      'Analytics',
    ]);
  });

  it('is exactly Complete without the search modules', () => {
    expect(TARIFFS.WebsiteAudit.modules).toEqual(
      TARIFFS.Complete.modules.filter((module) => !SEARCH_MODULES.includes(module)),
    );
  });

  it('weights every scored module the plan runs, and only those', () => {
    for (const plan of ['Basic', 'Complete', 'WebsiteAudit'] as const) {
      const scored = TARIFFS[plan].modules.filter(
        (module) => !SIDE_SCORE_MODULES.includes(module),
      );
      expect(Object.keys(TARIFFS[plan].scoreWeights).sort()).toEqual([...scored].sort());
    }
  });

  it('runs neither search module on Website Audit', () => {
    for (const searchModule of SEARCH_MODULES) {
      expect(TARIFFS.WebsiteAudit.modules).not.toContain(searchModule);
      expect(TARIFFS.WebsiteAudit.scoreWeights).not.toHaveProperty(searchModule);
      expect(planRunsModule('WebsiteAudit', searchModule)).toBe(false);
    }
  });

  it('keeps Complete’s relative weights on Website Audit, rescaled over the .65 that remains', () => {
    const websiteAudit = TARIFFS.WebsiteAudit.scoreWeights;
    expect(websiteAudit.Security).toBeCloseTo(0.2 / 0.65, 10);
    expect(websiteAudit.Performance).toBeCloseTo(0.15 / 0.65, 10);
    expect(websiteAudit.Accessibility).toBeCloseTo(0.1 / 0.65, 10);
    expect(websiteAudit.Reliability).toBeCloseTo(0.1 / 0.65, 10);
    expect(websiteAudit['Content Quality']).toBeCloseTo(0.05 / 0.65, 10);
    expect(websiteAudit.Privacy).toBeCloseTo(0.05 / 0.65, 10);
    // Security still matters exactly twice what Accessibility does, as on Complete.
    expect((websiteAudit.Security ?? 0) / (websiteAudit.Accessibility ?? 1)).toBeCloseTo(2, 10);
  });

  it('leaves Basic and Complete untouched by the third package', () => {
    expect(TARIFFS.Basic.priceUsd).toBe(55);
    expect(TARIFFS.Complete.priceUsd).toBe(120);
    expect(TARIFFS.Complete.modules).toHaveLength(10);
    expect(TARIFFS.Basic.modules).toEqual(['SEO', 'AI SEO / GEO']);
  });

  it('gives Website Audit the same report entitlements as Complete, and Basic none', () => {
    expect(TARIFFS.WebsiteAudit.capabilities).toEqual(TARIFFS.Complete.capabilities);
    for (const capability of ['scanHistory', 'issueHistory', 'export', 'actionPlan'] as const) {
      expect(planSupports('WebsiteAudit', capability)).toBe(true);
      expect(planSupports('Basic', capability)).toBe(false);
      expect(planSupports('Free', capability)).toBe(false);
    }
  });

  it('refuses a capability for a plan literal it does not know', () => {
    expect(planSupports('Enterprise', 'export')).toBe(false);
    expect(planRunsModule('Enterprise', 'Security')).toBe(false);
  });

  it('returns no weights when nothing survives normalization', () => {
    expect(normalizeScoreWeights({ SEO: 0.6 }, ['Security'])).toEqual({});
  });

  it('keeps the entitlement window at 30 days', () => {
    expect(ENTITLEMENT_DAYS).toBe(30);
  });

  it('fixes the Free homepage check to the four §18 rules in order', () => {
    expect(FREE_CHECK_RULE_IDS).toEqual([
      'SEO-ONPAGE-001',
      'SEO-ONPAGE-003',
      'SEO-ONPAGE-002',
      'SEO-TECH-008',
    ]);
  });
});
