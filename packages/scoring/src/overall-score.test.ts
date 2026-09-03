import { describe, expect, it } from 'vitest';

import type { ModuleScoreSummary } from './index.js';
import { computeOverallScore } from './index.js';

function moduleSummary(overrides: Partial<ModuleScoreSummary>): ModuleScoreSummary {
  return {
    module: 'SEO',
    moduleStatus: 'Completed',
    coverage: 1,
    score: 100,
    usableOutput: true,
    ...overrides,
  };
}

function unavailable(module: ModuleScoreSummary['module']): ModuleScoreSummary {
  return moduleSummary({
    module,
    moduleStatus: 'Unavailable',
    coverage: 0,
    score: null,
    usableOutput: false,
  });
}

function notApplicable(module: ModuleScoreSummary['module']): ModuleScoreSummary {
  return moduleSummary({
    module,
    moduleStatus: 'Not applicable',
    coverage: 0,
    score: null,
    usableOutput: false,
  });
}

describe('computeOverallScore — Basic (§15, D-017)', () => {
  it('golden Partial coverage: SEO 90 @ 0.5 + AI 100 @ 1.0 → Provisional 95.71', () => {
    // ew_SEO = 0.6 × 0.5 = 0.30; ew_AI = 0.4 × 1 = 0.40; wc = 0.70
    // overall = round2((90 × 0.30 + 100 × 0.40) / 0.70) = round2(67 / 0.7) = 95.71
    const result = computeOverallScore('Basic', [
      moduleSummary({ module: 'SEO', moduleStatus: 'Partial', coverage: 0.5, score: 90 }),
      moduleSummary({ module: 'AI SEO / GEO', score: 100 }),
    ]);
    expect(result.verdict).toBe('provisional');
    expect(result.score).toBe(95.71);
    expect(result.weightedCoverage).toBeCloseTo(0.7, 12);
    expect(result.moduleWeights).toHaveLength(2);
    expect(result.moduleWeights[0]?.module).toBe('SEO');
    expect(result.moduleWeights[0]?.tariffWeight).toBe(0.6);
    expect(result.moduleWeights[0]?.effectiveWeight).toBeCloseTo(0.3, 12);
    expect(result.moduleWeights[1]?.module).toBe('AI SEO / GEO');
    expect(result.moduleWeights[1]?.effectiveWeight).toBeCloseTo(0.4, 12);
  });

  it('полное покрытие: SEO 90 + AI 100 → normal 94.00', () => {
    const result = computeOverallScore('Basic', [
      moduleSummary({ module: 'SEO', score: 90 }),
      moduleSummary({ module: 'AI SEO / GEO', score: 100 }),
    ]);
    expect(result.verdict).toBe('normal');
    expect(result.score).toBe(94);
    expect(result.weightedCoverage).toBeCloseTo(1, 12);
  });

  it('порог 0.80: wc ровно 0.8 → normal (float-шум гасится epsilon, D-122)', () => {
    // ew = 0.6 × 1 + 0.4 × 0.5 = 0.8
    const result = computeOverallScore('Basic', [
      moduleSummary({ module: 'SEO', score: 90 }),
      moduleSummary({ module: 'AI SEO / GEO', moduleStatus: 'Partial', coverage: 0.5, score: 100 }),
    ]);
    expect(result.verdict).toBe('normal');
    // (90 × 0.6 + 100 × 0.2) / 0.8 = 74 / 0.8 = 92.5
    expect(result.score).toBe(92.5);
  });

  it('чуть ниже 0.80 → provisional', () => {
    // ew = 0.6 × 1 + 0.4 × 0.45 = 0.78
    const result = computeOverallScore('Basic', [
      moduleSummary({ module: 'SEO', score: 90 }),
      moduleSummary({
        module: 'AI SEO / GEO',
        moduleStatus: 'Partial',
        coverage: 0.45,
        score: 100,
      }),
    ]);
    expect(result.verdict).toBe('provisional');
  });

  it('порог 0.50: wc ровно 0.5 → provisional', () => {
    // ew = 0.6 × 5/6 + 0 = 0.5
    const result = computeOverallScore('Basic', [
      moduleSummary({ module: 'SEO', moduleStatus: 'Partial', coverage: 5 / 6, score: 88 }),
      unavailable('AI SEO / GEO'),
    ]);
    expect(result.verdict).toBe('provisional');
    expect(result.score).toBe(88);
  });

  it('ниже 0.50 → insufficient_data со score null', () => {
    // ew = 0.6 × 0.8 = 0.48
    const result = computeOverallScore('Basic', [
      moduleSummary({ module: 'SEO', moduleStatus: 'Partial', coverage: 0.8, score: 90 }),
      unavailable('AI SEO / GEO'),
    ]);
    expect(result.verdict).toBe('insufficient_data');
    expect(result.score).toBeNull();
    expect(result.weightedCoverage).toBeCloseTo(0.48, 12);
  });

  it('completed-but-unusable модуль получает effective weight 0', () => {
    // SEO Completed, coverage 1, но score null и usable output нет → ew 0;
    // остаётся только AI 0.4 → wc 0.4 → insufficient_data (доступный score не «нулится»).
    const result = computeOverallScore('Basic', [
      moduleSummary({ module: 'SEO', score: null, usableOutput: false }),
      moduleSummary({ module: 'AI SEO / GEO', score: 100 }),
    ]);
    expect(result.verdict).toBe('insufficient_data');
    expect(result.score).toBeNull();
    expect(result.moduleWeights[0]?.effectiveWeight).toBe(0);
    expect(result.moduleWeights[1]?.effectiveWeight).toBeCloseTo(0.4, 12);
  });
});

