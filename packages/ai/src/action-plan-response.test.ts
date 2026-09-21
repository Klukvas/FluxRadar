import { describe, expect, it } from 'vitest';

import { ACTION_PLAN_RESPONSE_SCHEMA, parseActionPlanResponse } from './action-plan-response.js';

const KNOWN = ['SEO-TECH-004', 'SEC-PASSIVE-003', 'A11Y-001', 'PRIVACY-004'];

function action(ruleIds: readonly string[], title = 'Fix it'): Record<string, unknown> {
  return {
    ruleIds,
    title,
    why: 'It matters.',
    steps: ['Do the first thing.'],
    effort: 'small',
  };
}

function answer(
  actions: readonly Record<string, unknown>[],
  overview = 'The site is fine.',
): string {
  return JSON.stringify({ overview, actions });
}

describe('parseActionPlanResponse', () => {
  it('accepts a valid answer and collapses stray whitespace', () => {
    const result = parseActionPlanResponse(
      answer([{ ...action(['SEO-TECH-004']), title: '  Set   canonical\nURLs ' }], ' Good.  '),
      KNOWN,
    );

    expect(result).toEqual({
      kind: 'plan',
      content: {
        overview: 'Good.',
        actions: [{ ...action(['SEO-TECH-004']), title: 'Set canonical URLs' }],
      },
      ignoredRuleIds: [],
    });
  });

  it('drops rule ids the scan did not send', () => {
    const result = parseActionPlanResponse(
      answer([action(['SEO-TECH-004', 'SEO-TECH-999']), action(['A11Y-001'])]),
      KNOWN,
    );

    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') return;
    expect(result.content.actions.map((entry) => entry.ruleIds)).toEqual([
      ['SEO-TECH-004'],
      ['A11Y-001'],
    ]);
    expect(result.ignoredRuleIds).toEqual(['SEO-TECH-999']);
  });

  it('keeps a rule named twice only in the first Action, and drops an Action left empty', () => {
    const result = parseActionPlanResponse(
      answer([
        action(['SEO-TECH-004', 'SEC-PASSIVE-003'], 'First'),
        action(['SEC-PASSIVE-003', 'A11Y-001'], 'Second'),
        action(['SEO-TECH-004', 'SEO-TECH-004'], 'Third'),
      ]),
      KNOWN,
    );

    expect(result.kind).toBe('plan');
    if (result.kind !== 'plan') return;
    expect(result.content.actions.map((entry) => [entry.title, entry.ruleIds])).toEqual([
      ['First', ['SEO-TECH-004', 'SEC-PASSIVE-003']],
      ['Second', ['A11Y-001']],
    ]);
    expect(result.ignoredRuleIds).toEqual(['SEC-PASSIVE-003', 'SEO-TECH-004']);
  });

  it('makes the attempt invalid when no Action is left', () => {
    expect(parseActionPlanResponse(answer([action(['NOPE-001'])]), KNOWN)).toMatchObject({
      kind: 'invalid',
      failureCode: 'no_actions',
    });
    expect(parseActionPlanResponse(answer([]), KNOWN)).toMatchObject({
      kind: 'invalid',
      failureCode: 'no_actions',
    });
  });

  it.each([
    [
      'eight Actions',
      answer(Array.from({ length: 8 }, (_, index) => action([KNOWN[index % 4] ?? '']))),
    ],
    ['six steps', answer([{ ...action(['A11Y-001']), steps: ['1', '2', '3', '4', '5', '6'] }])],
    ['no steps', answer([{ ...action(['A11Y-001']), steps: [] }])],
    ['an Action without rule ids', answer([action([])])],
    ['an unknown effort', answer([{ ...action(['A11Y-001']), effort: 'huge' }])],
    ['an unexpected key', answer([{ ...action(['A11Y-001']), priority: 1 }])],
    ['a blank overview', answer([action(['A11Y-001'])], '   ')],
    ['an overview that runs on', answer([action(['A11Y-001'])], 'x'.repeat(2_001))],
    ['a missing field', JSON.stringify({ actions: [action(['A11Y-001'])] })],
  ])('rejects an answer with %s', (_case, rawText) => {
    expect(parseActionPlanResponse(rawText, KNOWN)).toMatchObject({
      kind: 'invalid',
      failureCode: 'invalid_output',
    });
  });

  it('never repeats the answer in the failure detail', () => {
    const result = parseActionPlanResponse('Sorry, I cannot help with SECRET-WORDS.', KNOWN);

    expect(result).toMatchObject({ kind: 'invalid', failureCode: 'invalid_output' });
    expect(JSON.stringify(result)).not.toContain('SECRET-WORDS');
  });

  it('accepts JSON wrapped in a Markdown fence', () => {
    const fenced = `\`\`\`json\n${answer([action(['A11Y-001'])])}\n\`\`\``;

    expect(parseActionPlanResponse(fenced, KNOWN).kind).toBe('plan');
  });
});

describe('ACTION_PLAN_RESPONSE_SCHEMA', () => {
  // Structured outputs answer 400 to count and length constraints and demand
  // `additionalProperties: false` on every object.
  it('uses only what structured outputs accept', () => {
    const text = JSON.stringify(ACTION_PLAN_RESPONSE_SCHEMA);
    for (const keyword of ['minItems', 'maxItems', 'minLength', 'maxLength', 'minimum']) {
      expect(text).not.toContain(keyword);
    }
    const objects = text.match(/"type":"object"/g) ?? [];
    const closed = text.match(/"additionalProperties":false/g) ?? [];
    expect(closed).toHaveLength(objects.length);
  });
});
