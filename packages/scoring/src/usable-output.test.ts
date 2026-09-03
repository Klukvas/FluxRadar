import { describe, expect, it } from 'vitest';

import { hasUsableOutput } from './index.js';

describe('hasUsableOutput (§18 + D-026)', () => {
  it('true: есть завершённая check и finding с evidence', () => {
    expect(
      hasUsableOutput({
        completedApplicableChecks: 3,
        signals: [{ kind: 'finding', hasEvidence: true }],
      }),
    ).toBe(true);
  });

  it('true: metric и score с evidence тоже создают usable output', () => {
    expect(
      hasUsableOutput({
        completedApplicableChecks: 1,
        signals: [{ kind: 'metric', hasEvidence: true }],
      }),
    ).toBe(true);
    expect(
      hasUsableOutput({
        completedApplicableChecks: 1,
        signals: [{ kind: 'score', hasEvidence: true }],
      }),
    ).toBe(true);
  });

  it('false: ноль завершённых applicable checks, даже при наличии сигналов', () => {
    expect(
      hasUsableOutput({
        completedApplicableChecks: 0,
        signals: [{ kind: 'finding', hasEvidence: true }],
      }),
    ).toBe(false);
  });

  it('false: сигналы без evidence (голый error/status record)', () => {
    expect(
      hasUsableOutput({
        completedApplicableChecks: 2,
        signals: [{ kind: 'finding', hasEvidence: false }],
      }),
    ).toBe(false);
  });

  it('false: только findings о недоступности самой цели (D-026)', () => {
    expect(
      hasUsableOutput({
        completedApplicableChecks: 2,
        signals: [
          { kind: 'finding', hasEvidence: true, targetUnreachable: true },
          { kind: 'finding', hasEvidence: true, targetUnreachable: true },
        ],
      }),
    ).toBe(false);
  });

  it('true: unreachable-findings не блокируют другой валидный результат', () => {
    expect(
      hasUsableOutput({
        completedApplicableChecks: 2,
        signals: [
          { kind: 'finding', hasEvidence: true, targetUnreachable: true },
          { kind: 'metric', hasEvidence: true },
        ],
      }),
    ).toBe(true);
  });

  it('false: пустой список сигналов', () => {
    expect(hasUsableOutput({ completedApplicableChecks: 5, signals: [] })).toBe(false);
  });

  it('отклоняет некорректный счётчик завершённых checks', () => {
    expect(() => hasUsableOutput({ completedApplicableChecks: -1, signals: [] })).toThrow(/целым/);
  });
});
