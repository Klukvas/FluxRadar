import { describe, expect, it } from 'vitest';

import {
  ACTION_PLAN_LANGUAGES,
  ACTION_PLAN_NOTICE_VERSION,
  actionPlanLanguageInputSchema,
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
    expect(actionPlanLanguageInputSchema.safeParse({ language: 'de' }).success).toBe(true);
    for (const language of ['xx', 'EN', 'en-US', '', 42, null, undefined]) {
      expect(actionPlanLanguageInputSchema.safeParse({ language }).success).toBe(false);
    }
    expect(actionPlanLanguageInputSchema.safeParse({}).success).toBe(false);
  });

  it('pins the consent notice version stored with a plan', () => {
    expect(ACTION_PLAN_NOTICE_VERSION).toBe('action-plan-notice-v1');
  });
});
