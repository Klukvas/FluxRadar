import { describe, expect, it } from 'vitest';

import { FREE_SCORE_MAX, FULL_SCORE_MAX, freeDisplayScore, scoreMaxFor } from './free-score.js';

// D-237: a Free check is shown out of 40 (a quick homepage check); the stored
// 0–100 score is converted once, for display, and never altered.

describe('freeDisplayScore', () => {
  it('shows a perfect homepage as 40 out of 40', () => {
    expect(freeDisplayScore(100)).toEqual({ value: 40, max: 40 });
  });

  it('scales and rounds to an integer', () => {
    expect(freeDisplayScore(98).value).toBe(39);
    expect(freeDisplayScore(87.5).value).toBe(35);
    expect(freeDisplayScore(79).value).toBe(32);
    expect(freeDisplayScore(98.7).value).toBe(39);
    expect(freeDisplayScore(1.2).value).toBe(0);
    expect(freeDisplayScore(1.3).value).toBe(1);
    expect(freeDisplayScore(33.33).value).toBe(13);
  });

  it('keeps zero at zero and null as null', () => {
    expect(freeDisplayScore(0)).toEqual({ value: 0, max: 40 });
    expect(freeDisplayScore(null)).toEqual({ value: null, max: 40 });
  });

  it('shows a non-finite stored value as no score, the way null is shown', () => {
    for (const score of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(freeDisplayScore(score)).toEqual(freeDisplayScore(null));
    }
  });

  it('clamps a malformed stored value to 0–100 before scaling', () => {
    expect(freeDisplayScore(140).value).toBe(40);
    expect(freeDisplayScore(-5).value).toBe(0);
  });

  it('lands every stored score on an integer from 0 to 40', () => {
    for (let score = 0; score <= 100; score += 0.01) {
      const shown = freeDisplayScore(score).value ?? -1;
      expect(Number.isInteger(shown)).toBe(true);
      expect(shown).toBeGreaterThanOrEqual(0);
      expect(shown).toBeLessThanOrEqual(FREE_SCORE_MAX);
    }
  });
});

describe('the scale per plan', () => {
  it('prints Free over 40 and every other plan over 100', () => {
    expect(scoreMaxFor('Free')).toBe(FREE_SCORE_MAX);
    for (const plan of ['Basic', 'Complete', 'WebsiteAudit', 'Legacy'] as const) {
      expect(scoreMaxFor(plan)).toBe(FULL_SCORE_MAX);
    }
  });
});
