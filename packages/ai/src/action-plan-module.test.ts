import { describe, expect, it } from 'vitest';

import {
  ACTION_PLAN_CAPS,
  ACTION_PLAN_PROMPT_VERSION,
  buildActionPlanRequest,
  parseActionPlanResponse,
  runActionPlan,
} from './action-plan-module.js';
import type { ActionPlanInput, ActionPlanRuleInput } from './action-plan-module.js';
import { CURRENT_AI_PROCESSING_NOTICE_VERSION } from './consent.js';
import { AiModuleError } from './errors.js';
import { MockAiProvider } from './mock-provider.js';
import { buildPrompt } from './prompt-builder.js';
import type { MockAiFixture } from './mock-provider.js';

const SCAN_ID = 'scan-action-plan';

function rule(overrides: Partial<ActionPlanRuleInput> = {}): ActionPlanRuleInput {
  return {
    ruleId: 'SEO-TECH-001',
    title: 'robots.txt is missing or unreachable',
    module: 'SEO',
    severity: 'High',
    openIssues: 2,
    sampleUrls: ['https://example.com/', 'https://example.com/pricing'],
    recommendations: ['Publish a robots.txt at the site root.'],
    ...overrides,
  };
}

function input(overrides: Partial<ActionPlanInput> = {}): ActionPlanInput {
  return {
    scanId: SCAN_ID,
    domain: 'example.com',
    language: 'uk',
    modules: [{ module: 'SEO', status: 'Completed', score: 72, coverage: 1 }],
    rules: [rule()],
    consent: {
      scanId: SCAN_ID,
      providers: ['anthropic'],
      noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
    },
    ...overrides,
  };
}

const VALID_PLAN = {
  overview: 'Your site blocks search engines from reading its basic instructions.',
  actions: [
    {
      title: 'Publish a robots.txt',
      why: 'Search engines cannot read the site rules without it.',
      steps: ['Create /robots.txt', 'Allow the public pages'],
      effort: 'small',
      ruleIds: ['SEO-TECH-001'],
    },
  ],
};

function planFixtures(body: unknown): readonly MockAiFixture[] {
  return [
    {
      questionIncludes: 'Write the Action Plan',
      response: {
        id: 'msg_plan',
        status: 'completed',
        output_text: JSON.stringify(body),
        usage: { input_tokens: 900, output_tokens: 400 },
      },
    },
  ];
}

function planProvider(body: unknown): MockAiProvider {
  return new MockAiProvider(planFixtures(body), {
    config: {
      provider: 'anthropic',
      apiVersion: '2023-06-01',
      modelId: 'claude-opus-5',
      timeoutMs: 1000,
      maxRetries: 1,
    },
  });
}

describe('buildActionPlanRequest', () => {
  it('sends rule metadata only — no evidence and no page content', () => {
    const request = buildActionPlanRequest(input());
    const prompt = buildPrompt(request).promptText;

    expect(request.promptVersion).toBe(ACTION_PLAN_PROMPT_VERSION);
    expect(request.caps).toEqual(ACTION_PLAN_CAPS);
    expect(request.allowModelFallback).toBe(true);
    // Adaptive thinking is what the ordering judgement needs; it is left on.
    expect(request.reasoningMode).toBeUndefined();
    expect(request.webSearch).toBeUndefined();
    expect(request.pageTitles).toEqual([]);
    expect(prompt).toContain('SEO-TECH-001');
    expect(prompt).toContain('robots.txt is missing or unreachable');
    expect(prompt).toContain('openIssues=2');
    expect(prompt).not.toContain('evidence');
    expect(prompt).not.toContain('evidenceExcerpt');
  });

  it('refuses to send an Analytics rule, because those findings are Google data', () => {
    expect(() =>
      buildActionPlanRequest(
        input({ rules: [rule(), rule({ ruleId: 'ANALYTICS-SC-001', module: 'Analytics' })] }),
      ),
    ).toThrowError(/Analytics rule/);
  });

  it('refuses an input with no rule to plan from', () => {
    expect(() => buildActionPlanRequest(input({ rules: [] }))).toThrow(AiModuleError);
  });

  it('names the plan language so the model writes in it', () => {
    const request = buildActionPlanRequest(input({ language: 'en' }));

    expect(request.question).toContain('"en"');
  });
});

