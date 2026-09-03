import { describe, expect, it } from 'vitest';

import type { ScoredFinding } from './index.js';
import { computeModuleScore } from './index.js';

// Golden Score vector из плана §25: значения — эталон контракта;
// при расхождении чинится движок, не тест.

function pageFinding(overrides: Partial<ScoredFinding>): ScoredFinding {
  return {
    ruleId: 'SEO-TECH-001',
    fingerprint: 'fluxradar-fp-v1:default',
    severity: 'High',
    scoreDelta: 'scored',
    targetKind: 'page',
    affectedTargets: 1,
    applicableTargets: 1,
    ...overrides,
  };
}

const GOLDEN_FINDINGS: readonly ScoredFinding[] = [
  pageFinding({
    ruleId: 'SEO-TECH-001',
    fingerprint: 'fp-high',
    severity: 'High',
    affectedTargets: 20,
    applicableTargets: 100,
  }),
  pageFinding({
    ruleId: 'SEO-ONPAGE-001',
    fingerprint: 'fp-medium',
    severity: 'Medium',
    affectedTargets: 50,
    applicableTargets: 100,
  }),
];

describe('computeModuleScore — golden vector §25', () => {
  it('100 applicable URL, High на 20, Medium на 50 → 96.50', () => {
    const result = computeModuleScore(GOLDEN_FINDINGS);
    expect(result.score).toBe(96.5);
    expect(result.rulePenalties).toEqual([
      {
        ruleId: 'SEO-ONPAGE-001',
        severity: 'Medium',
        affectedTargets: 50,
        applicableTargets: 100,
        penalty: 1.5,
      },
      {
        ruleId: 'SEO-TECH-001',
        severity: 'High',
        affectedTargets: 20,
        applicableTargets: 100,
        penalty: 2,
      },
    ]);
  });

  it('повтор того же fingerprint не меняет результат', () => {
    const withDuplicates = [...GOLDEN_FINDINGS, GOLDEN_FINDINGS[0], GOLDEN_FINDINGS[1]].filter(
      (finding): finding is ScoredFinding => finding !== undefined,
    );
    expect(computeModuleScore(withDuplicates).score).toBe(96.5);
  });

  it('per-URL findings с агрегатными counts (D-016) дают тот же 96.50', () => {
    const perUrl = [
      ...Array.from({ length: 20 }, (_, index) =>
        pageFinding({
          ruleId: 'SEO-TECH-001',
          fingerprint: `fp-high-${index}`,
          severity: 'High',
          affectedTargets: 20,
          applicableTargets: 100,
        }),
      ),
      ...Array.from({ length: 50 }, (_, index) =>
        pageFinding({
          ruleId: 'SEO-ONPAGE-001',
          fingerprint: `fp-medium-${index}`,
          severity: 'Medium',
          affectedTargets: 50,
          applicableTargets: 100,
        }),
      ),
    ];
    expect(computeModuleScore(perUrl).score).toBe(96.5);
  });
});

