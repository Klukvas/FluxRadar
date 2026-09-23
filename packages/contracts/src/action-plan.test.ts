import { describe, expect, it } from 'vitest';

import {
  ACTION_PLAN_LANGUAGES,
  ACTION_PLAN_LIMITS,
  isActionPlanLanguage,
} from './action-plan.js';

describe('Action Plan languages', () => {
  it('lists distinct two-letter ISO 639-1 codes, English and Ukrainian among them', () => {
    expect(ACTION_PLAN_LANGUAGES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(ACTION_PLAN_LANGUAGES).size).toBe(ACTION_PLAN_LANGUAGES.length);
    expect(ACTION_PLAN_LANGUAGES.every((code) => /^[a-z]{2}$/.test(code))).toBe(true);
    expect(ACTION_PLAN_LANGUAGES).toContain('en');
    expect(ACTION_PLAN_LANGUAGES).toContain('uk');
  });

  it('accepts a listed code and rejects anything else', () => {
    expect(isActionPlanLanguage('de')).toBe(true);
    for (const language of ['xx', 'EN', 'en-US', '']) {
      expect(isActionPlanLanguage(language)).toBe(false);
    }
  });

  it('keeps the spend caps and the windows they are counted over together', () => {
    // Retention reads the same windows to decide how long a spend-log row that
    // outlived its scan can still refuse a generation.
    expect(ACTION_PLAN_LIMITS.maxSuccessesPerScan).toBeLessThan(
      ACTION_PLAN_LIMITS.maxAttemptsPerScan,
    );
    expect(ACTION_PLAN_LIMITS.accountStartWindowMs).toBe(60 * 60 * 1000);
    expect(ACTION_PLAN_LIMITS.productGenerationWindowMs).toBe(24 * 60 * 60 * 1000);
  });
});