describe('parseActionPlanResponse', () => {
  it('drops rule ids the scan never produced', () => {
    const content = parseActionPlanResponse(
      JSON.stringify({
        overview: 'Overview text.',
        actions: [
          {
            title: 'Fix robots',
            why: 'Because.',
            steps: ['One'],
            effort: 'small',
            ruleIds: ['SEO-TECH-001', 'MADE-UP-999'],
          },
        ],
      }),
      ['SEO-TECH-001'],
    );

    expect(content.actions[0]?.ruleIds).toEqual(['SEO-TECH-001']);
  });

  it('keeps a rule in the first Action that names it', () => {
    const content = parseActionPlanResponse(
      JSON.stringify({
        overview: 'Overview text.',
        actions: [
          {
            title: 'First',
            why: 'Because.',
            steps: ['One'],
            effort: 'small',
            ruleIds: ['SEO-TECH-001', 'SEO-TECH-002'],
          },
          {
            title: 'Second',
            why: 'Because.',
            steps: ['One'],
            effort: 'medium',
            ruleIds: ['SEO-TECH-002', 'SEO-TECH-003'],
          },
        ],
      }),
      ['SEO-TECH-001', 'SEO-TECH-002', 'SEO-TECH-003'],
    );

    expect(content.actions.map((action) => action.ruleIds)).toEqual([
      ['SEO-TECH-001', 'SEO-TECH-002'],
      ['SEO-TECH-003'],
    ]);
  });

  it('drops an Action left without a rule, and rejects a plan with none left', () => {
    const content = parseActionPlanResponse(
      JSON.stringify({
        overview: 'Overview text.',
        actions: [
          { title: 'Real', why: 'Because.', steps: ['One'], effort: 'small', ruleIds: ['A-1'] },
          { title: 'Advice', why: 'Because.', steps: ['One'], effort: 'small', ruleIds: ['X-9'] },
        ],
      }),
      ['A-1'],
    );
    expect(content.actions).toHaveLength(1);

    expect(() =>
      parseActionPlanResponse(
        JSON.stringify({
          overview: 'Overview text.',
          actions: [
            { title: 'Advice', why: 'Because.', steps: ['One'], effort: 'small', ruleIds: ['X-9'] },
          ],
        }),
        ['A-1'],
      ),
    ).toThrowError(/no Action tied to a rule/);
  });

  it('rejects malformed plans', () => {
    expect(() => parseActionPlanResponse('not json', ['A-1'])).toThrowError(/not valid JSON/);
    expect(() =>
      parseActionPlanResponse(JSON.stringify({ overview: '', actions: [] }), ['A-1']),
    ).toThrowError(/overview is empty/);
    expect(() =>
      parseActionPlanResponse(
        JSON.stringify({
          overview: 'Overview.',
          actions: Array.from({ length: 8 }, () => ({
            title: 'T',
            why: 'W',
            steps: ['S'],
            effort: 'small',
            ruleIds: ['A-1'],
          })),
        }),
        ['A-1'],
      ),
    ).toThrowError(/at most 7 items/);
    expect(() =>
      parseActionPlanResponse(
        JSON.stringify({
          overview: 'Overview.',
          actions: [{ title: 'T', why: 'W', steps: [], effort: 'small', ruleIds: ['A-1'] }],
        }),
        ['A-1'],
      ),
    ).toThrowError(/1 to 5 items/);
    expect(() =>
      parseActionPlanResponse(
        JSON.stringify({
          overview: 'Overview.',
          actions: [{ title: 'T', why: 'W', steps: ['S'], effort: 'huge', ruleIds: ['A-1'] }],
        }),
        ['A-1'],
      ),
    ).toThrowError(/small, medium or large/);
  });

  it('accepts a fenced JSON block', () => {
    const content = parseActionPlanResponse(
      ['```json', JSON.stringify(VALID_PLAN), '```'].join('\n'),
      ['SEO-TECH-001'],
    );

    expect(content.overview).toContain('blocks search engines');
  });
});

describe('runActionPlan', () => {
  it('returns the parsed plan on a valid answer', async () => {
    const result = await runActionPlan(input(), { provider: planProvider(VALID_PLAN) });

    expect(result.status).toBe('Succeeded');
    if (result.status !== 'Succeeded') return;
    expect(result.content.actions).toHaveLength(1);
    expect(result.outcome.response.modelId).toBe('claude-opus-5');
  });

  it('fails with a code, never provider text, when the answer breaks the contract', async () => {
    const result = await runActionPlan(input(), {
      provider: planProvider({ overview: 'x', actions: 'not an array' }),
    });

    expect(result).toMatchObject({ status: 'Failed', failureCode: 'ProviderContract' });
  });

  it('fails closed without a consent record for this scan', async () => {
    const result = await runActionPlan(input({ consent: null }), {
      provider: planProvider(VALID_PLAN),
    });

    expect(result).toMatchObject({ status: 'Failed', failureCode: 'ConsentMissing' });
  });
});
