// Валидатор normalized response contract §5 (платформенный инвариант
// GEO-PROVIDER-001): total = input + output, обязательные поля, caps,
// tokenizerVersion при estimated.

import { describe, expect, it } from 'vitest';

import { validateNormalizedResponse } from './response-contract.js';
import { makeResponse } from './testing/harness.js';

describe('validateNormalizedResponse', () => {
  it('валидный ответ проходит без нарушений', () => {
    expect(validateNormalizedResponse(makeResponse())).toEqual([]);
  });

  it('total != input + output — ядро GEO-PROVIDER-001', () => {
    const broken = makeResponse({ usage: { inputTokens: 100, outputTokens: 40, totalTokens: 141 } });
    const violations = validateNormalizedResponse(broken);
    expect(violations.some((violation) => violation.includes('totalTokens'))).toBe(true);
  });

  it('usageSource=estimated требует tokenizerVersion', () => {
    const violations = validateNormalizedResponse(makeResponse({ usageSource: 'estimated' }));
    expect(violations.some((violation) => violation.includes('tokenizerVersion'))).toBe(true);
    expect(
      validateNormalizedResponse(makeResponse({ usageSource: 'estimated', tokenizerVersion: 'approx-v1' })),
    ).toEqual([]);
  });

  it('превышение caps input/output — нарушение', () => {
    const oversized = makeResponse({
      usage: { inputTokens: 8001, outputTokens: 2001, totalTokens: 10_002 },
    });
    const violations = validateNormalizedResponse(oversized);
    expect(violations.some((violation) => violation.includes('inputTokens 8001'))).toBe(true);
    expect(violations.some((violation) => violation.includes('outputTokens 2001'))).toBe(true);
  });

  it('пустые обязательные поля перечисляются в нарушениях', () => {
    const empty = makeResponse({ apiVersion: '', modelId: '', requestId: '' });
    const violations = validateNormalizedResponse(empty);
    expect(violations).toContain('apiVersion is empty');
    expect(violations).toContain('modelId is empty');
    expect(violations).toContain('requestId is empty');
  });

  it('createdAt обязан быть ISO-8601 UTC с суффиксом Z', () => {
    expect(
      validateNormalizedResponse(makeResponse({ createdAt: '2026-01-01T00:00:00+03:00' })).some(
        (violation) => violation.includes('createdAt'),
      ),
    ).toBe(true);
    expect(validateNormalizedResponse(makeResponse({ createdAt: '2026-01-01T00:00:00Z' }))).toEqual(
      [],
    );
  });

  it('незарегистрированный провайдер и битые enum-поля отклоняются', () => {
    const bogus = makeResponse({
      provider: 'closedai' as never,
      requestIdSource: 'guess' as never,
      usageSource: 'vibes' as never,
      finishReason: 'maybe' as never,
    });
    const violations = validateNormalizedResponse(bogus);
    expect(violations.length).toBeGreaterThanOrEqual(4);
  });

  it('дробные/отрицательные токены отклоняются', () => {
    const broken = makeResponse({ usage: { inputTokens: 1.5, outputTokens: -1, totalTokens: 0.5 } });
    expect(validateNormalizedResponse(broken).length).toBeGreaterThanOrEqual(3);
  });
});
