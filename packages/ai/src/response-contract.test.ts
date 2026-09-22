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
      validateNormalizedResponse(makeResponse({ usageSource: 'estimated', tokenizerVersion: 'approx-v2' })),
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

describe('validateNormalizedResponse — caps запроса', () => {
  const usage = { inputTokens: 12_000, outputTokens: 15_000, totalTokens: 27_000 };

  it('usage сверяется с caps запроса, когда они переданы', () => {
    const response = makeResponse({ usage });
    expect(validateNormalizedResponse(response)).toHaveLength(2);
    expect(
      validateNormalizedResponse(response, { maxInputTokens: 20_000, maxOutputTokens: 16_000 }),
    ).toEqual([]);
    expect(
      validateNormalizedResponse(response, { maxInputTokens: 10_000, maxOutputTokens: 16_000 }),
    ).toEqual(['usage.inputTokens 12000 exceeds cap 10000']);
  });
});

describe('validateNormalizedResponse — провайдерский web search', () => {
  it('разрешает input сверх cap-а ровно на search content выполненных поисков', () => {
    const searched = (inputTokens: number, searchUnits: number) =>
      makeResponse({
        usage: { inputTokens, outputTokens: 40, totalTokens: inputTokens + 40, searchUnits },
      });

    // 8000 (prompt) + 2 * 8000 (search content) = 24 000.
    expect(validateNormalizedResponse(searched(24_000, 2))).toEqual([]);
    expect(validateNormalizedResponse(searched(24_001, 2))).toEqual([
      'usage.inputTokens 24001 exceeds cap 24000',
    ]);
    // Без поиска allowance-а нет — ответ держат прежние 8000.
    expect(validateNormalizedResponse(searched(8_001, 0))).toEqual([
      'usage.inputTokens 8001 exceeds cap 8000',
    ]);
  });

  it('отклоняет счётчики и число цитат сверх caps §5', () => {
    const overSearched = makeResponse({
      usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140, searchUnits: 9 },
    });
    expect(validateNormalizedResponse(overSearched)).toContain('usage.searchUnits 9 exceeds cap 8');

    const overCounted = makeResponse({
      usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140, citationUnits: 33 },
    });
    expect(validateNormalizedResponse(overCounted)).toContain(
      'usage.citationUnits 33 exceeds cap 32',
    );

    const overCited = makeResponse({
      citations: Array.from({ length: 33 }, (_unused, index) => `https://example.test/${index}`),
    });
    expect(validateNormalizedResponse(overCited)).toContain('citations 33 exceeds cap 32');
  });
});
