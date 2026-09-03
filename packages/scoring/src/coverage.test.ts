import { describe, expect, it } from 'vitest';

import { computeCoverage } from './index.js';

describe('computeCoverage — status/coverage contract v1 (§15)', () => {
  it('Completed: все applicable checks завершены → coverage 1, reason null', () => {
    expect(computeCoverage({ applicableChecks: 42, completedApplicableChecks: 42 })).toEqual({
      status: 'Completed',
      coverage: 1,
      applicableChecks: 42,
      completedApplicableChecks: 42,
      statusReason: null,
    });
  });

  it('Partial: точная дробь completed/applicable без округления', () => {
    const result = computeCoverage({
      applicableChecks: 7,
      completedApplicableChecks: 3,
      statusReason: 'crawler stopped by page limit',
    });
    expect(result.status).toBe('Partial');
    expect(result.coverage).toBe(3 / 7);
    expect(result.statusReason).toBe('crawler stopped by page limit');
  });

  it('Partial: граница D-022 — строго 0 < coverage < 1, даже 1 из миллиона', () => {
    const result = computeCoverage({
      applicableChecks: 1_000_000,
      completedApplicableChecks: 1,
      statusReason: 'timeout after first check',
    });
    expect(result.status).toBe('Partial');
    expect(result.coverage).toBeGreaterThan(0);
    expect(result.coverage).toBeLessThan(1);
  });

  it('Unavailable: ноль завершённых при applicable > 0 → coverage 0 + reason', () => {
    const result = computeCoverage({
      applicableChecks: 5,
      completedApplicableChecks: 0,
      statusReason: 'site unreachable',
    });
    expect(result.status).toBe('Unavailable');
    expect(result.coverage).toBe(0);
    expect(result.statusReason).toBe('site unreachable');
  });

  it('Not applicable: ноль applicable checks → coverage 0 + reason', () => {
    const result = computeCoverage({
      applicableChecks: 0,
      completedApplicableChecks: 0,
      statusReason: 'no applicable targets in scope',
    });
    expect(result.status).toBe('Not applicable');
    expect(result.coverage).toBe(0);
    expect(result.applicableChecks).toBe(0);
  });

  it('reason обязателен для Partial, Unavailable и Not applicable', () => {
    expect(() => computeCoverage({ applicableChecks: 7, completedApplicableChecks: 3 })).toThrow(
      /statusReason/,
    );
    expect(() =>
      computeCoverage({ applicableChecks: 5, completedApplicableChecks: 0, statusReason: '  ' }),
    ).toThrow(/statusReason/);
    expect(() => computeCoverage({ applicableChecks: 0, completedApplicableChecks: 0 })).toThrow(
      /statusReason/,
    );
  });

  it('отклоняет неконсистентные счётчики', () => {
    expect(() => computeCoverage({ applicableChecks: 3, completedApplicableChecks: 4 })).toThrow(
      /превышать/,
    );
    expect(() => computeCoverage({ applicableChecks: -1, completedApplicableChecks: 0 })).toThrow(
      /целым/,
    );
    expect(() => computeCoverage({ applicableChecks: 2.5, completedApplicableChecks: 1 })).toThrow(
      /целым/,
    );
  });
});
