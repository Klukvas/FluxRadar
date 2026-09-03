import { describe, expect, it } from 'vitest';

import { PLANS } from './enums.js';
import { ENTITLEMENT_DAYS, FREE_CHECK_RULE_IDS, SIDE_SCORE_MODULES, TARIFFS } from './tariffs.js';

const weightSum = (weights: Readonly<Partial<Record<string, number>>>): number =>
  Object.values(weights).reduce((sum: number, weight) => sum + (weight ?? 0), 0);

describe('tariff matrix §18', () => {
  it('sums score weights of scoring plans to exactly 1.0', () => {
    expect(weightSum(TARIFFS.Basic.scoreWeights)).toBeCloseTo(1, 10);
    expect(weightSum(TARIFFS.Complete.scoreWeights)).toBeCloseTo(1, 10);
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
