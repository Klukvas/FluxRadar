// Prompt-builder (T-10, §5): порядок секций = приоритет truncation,
// детерминированное усечение с маркером [TRUNCATED], input cap 8000 tokens.

import { AI_REQUEST_CAPS } from '@fluxradar/contracts';
import { describe, expect, it } from 'vitest';

import {
  buildPrompt,
  CHARS_PER_TOKEN,
  enforceInputCap,
  estimateTokens,
  TOKENIZER_VERSION,
  TRUNCATION_MARKER,
} from './prompt-builder.js';
import { makeRequest } from './testing/harness.js';

describe('estimateTokens (approx-v1)', () => {
  it('оценивает ceil(chars / 4)', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('buildPrompt — без усечения', () => {
  it('секции идут в §5-приоритете: system → question → brand-facts → page-titles', () => {
    const prompt = buildPrompt(makeRequest());
    const positions = ['[system]', '[question]', '[brand-facts]', '[page-titles]'].map((header) =>
      prompt.promptText.indexOf(header),
    );
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(prompt.truncated).toBe(false);
    expect(prompt.tokenizerVersion).toBe(TOKENIZER_VERSION);
    expect(prompt.inputTokens).toBe(estimateTokens(prompt.promptText));
  });

  it('пустые списки не создают секций', () => {
    const prompt = buildPrompt(makeRequest({ brandFacts: [], pageTitles: [] }));
    expect(prompt.promptText).not.toContain('[brand-facts]');
    expect(prompt.promptText).not.toContain('[page-titles]');
  });
});

describe('buildPrompt — truncation', () => {
  const oversized = makeRequest({
    pageTitles: Array.from({ length: 3000 }, (_, index) => `Page title number ${index}`),
  });

  it('усечение детерминировано: два вызова byte-identical', () => {
    const first = buildPrompt(oversized);
    const second = buildPrompt(oversized);
    expect(first.truncated).toBe(true);
    expect(second.promptText).toBe(first.promptText);
    expect(
      Buffer.from(first.promptText, 'utf8').equals(Buffer.from(second.promptText, 'utf8')),
    ).toBe(true);
  });

  it('маркер [TRUNCATED] завершает prompt, cap соблюдён ровно', () => {
    const prompt = buildPrompt(oversized);
    expect(prompt.promptText.endsWith(`\n${TRUNCATION_MARKER}`)).toBe(true);
    // keepChars-математика даёт ровно cap: 8000 tokens × 4 chars.
    expect(prompt.promptText.length).toBe(AI_REQUEST_CAPS.maxInputTokens * CHARS_PER_TOKEN);
    expect(prompt.inputTokens).toBe(AI_REQUEST_CAPS.maxInputTokens);
  });

  it('приоритет секций: system и вопрос выживают, хвост заголовков режется', () => {
    const prompt = buildPrompt(oversized);
    expect(prompt.promptText).toContain(`[system]\n${oversized.systemInstructions}`);
    expect(prompt.promptText).toContain(`[question]\n${oversized.question}`);
    expect(prompt.promptText).not.toContain('Page title number 2999');
  });

  it('усечённый prompt не превышает cap в токенах', () => {
    const prompt = buildPrompt(oversized);
    expect(estimateTokens(prompt.promptText)).toBeLessThanOrEqual(AI_REQUEST_CAPS.maxInputTokens);
  });
});

describe('enforceInputCap (D-177)', () => {
  const charBudget = AI_REQUEST_CAPS.maxInputTokens * CHARS_PER_TOKEN;

  it('текст в пределах cap возвращается без изменений', () => {
    const text = 'short prompt';
    expect(enforceInputCap(text)).toEqual({ text, truncated: false });
  });

  it('текст сверх cap усечён ровно до cap с маркером, детерминированно', () => {
    const oversizedText = 'x'.repeat(charBudget + 1);
    const first = enforceInputCap(oversizedText);
    const second = enforceInputCap(oversizedText);
    expect(first.truncated).toBe(true);
    expect(first.text.length).toBe(charBudget);
    expect(first.text.endsWith(`\n${TRUNCATION_MARKER}`)).toBe(true);
    expect(second.text).toBe(first.text);
  });
});
