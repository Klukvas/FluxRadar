import { describe, expect, it } from 'vitest';

import { round2 } from './index.js';

// D-021: half-up по десятичному представлению — граничные случаи, где
// округление по двоичному значению ((x).toFixed(2)) даёт другой результат.

describe('round2 (D-021, half-up по десятичному представлению)', () => {
  it('0.005 округляется вверх до 0.01', () => {
    expect(round2(0.005)).toBe(0.01);
  });

  it('2.675 округляется вверх до 2.68 (toFixed дал бы 2.67)', () => {
    expect((2.675).toFixed(2)).toBe('2.67');
    expect(round2(2.675)).toBe(2.68);
  });

  it('1.005 и 8.845 округляются вверх (классические float-ловушки)', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(8.845)).toBe(8.85);
  });

  it('третья цифра < 5 округляется вниз', () => {
    expect(round2(0.004999)).toBe(0);
    expect(round2(2.674999999)).toBe(2.67);
    expect(round2(96.494)).toBe(96.49);
  });

  it('96.495 округляется вверх до 96.5', () => {
    expect(round2(96.495)).toBe(96.5);
  });

  it('значения без третьего знака проходят без изменений', () => {
    expect(round2(96.5)).toBe(96.5);
    expect(round2(100)).toBe(100);
    expect(round2(0)).toBe(0);
    expect(round2(75.25)).toBe(75.25);
  });

  it('гасит двоичный шум арифметики (0.1 + 0.2)', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  it('67 / 0.7 → 95.71 (golden Basic partial coverage)', () => {
    expect(round2(67 / 0.7)).toBe(95.71);
  });

  it('отрицательные значения округляются симметрично (от нуля)', () => {
    expect(round2(-2.675)).toBe(-2.68);
    expect(round2(-0.004)).toBe(-0);
  });

  it('экспоненциальная запись разворачивается корректно', () => {
    expect(round2(1e-9)).toBe(0);
    expect(round2(5.5e-3)).toBe(0.01);
  });

  it('отклоняет NaN, Infinity и значения вне домена', () => {
    expect(() => round2(Number.NaN)).toThrow(/конечное число/);
    expect(() => round2(Number.POSITIVE_INFINITY)).toThrow(/конечное число/);
    expect(() => round2(1e13)).toThrow(/поддерживает/);
  });
});