describe('computeModuleScore — penalty по видам правил', () => {
  it('site-level Critical → 75.00', () => {
    const result = computeModuleScore([
      pageFinding({
        ruleId: 'SEC-PASSIVE-002',
        fingerprint: 'fp-site-critical',
        severity: 'Critical',
        targetKind: 'site',
      }),
    ]);
    expect(result.score).toBe(75);
    expect(result.rulePenalties[0]?.penalty).toBe(25);
  });

  it('page-level Critical на всех targets → 75.00', () => {
    const result = computeModuleScore([
      pageFinding({
        ruleId: 'SEO-TECH-002',
        fingerprint: 'fp-page-critical',
        severity: 'Critical',
        affectedTargets: 40,
        applicableTargets: 40,
      }),
    ]);
    expect(result.score).toBe(75);
  });

  it('score клэмпится в 0 при большом числе правил', () => {
    const findings = Array.from({ length: 6 }, (_, index) =>
      pageFinding({
        ruleId: `SEC-RULE-00${index}`,
        fingerprint: `fp-clamp-${index}`,
        severity: 'Critical',
        targetKind: 'site',
      }),
    );
    const result = computeModuleScore(findings);
    expect(result.score).toBe(0);
    // Разбор penalty сохраняет полные значения (клэмп — только на итоге).
    expect(result.rulePenalties.reduce((sum, rule) => sum + rule.penalty, 0)).toBe(150);
  });

  it('max severity per rule (D-020): Critical + Low в одном rule → вес 25', () => {
    const result = computeModuleScore([
      pageFinding({
        ruleId: 'SEC-PASSIVE-003',
        fingerprint: 'fp-low',
        severity: 'Low',
        targetKind: 'site',
      }),
      pageFinding({
        ruleId: 'SEC-PASSIVE-003',
        fingerprint: 'fp-critical',
        severity: 'Critical',
        targetKind: 'site',
      }),
    ]);
    expect(result.score).toBe(75);
    expect(result.rulePenalties).toEqual([
      {
        ruleId: 'SEC-PASSIVE-003',
        severity: 'Critical',
        affectedTargets: 1,
        applicableTargets: 1,
        penalty: 25,
      },
    ]);
  });

  it('page-level max severity применяет вес ко всей доле affected', () => {
    const result = computeModuleScore([
      pageFinding({
        ruleId: 'A11Y-002',
        fingerprint: 'fp-a11y-low',
        severity: 'Low',
        affectedTargets: 50,
        applicableTargets: 100,
      }),
      pageFinding({
        ruleId: 'A11Y-002',
        fingerprint: 'fp-a11y-critical',
        severity: 'Critical',
        affectedTargets: 50,
        applicableTargets: 100,
      }),
    ]);
    // 25 × 50/100 = 12.5
    expect(result.score).toBe(87.5);
  });

  it('affected > applicable клэмпится долей min(1, ...) из §15', () => {
    const result = computeModuleScore([
      pageFinding({ fingerprint: 'fp-over', affectedTargets: 120, applicableTargets: 100 }),
    ]);
    expect(result.score).toBe(90);
  });

  it('доля с бесконечной десятичной дробью округляется half-up в сотых', () => {
    // 10 × 1/3 = 3.333... → penalty 3.33
    const result = computeModuleScore([
      pageFinding({ fingerprint: 'fp-third', affectedTargets: 1, applicableTargets: 3 }),
    ]);
    expect(result.rulePenalties[0]?.penalty).toBe(3.33);
    expect(result.score).toBe(96.67);
  });
});

describe('computeModuleScore — informational и границы входа', () => {
  it('informational findings (score_delta=0) не входят в сумму', () => {
    const result = computeModuleScore([
      pageFinding({
        ruleId: 'PERF-RULE-014',
        fingerprint: 'fp-info',
        severity: null,
        scoreDelta: 'informational',
      }),
    ]);
    expect(result.score).toBe(100);
    expect(result.rulePenalties).toEqual([]);
  });

  it('пустой список findings → 100.00', () => {
    expect(computeModuleScore([]).score).toBe(100);
  });

  it('отклоняет scored finding без severity (D-109)', () => {
    expect(() => computeModuleScore([pageFinding({ severity: null })])).toThrow(/severity/);
  });

  it('отклоняет site-level finding с targets ≠ 1 (§15)', () => {
    expect(() =>
      computeModuleScore([
        pageFinding({ targetKind: 'site', affectedTargets: 2, applicableTargets: 2 }),
      ]),
    ).toThrow(/site-level/);
  });

  it('отклоняет scored finding с applicable_targets = 0 (§15 Not applicable)', () => {
    expect(() =>
      computeModuleScore([pageFinding({ affectedTargets: 0, applicableTargets: 0 })]),
    ).toThrow(/applicable_targets=0/);
  });

  it('отклоняет нецелые и отрицательные counts', () => {
    expect(() => computeModuleScore([pageFinding({ affectedTargets: 1.5 })])).toThrow(/целым/);
    expect(() => computeModuleScore([pageFinding({ applicableTargets: -1 })])).toThrow(/целым/);
  });
});