describe('computeOverallScore — вырожденные состояния (§15, D-027)', () => {
  it('all Unavailable → insufficient_data без исключения', () => {
    const result = computeOverallScore('Basic', [unavailable('SEO'), unavailable('AI SEO / GEO')]);
    expect(result.verdict).toBe('insufficient_data');
    expect(result.score).toBeNull();
    expect(result.weightedCoverage).toBe(0);
  });

  it('all Not applicable → insufficient_data без исключения', () => {
    const result = computeOverallScore('Basic', [
      notApplicable('SEO'),
      notApplicable('AI SEO / GEO'),
    ]);
    expect(result.verdict).toBe('insufficient_data');
    expect(result.score).toBeNull();
  });

  it('пустой вход (ни одного модуля) не кидает', () => {
    const result = computeOverallScore('Complete', []);
    expect(result.verdict).toBe('insufficient_data');
    expect(result.score).toBeNull();
    expect(result.moduleWeights).toHaveLength(8);
  });

  it('нулевой знаменатель tariff weights (Free) → insufficient_data (D-123)', () => {
    const result = computeOverallScore('Free', []);
    expect(result.verdict).toBe('insufficient_data');
    expect(result.score).toBeNull();
    expect(result.weightedCoverage).toBe(0);
  });

  it('Failed-скан: один Partial usable модуль ниже порога → insufficient_data', () => {
    const result = computeOverallScore('Basic', [
      moduleSummary({ module: 'SEO', moduleStatus: 'Partial', coverage: 0.6, score: 85 }),
      unavailable('AI SEO / GEO'),
    ]);
    expect(result.verdict).toBe('insufficient_data');
  });

  it('Cancelled-скан: завершённый SEO + Unavailable AI → provisional по SEO', () => {
    const result = computeOverallScore('Basic', [
      moduleSummary({ module: 'SEO', score: 85 }),
      unavailable('AI SEO / GEO'),
    ]);
    expect(result.verdict).toBe('provisional');
    expect(result.score).toBe(85);
    expect(result.weightedCoverage).toBeCloseTo(0.6, 12);
  });

  it('Unavailable с ненулевым coverage не получает вес (защита контракта)', () => {
    const result = computeOverallScore('Basic', [
      moduleSummary({ module: 'SEO', moduleStatus: 'Unavailable', coverage: 0.5, score: null }),
      moduleSummary({ module: 'AI SEO / GEO', score: 100 }),
    ]);
    expect(result.moduleWeights[0]?.effectiveWeight).toBe(0);
  });
});

describe('computeOverallScore — Complete', () => {
  const completeHealthy: readonly ModuleScoreSummary[] = [
    moduleSummary({ module: 'SEO', score: 90 }),
    moduleSummary({ module: 'AI SEO / GEO', score: 100 }),
    moduleSummary({ module: 'Security', score: 80 }),
    moduleSummary({ module: 'Accessibility', score: 100 }),
    moduleSummary({ module: 'Reliability', score: 100 }),
    moduleSummary({ module: 'Content Quality', score: 100 }),
    moduleSummary({ module: 'Privacy', score: 100 }),
  ];

  it('нормализация весов при Unavailable Performance (и Analytics вне score)', () => {
    const result = computeOverallScore('Complete', [
      ...completeHealthy,
      unavailable('Performance'),
      unavailable('Analytics'), // side score — игнорируется, не кидает
    ]);
    // Σ tariff weights = 1.00; Σ ew = 0.85 → wc 0.85 → normal.
    // overall = (18 + 15 + 16 + 10 + 10 + 5 + 5) / 0.85 = 79 / 0.85 = 92.94
    expect(result.verdict).toBe('normal');
    expect(result.weightedCoverage).toBeCloseTo(0.85, 12);
    expect(result.score).toBe(92.94);
    expect(result.moduleWeights).toHaveLength(8);
    expect(result.moduleWeights.some((entry) => entry.module === 'Analytics')).toBe(false);
  });

  it('UX/Conversion во входе пропускается без ошибки (§15 side score)', () => {
    const result = computeOverallScore('Complete', [
      ...completeHealthy,
      moduleSummary({ module: 'Performance', score: 100 }),
      moduleSummary({ module: 'UX/Conversion', score: 55 }),
    ]);
    expect(result.verdict).toBe('normal');
    expect(result.moduleWeights.some((entry) => entry.module === 'UX/Conversion')).toBe(false);
  });
});

describe('computeOverallScore — валидация входа', () => {
  it('отклоняет дубликат модуля', () => {
    expect(() =>
      computeOverallScore('Basic', [
        moduleSummary({ module: 'SEO' }),
        moduleSummary({ module: 'SEO' }),
      ]),
    ).toThrow(/Дубликат/);
  });

  it('отклоняет модуль вне score тарифа (Security в Basic)', () => {
    expect(() => computeOverallScore('Basic', [moduleSummary({ module: 'Security' })])).toThrow(
      /не входит в score тарифа Basic/,
    );
  });

  it('отклоняет coverage и score вне диапазона', () => {
    expect(() =>
      computeOverallScore('Basic', [moduleSummary({ module: 'SEO', coverage: 1.2 })]),
    ).toThrow(/coverage/);
    expect(() =>
      computeOverallScore('Basic', [moduleSummary({ module: 'SEO', score: 120 })]),
    ).toThrow(/score/);
  });
});
