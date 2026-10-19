import { describe, expect, it } from 'vitest';

import { PLANS, isPlan } from './enums.js';
import { unreadableComparedScanSchema } from './api.js';
import {
  LEGACY_PLANS,
  STORED_PLANS,
  isLegacyPlan,
  readStoredPlan,
  storedPlanLabel,
  storedPlanRetentionDays,
  storedPlanScoreWeights,
} from './stored-plan.js';
import { TARIFFS, planSupports } from './tariffs.js';

const weightSum = (weights: Readonly<Partial<Record<string, number>>>): number =>
  Object.values(weights).reduce((sum: number, weight) => sum + (weight ?? 0), 0);

describe('stored plan read model', () => {
  it('passes every current plan through unchanged', () => {
    for (const plan of PLANS) {
      expect(readStoredPlan(plan)).toBe(plan);
      expect(isLegacyPlan(plan)).toBe(false);
    }
  });

  it('reads the retired Website Audit as a legacy value, never a current plan', () => {
    expect(readStoredPlan('WebsiteAudit')).toBe('WebsiteAudit');
    expect(isLegacyPlan('WebsiteAudit')).toBe(true);
    expect(isPlan('WebsiteAudit')).toBe(false);
    expect(storedPlanLabel('WebsiteAudit')).toBe('Website Audit (archived)');
  });

  it('maps any unknown string to the catch-all instead of throwing', () => {
    expect(readStoredPlan('Enterprise')).toBe('Legacy');
    expect(readStoredPlan('')).toBe('Legacy');
    expect(storedPlanLabel('Legacy')).toBe('Archived plan');
  });

  it('labels current plans with their tariff label', () => {
    expect(storedPlanLabel('Complete')).toBe(TARIFFS.Complete.label);
    expect(storedPlanLabel('Basic')).toBe(TARIFFS.Basic.label);
  });

  it('grants a legacy plan no capability, so it cannot export, plan or compare', () => {
    for (const plan of LEGACY_PLANS) {
      for (const capability of ['scanHistory', 'issueHistory', 'export', 'actionPlan'] as const) {
        expect(planSupports(plan, capability)).toBe(false);
      }
    }
  });

  it('keeps the stored plans a superset of the current ones', () => {
    for (const plan of PLANS) expect(STORED_PLANS).toContain(plan);
  });

  it('weights a legacy scan over the modules it stored, as Complete weights them', () => {
    const weights = storedPlanScoreWeights('WebsiteAudit', [
      'Security',
      'Performance',
      'Accessibility',
      'Reliability',
      'Content Quality',
      'Privacy',
      'UX/Conversion',
      'Analytics',
    ]);
    expect(weightSum(weights)).toBeCloseTo(1, 10);
    expect(weights.Security).toBeCloseTo(0.2 / 0.65, 10);
    expect(weights.Privacy).toBeCloseTo(0.05 / 0.65, 10);
    expect(weights).not.toHaveProperty('SEO');
    expect(weights).not.toHaveProperty('UX/Conversion');
  });

  it('uses the tariff weights for a current plan whatever modules were stored', () => {
    expect(storedPlanScoreWeights('Basic', ['Security'])).toEqual(TARIFFS.Basic.scoreWeights);
  });

  it('lets a comparison name a previous scan of a retired plan', () => {
    const parsed = unreadableComparedScanSchema.safeParse({
      id: 'scan_legacy',
      plan: 'WebsiteAudit',
      completedAt: null,
      readable: false,
    });
    expect(parsed.success).toBe(true);
  });

  it('keeps a legacy report as long as the longest-kept current one', () => {
    expect(storedPlanRetentionDays('WebsiteAudit')).toBe(365);
    expect(storedPlanRetentionDays('Legacy')).toBe(TARIFFS.Complete.retentionDays);
    expect(storedPlanRetentionDays('Basic')).toBe(TARIFFS.Basic.retentionDays);
  });
});
