import { describe, expect, it, vi } from 'vitest';

import { CURRENT_AI_PROCESSING_NOTICE_VERSION } from './consent.js';
import { MockAiProvider } from './mock-provider.js';
import { AiQuotaTracker } from './quota.js';
import {
  parseUxAiClaims,
  parseUxAiResponse,
  runUxAiAnalysis,
  buildUxAiRequest,
} from './ux-module.js';

const PAGE = 'https://example.com/';
const input = {
  scanId: 'scan-ux',
  plan: 'Complete' as const,
  brand: 'Example',
  siteOrigin: PAGE,
  consent: {
    scanId: 'scan-ux',
    providers: ['anthropic' as const],
    noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
  },
  profileContext: { industry: 'dental clinic', region: 'Kyiv', offerings: 'implants' },
  pages: [
    {
      url: PAGE,
      title: 'Example clinic',
      headings: ['Dental clinic in Kyiv'],
      actions: ['Book now'],
      links: ['Book now → /book'],
      forms: [],
      contactSignals: ['Book now'],
      visibleText: 'Dental care for families in Kyiv.',
    },
  ],
};

describe('UX AI contract', () => {
  it('does not reuse GEO v1 consent for UX or spend quota', async () => {
    const provider = new MockAiProvider([]);
    const send = vi.spyOn(provider, 'send');
    const result = await runUxAiAnalysis(
      {
        ...input,
        consent: { ...input.consent, noticeVersion: 'v1' },
      },
      { provider, quota: AiQuotaTracker.withLimit(1) },
    );
    expect(result.statusReason).toBe('ConsentMissing');
    expect(result.quota.spent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
  it('rejects findings that point outside the supplied public pages', () => {
    expect(() =>
      parseUxAiResponse(
        JSON.stringify({
          findings: [
            {
              ruleId: 'UX-CONV-AI-001',
              targetUrl: 'https://evil.example/',
              severity: 'Medium',
              evidence: 'unsupported page',
              recommendation: 'ignore it',
              confidence: 0.5,
            },
          ],
        }),
        input.pages,
      ),
    ).toThrow(/target URL was not supplied/);
  });

  it('does not treat the audit origin alone as page evidence', () => {
    expect(() =>
      parseUxAiResponse(
        JSON.stringify({
          findings: [
            {
              ruleId: 'UX-CONV-AI-001',
              targetUrl: 'https://example.com',
              severity: 'Medium',
              evidence: 'origin without a crawled page snapshot',
              recommendation: 'do not create a finding',
              confidence: 0.5,
            },
          ],
        }),
        input.pages,
      ),
    ).toThrow(/target URL was not supplied/);
  });

  it('bounds the response so a multi-page review fits the provider output cap', () => {
    const page = input.pages[0];
    if (page === undefined) throw new Error('test fixture page is missing');
    const request = buildUxAiRequest({
      ...input,
      pages: [{ ...page, visibleText: 'x'.repeat(1_200) }],
    });
    expect(request.promptVersion).toBe('ux-conversion-v4');
    expect(request.question).toContain('at most 6 actionable findings');
    expect(request.question).toContain('under 240 characters');
    expect(request.reasoningMode).toBe('disabled');
    expect(request.responseSchema).toMatchObject({
      type: 'object',
      required: ['findings'],
      additionalProperties: false,
    });
    expect(request.brandFacts.join('\n')).toContain(`visibleText=${'x'.repeat(350)}`);
    expect(request.brandFacts.join('\n')).not.toContain('x'.repeat(351));
    expect(request.systemInstructions).toContain('without screenshots, computed styles, layout');
    expect(request.systemInstructions).toContain('Do not make visual hierarchy or styling claims');

    const finding = {
      ruleId: 'UX-CONV-AI-001',
      targetUrl: PAGE,
      severity: 'Medium',
      evidence: 'The offer is not stated in the first heading.',
      recommendation: 'State the service and audience in the first heading.',
      confidence: 0.8,
    };
    expect(() =>
      parseUxAiResponse(
        JSON.stringify({ findings: Array.from({ length: 7 }, () => finding) }),
        input.pages,
      ),
    ).toThrow(/at most 6 items/);
  });

  it('runs one real-contract request and accepts strict JSON output', async () => {
    const provider = new MockAiProvider(
      [
        {
          questionIncludes: 'Review Example',
          response: {
            status: 'completed',
            output_text: JSON.stringify({
              findings: [
                {
                  ruleId: 'UX-CONV-AI-002',
                  targetUrl: PAGE,
                  severity: 'Low',
                  evidence: 'The page exposes one Book now action.',
                  recommendation: 'Make the next step explicit near the offer.',
                  confidence: 0.82,
                },
              ],
            }),
            usage: { input_tokens: 420, output_tokens: 80 },
          },
        },
      ],
      {
        config: {
          provider: 'anthropic',
          modelId: 'claude-sonnet-5',
          apiVersion: '2023-06-01',
          timeoutMs: 1000,
          maxRetries: 1,
        },
      },
    );
    const result = await runUxAiAnalysis(input, {
      provider,
      quota: AiQuotaTracker.withLimit(1),
    });

    expect(result.status).toBe('Completed');
    expect(result.findings).toHaveLength(1);
    expect(result.unsupportedClaims).toEqual([]);
    expect(result.outcome.kind).toBe('response');
    expect(buildUxAiRequest(input).promptVersion).toBe('ux-conversion-v4');
  });
});

/**
 * Claims the evidence cannot support.
 *
 * These tests pin the DETERMINISTIC half of the answer: what the module does
 * with a visual claim once the provider has made one. They say nothing about how
 * often the provider makes one — the system instructions forbid it, and a prompt
 * is not a guarantee, which is exactly why this filter exists.
 */
describe('UX AI claims the evidence cannot support', () => {
  const grounded = {
    ruleId: 'UX-CONV-AI-001',
    targetUrl: PAGE,
    severity: 'Medium',
    evidence: 'The first heading names the city but not the service.',
    recommendation: 'Name the service and the audience in the first heading.',
    confidence: 0.7,
  };

  function claimsOf(findings: readonly unknown[], pages = input.pages) {
    return parseUxAiClaims(JSON.stringify({ findings }), pages);
  }

  it('drops a visual-hierarchy claim, keeps the grounded finding and names the class', () => {
    const claims = claimsOf([
      grounded,
      {
        ...grounded,
        ruleId: 'UX-CONV-AI-002',
        evidence: 'Two primary actions compete with no clear visual hierarchy.',
      },
    ]);

    expect(claims.supported.map((finding) => finding.ruleId)).toEqual(['UX-CONV-AI-001']);
    expect(claims.unsupported).toHaveLength(1);
    expect(claims.unsupported[0]?.finding.ruleId).toBe('UX-CONV-AI-002');
    expect(claims.unsupported[0]?.reason).toBe('visual-hierarchy');
  });

  it('keeps wording the page supplies even when the site is about styling', () => {
    // The audited false positive: a grounded claim about the supplied heading
    // text, rejected because the heading quotes the site's own subject matter.
    // A word in a quotation is evidence, not an assertion about rendering.
    const claims = claimsOf([
      {
        ...grounded,
        evidence:
          'The hero says "CSS training" but does not say whether classes are for beginners or professionals.',
      },
    ]);

    expect(claims.supported).toHaveLength(1);
    expect(claims.unsupported).toEqual([]);
  });

  it('keeps a claim about the headings the crawl did supply', () => {
    // `hierarchy` alone is not a rendering claim: the heading list is part of the
    // evidence, so a claim about its order is a claim about what was read.
    const claims = claimsOf([
      { ...grounded, evidence: 'The heading hierarchy jumps from the page title to a sub-step.' },
    ]);

    expect(claims.supported).toHaveLength(1);
    expect(claims.unsupported).toEqual([]);
  });

  it('judges the evidence, not the recommendation', () => {
    // "Raise the contrast" is advice about a supported claim; it asserts nothing
    // about what the crawl saw.
    const claims = claimsOf([
      {
        ...grounded,
        evidence: 'The only action on the page is labelled "Submit".',
        recommendation: 'Label the action with the outcome, and raise its colour contrast.',
      },
    ]);

    expect(claims.supported).toHaveLength(1);
    expect(claims.unsupported).toEqual([]);
  });

  it('a malformed field still rejects the whole response', () => {
    // The two failures are not the same: a broken field means the parse cannot
    // be trusted at all, and that stays a contract error.
    expect(() => claimsOf([{ ...grounded, severity: 'Critical' }])).toThrow(/severity is invalid/);
  });

  it('reports the run as completed with the remaining findings', async () => {
    const provider = uxProvider([
      grounded,
      {
        ...grounded,
        ruleId: 'UX-CONV-AI-003',
        evidence: 'The form sits below the fold on mobile.',
      },
    ]);
    const result = await runUxAiAnalysis(input, { provider, quota: AiQuotaTracker.withLimit(1) });

    expect(result.status).toBe('Completed');
    expect(result.findings.map((finding) => finding.ruleId)).toEqual(['UX-CONV-AI-001']);
    expect(result.unsupportedClaims.map((claim) => claim.reason)).toEqual(['fold']);
  });

  it('does not turn an all-rejected answer into an unavailable review', async () => {
    // Static UX checks already ran and the reader paid for them: a stray
    // sentence costs its own finding, not the whole module. What the reader is
    // owed instead is that the review produced nothing usable, and the
    // orchestrator writes that from `unsupportedClaims`.
    const provider = uxProvider([
      { ...grounded, evidence: 'The hero copy is set in a small font.' },
      {
        ...grounded,
        ruleId: 'UX-CONV-AI-002',
        evidence: 'The call to action is the same colour as the background.',
      },
    ]);
    const result = await runUxAiAnalysis(input, { provider, quota: AiQuotaTracker.withLimit(1) });

    expect(result.status).toBe('Completed');
    expect(result.findings).toEqual([]);
    expect(result.unsupportedClaims.map((claim) => claim.reason)).toEqual(['typography', 'colour']);
  });

  it('states in the prompt that the evidence carries no rendering', () => {
    const instructions = buildUxAiRequest(input).systemInstructions ?? '';
    expect(instructions).toContain('without screenshots, computed styles, layout');
    expect(instructions).toContain('Do not make visual hierarchy or styling claims');
    expect(instructions).toContain('multiple forms are confusing');
  });
});

/**
 * Claims that several of something confuse the visitor.
 *
 * The supplied form evidence is a shape — control counts, submit counts and the
 * `action` target — never a label and never a purpose. A count plus an asserted
 * visitor reaction is therefore a claim about a page nobody looked at; a count
 * the snapshot can actually ground is not.
 */
describe('UX AI count claims about forms and actions', () => {
  const twoForms = [
    {
      url: PAGE,
      title: 'Example clinic',
      headings: ['Dental clinic in Kyiv'],
      actions: ['Book now', 'Ask a question'],
      links: ['Book now \u2192 /book'],
      forms: [
        'form 1: 3 controls, 1 submit controls, action=/lead',
        'form 2: 1 controls, 1 submit controls, action=/newsletter',
      ],
      contactSignals: ['Book now'],
      visibleText: 'Dental care for families in Kyiv.',
    },
  ];
  const sameEndpoint = [
    {
      ...twoForms[0]!,
      forms: [
        'form 1: 3 controls, 1 submit controls, action=/lead',
        'form 2: 2 controls, 1 submit controls, action=/lead',
      ],
    },
  ];
  const claim = (evidence: string) => ({
    ruleId: 'UX-CONV-AI-003',
    targetUrl: PAGE,
    severity: 'Medium',
    evidence,
    recommendation: 'Say what each form is for above its first field.',
    confidence: 0.6,
  });

  it('rejects the audited claim that two distinct-purpose forms confuse visitors', () => {
    const claims = parseUxAiClaims(
      JSON.stringify({
        findings: [
          claim(
            'The two forms have different purposes but their presence creates confusion for visitors.',
          ),
        ],
      }),
      twoForms,
    );

    expect(claims.supported).toEqual([]);
    expect(claims.unsupported.map((entry) => entry.reason)).toEqual(['confusion-from-count']);
  });

  it('rejects a bare count claim the page cannot ground', () => {
    const claims = parseUxAiClaims(
      JSON.stringify({
        findings: [claim('Multiple forms on one page are confusing for visitors.')],
      }),
      twoForms,
    );

    expect(claims.supported).toEqual([]);
    expect(claims.unsupported.map((entry) => entry.reason)).toEqual(['confusion-from-count']);
  });

  it('keeps the same claim when the two forms post to one endpoint', () => {
    // The ambiguity is in the snapshot, so the reader can check it.
    const claims = parseUxAiClaims(
      JSON.stringify({
        findings: [
          claim('Two forms post to /lead, which is confusing for a visitor choosing one.'),
        ],
      }),
      sameEndpoint,
    );

    expect(claims.supported).toHaveLength(1);
    expect(claims.unsupported).toEqual([]);
  });

  it('keeps a grounded missing-label finding about the same forms', () => {
    const claims = parseUxAiClaims(
      JSON.stringify({
        findings: [
          claim(
            'The form posting to /newsletter has one control and no heading naming what it sends.',
          ),
        ],
      }),
      twoForms,
    );

    expect(claims.supported).toHaveLength(1);
    expect(claims.unsupported).toEqual([]);
  });
});

function uxProvider(findings: readonly unknown[]): MockAiProvider {
  return new MockAiProvider(
    [
      {
        questionIncludes: 'Review Example',
        response: {
          status: 'completed',
          output_text: JSON.stringify({ findings }),
          usage: { input_tokens: 420, output_tokens: 80 },
        },
      },
    ],
    {
      config: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-5',
        apiVersion: '2023-06-01',
        timeoutMs: 1000,
        maxRetries: 1,
      },
    },
  );
}
