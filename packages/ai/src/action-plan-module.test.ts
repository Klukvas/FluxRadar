import { ACTION_PLAN_NOTICE_VERSION } from '@fluxradar/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  ACTION_PLAN_PROMPT_VERSION,
  ACTION_PLAN_REQUEST_CAPS,
  actionPlanSystemInstructions,
  buildActionPlanRequest,
  runActionPlan,
  withoutQueryAndFragment,
} from './action-plan-module.js';
import type { ActionPlanInput, ActionPlanRuleInput } from './action-plan-module.js';
import { AiModuleError } from './errors.js';
import { MockAiProvider } from './mock-provider.js';
import type { OpenAiShapedResponse } from './mock-provider.js';
import { buildPrompt } from './prompt-builder.js';
import type { AiProvider, NormalizedAiResponse } from './types.js';

const SCAN_ID = 'scan-plan';

function rule(overrides: Partial<ActionPlanRuleInput> = {}): ActionPlanRuleInput {
  return {
    ruleId: 'SEO-TECH-004',
    title: 'Canonical URL is missing or wrong',
    module: 'SEO',
    severity: 'Medium',
    openIssues: 4,
    sampleUrls: ['https://example.com/blog/post'],
    recommendations: ['Point each page’s canonical link at the address it should rank under.'],
    ...overrides,
  };
}

function input(overrides: Partial<ActionPlanInput> = {}): ActionPlanInput {
  return {
    scanId: SCAN_ID,
    domain: 'example.com',
    language: 'en',
    consent: {
      scanId: SCAN_ID,
      providers: ['anthropic'],
      noticeVersion: ACTION_PLAN_NOTICE_VERSION,
    },
    modules: [
      { module: 'SEO', status: 'Completed', score: 71.6, coverage: 1 },
      { module: 'Performance', status: 'Partial', score: null, coverage: 0.5 },
    ],
    rules: [
      rule(),
      rule({
        ruleId: 'SEC-PASSIVE-003',
        title: 'HTTPS is not enforced (HSTS)',
        module: 'Security',
        severity: 'High',
        openIssues: 1,
        sampleUrls: ['https://example.com/'],
        recommendations: ['Send a Strict-Transport-Security header.'],
      }),
    ],
    ...overrides,
  };
}

const ANTHROPIC_MOCK_CONFIG = {
  provider: 'anthropic' as const,
  apiVersion: '2023-06-01',
  modelId: 'claude-opus-5',
  timeoutMs: 1000,
  maxRetries: 1 as const,
};

const PLAN = {
  overview: 'The site works, but search engines and browsers get mixed signals.',
  actions: [
    {
      ruleIds: ['SEC-PASSIVE-003'],
      title: 'Turn on HSTS',
      why: 'Browsers keep using HTTPS once they have seen it.',
      steps: ['Add the Strict-Transport-Security header in the web server.'],
      effort: 'small',
    },
    {
      ruleIds: ['SEO-TECH-004', 'SEO-TECH-999'],
      title: 'Fix canonical links',
      why: 'Each page should point search engines at one address.',
      steps: ['Set the canonical link in the page template.', 'Check the blog posts.'],
      effort: 'medium',
    },
  ],
};

function mockProvider(response: OpenAiShapedResponse): MockAiProvider {
  return new MockAiProvider([{ questionIncludes: 'Action Plan', response }], {
    config: ANTHROPIC_MOCK_CONFIG,
  });
}

function planResponse(body: unknown = PLAN): OpenAiShapedResponse {
  return {
    id: 'msg_plan',
    model: 'claude-opus-4-8',
    status: 'completed',
    output_text: JSON.stringify(body),
    usage: { input_tokens: 3_000, output_tokens: 9_000 },
  };
}

/** A provider that answers with a fixed normalized response. */
function stubProvider(overrides: Partial<NormalizedAiResponse>): AiProvider {
  return {
    config: ANTHROPIC_MOCK_CONFIG,
    send: async () => ({
      provider: 'anthropic',
      apiVersion: '2023-06-01',
      modelId: 'claude-opus-5',
      requestId: 'msg_stub',
      requestIdSource: 'provider',
      createdAt: '2026-09-21T12:00:00.000Z',
      rawText: JSON.stringify(PLAN),
      citations: [],
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      usageSource: 'provider',
      finishReason: 'stop',
      ...overrides,
    }),
  };
}

function promptOf(request: ReturnType<typeof buildActionPlanRequest>): string {
  return buildPrompt(request).promptText;
}

describe('Action Plan request', () => {
  it('asks Opus 5 for schema-bound JSON with its own caps and the refusal fallback', () => {
    const request = buildActionPlanRequest(input());

    expect(request).toMatchObject({
      scanId: SCAN_ID,
      provider: 'anthropic',
      promptVersion: ACTION_PLAN_PROMPT_VERSION,
      caps: ACTION_PLAN_REQUEST_CAPS,
      refusalFallback: 'default',
      responseSchema: { type: 'object', required: ['overview', 'actions'] },
    });
    // Opus 5 thinks adaptively only while `thinking` is left out.
    expect(request).not.toHaveProperty('reasoningMode');
    expect(ACTION_PLAN_REQUEST_CAPS.maxOutputTokens).toBeGreaterThanOrEqual(16_000);
  });

  it('states the rules of the plan and names its language', () => {
    const instructions = actionPlanSystemInstructions('de');

    expect(instructions).toContain('Write every text value in German (de)');
    expect(instructions).toContain('translate them');
    expect(instructions).toContain('at most 7');
    expect(instructions).toContain('impact over effort');
    expect(instructions).toContain('never name the same rule id twice');
    expect(instructions).toContain('Do not write how many issues');
    expect(instructions).toContain('whoever will fix');
    expect(buildActionPlanRequest(input({ language: 'uk' })).systemInstructions).toContain(
      'Ukrainian (uk)',
    );
  });

  it('sends only the declared fields: no evidence, screenshots or traces ride along', () => {
    // The API reads issues whole; a field the prompt does not name must not leak.
    const smuggled = {
      ...rule(),
      evidenceExcerpt: 'EVIDENCE-EXCERPT-TEXT',
      screenshotRef: 'screenshots/SCREENSHOT-KEY.png',
      traceRef: 'traces/TRACE-KEY.zip',
    } as ActionPlanRuleInput;
    const prompt = promptOf(buildActionPlanRequest(input({ rules: [smuggled] })));

    expect(prompt).toContain('SEO-TECH-004');
    expect(prompt).toContain('Canonical URL is missing or wrong');
    for (const secret of ['EVIDENCE-EXCERPT-TEXT', 'SCREENSHOT-KEY', 'TRACE-KEY']) {
      expect(prompt).not.toContain(secret);
    }
  });

  it('refuses Analytics rules and sections before anything is sent', async () => {
    const analyticsRule = rule({ ruleId: 'ANALYTICS-SC-002', module: 'Analytics' });
    const provider = mockProvider(planResponse());
    const send = vi.spyOn(provider, 'send');

    await expect(
      runActionPlan(input({ rules: [rule(), analyticsRule] }), { provider }),
    ).rejects.toThrow(AiModuleError);
    expect(() =>
      buildActionPlanRequest(
        input({
          modules: [{ module: 'Analytics', status: 'Completed', score: 90, coverage: 1 }],
        }),
      ),
    ).toThrow(/Analytics/);
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses an input it cannot plan from', () => {
    expect(() => buildActionPlanRequest(input({ rules: [] }))).toThrow(AiModuleError);
    expect(() => buildActionPlanRequest(input({ rules: [rule(), rule()] }))).toThrow(/twice/);
    expect(() => buildActionPlanRequest(input({ rules: [rule({ openIssues: 0 })] }))).toThrow(
      AiModuleError,
    );
  });

  it('sends at most three page addresses per rule, without query string or fragment', () => {
    const prompt = promptOf(
      buildActionPlanRequest(
        input({
          rules: [
            rule({
              sampleUrls: [
                'https://user:pass@example.com/a?session=abc#top',
                'https://example.com/a?other=1',
                'https://example.com/b#section',
                'https://example.com/c',
                'https://example.com/d',
              ],
            }),
          ],
        }),
      ),
    );

    expect(prompt).toContain(
      '"samplePages":["https://example.com/a","https://example.com/b","https://example.com/c"]',
    );
    expect(prompt).not.toMatch(/session|other=1|#top|#section|user:pass|example\.com\/d/);
  });

  it('removes query string and fragment from any address', () => {
    expect(withoutQueryAndFragment('https://example.com/path?q=1#x')).toBe(
      'https://example.com/path',
    );
    expect(withoutQueryAndFragment('/relative/path?q=1#x')).toBe('/relative/path');
  });

  it('lists the most severe and widespread rules first', () => {
    const prompt = promptOf(
      buildActionPlanRequest(
        input({
          rules: [
            rule({ ruleId: 'A11Y-001', module: 'Accessibility', severity: 'Low', openIssues: 40 }),
            rule({ ruleId: 'SEO-TECH-004', severity: 'Medium', openIssues: 2 }),
            rule({ ruleId: 'SEO-TECH-001', severity: 'High', openIssues: 1 }),
            rule({ ruleId: 'SEO-TECH-006', severity: 'Medium', openIssues: 9 }),
          ],
        }),
      ),
    );
    const order = ['SEO-TECH-001', 'SEO-TECH-006', 'SEO-TECH-004', 'A11Y-001'].map((ruleId) =>
      prompt.indexOf(`"ruleId":"${ruleId}"`),
    );

    expect(order.every((position) => position > 0)).toBe(true);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
  });

  it('describes each section with its status, score and coverage', () => {
    const prompt = promptOf(buildActionPlanRequest(input()));

    expect(prompt).toContain('Section SEO: Completed, score 72/100, 100% of applicable checks');
    expect(prompt).toContain('Section Performance: Partial, not scored, 50% of applicable checks');
  });
});

describe('runActionPlan', () => {
  it('returns the plan, the exact prompt sent and the model that served it', async () => {
    const provider = mockProvider(planResponse());
    const send = vi.spyOn(provider, 'send');

    const result = await runActionPlan(input(), { provider });

    expect(result.status).toBe('succeeded');
    if (result.status !== 'succeeded') return;
    expect(result.content.overview).toBe(PLAN.overview);
    expect(result.content.actions.map((action) => action.ruleIds)).toEqual([
      ['SEC-PASSIVE-003'],
      ['SEO-TECH-004'],
    ]);
    expect(result.ignoredRuleIds).toEqual(['SEO-TECH-999']);
    expect(result.promptText).toBe(send.mock.calls[0]?.[1]);
    expect(result.promptVersion).toBe(ACTION_PLAN_PROMPT_VERSION);
    expect(result.response).toMatchObject({
      modelId: 'claude-opus-4-8',
      requestId: 'msg_plan',
      usage: { inputTokens: 3_000, outputTokens: 9_000, totalTokens: 12_000 },
    });
  });

  it('redacts the prompt before it leaves', async () => {
    const provider = mockProvider(planResponse());
    const result = await runActionPlan(
      input({ rules: [rule({ recommendations: ['Write to owner@example.com for access.'] })] }),
      { provider },
    );

    expect(result.status).toBe('succeeded');
    if (result.status !== 'succeeded') return;
    expect(result.promptText).toContain('[REDACTED:email]');
    expect(result.promptText).not.toContain('owner@example.com');
  });

  it.each([
    ['no consent', null],
    [
      'the pre-purchase notice instead of the plan notice',
      {
        scanId: SCAN_ID,
        providers: ['anthropic' as const],
        noticeVersion: 'core-ai-processing-notice-v3',
      },
    ],
    [
      'consent for another scan',
      {
        scanId: 'other',
        providers: ['anthropic' as const],
        noticeVersion: ACTION_PLAN_NOTICE_VERSION,
      },
    ],
  ])('fails without calling the provider on %s', async (_case, consent) => {
    const provider = mockProvider(planResponse());
    const send = vi.spyOn(provider, 'send');

    const result = await runActionPlan(input({ consent }), { provider });

    expect(result).toMatchObject({
      status: 'failed',
      failureCode: 'consent_missing',
      response: null,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('fails when the provider is unavailable', async () => {
    const provider = new MockAiProvider(
      [{ questionIncludes: 'Action Plan', unavailable: 'Anthropic HTTP 529' }],
      { config: ANTHROPIC_MOCK_CONFIG },
    );

    const result = await runActionPlan(input(), { provider });

    expect(result).toMatchObject({
      status: 'failed',
      failureCode: 'provider_unavailable',
      response: null,
    });
  });

  it('fails on a refusal, keeping the usage it cost', async () => {
    const provider = stubProvider({ finishReason: 'safety' });

    const result = await runActionPlan(input(), { provider });

    expect(result).toMatchObject({ status: 'failed', failureCode: 'refused' });
    expect(result.status === 'failed' ? result.response?.usage.totalTokens : null).toBe(150);
  });

  it('fails on an answer cut off at the output cap', async () => {
    const provider = mockProvider({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output_text: '{"overview":"The site',
      usage: { input_tokens: 3_000, output_tokens: 16_000 },
    });

    const result = await runActionPlan(input(), { provider });

    expect(result).toMatchObject({ status: 'failed', failureCode: 'truncated' });
  });

  it('fails on an answer outside the contract, and on one naming no rule of the scan', async () => {
    const invalid = await runActionPlan(input(), {
      provider: mockProvider(planResponse({ overview: 'Only an overview.' })),
    });
    const unknownOnly = await runActionPlan(input(), {
      provider: mockProvider(
        planResponse({ ...PLAN, actions: [{ ...PLAN.actions[0], ruleIds: ['NOPE-001'] }] }),
      ),
    });

    expect(invalid).toMatchObject({ status: 'failed', failureCode: 'invalid_output' });
    expect(unknownOnly).toMatchObject({ status: 'failed', failureCode: 'no_actions' });
  });
});
