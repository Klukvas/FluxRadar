import { describe, expect, it, vi } from 'vitest';

import { CURRENT_AI_PROCESSING_NOTICE_VERSION } from './consent.js';
import { MockAiProvider } from './mock-provider.js';
import { AiQuotaTracker } from './quota.js';
import { parseUxAiResponse, runUxAiAnalysis, buildUxAiRequest } from './ux-module.js';

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
        [PAGE],
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
        [PAGE],
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
    expect(request.promptVersion).toBe('ux-conversion-v3');
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

    const finding = {
      ruleId: 'UX-CONV-AI-001',
      targetUrl: PAGE,
      severity: 'Medium',
      evidence: 'The offer is not stated in the first heading.',
      recommendation: 'State the service and audience in the first heading.',
      confidence: 0.8,
    };
    expect(() =>
      parseUxAiResponse(JSON.stringify({ findings: Array.from({ length: 7 }, () => finding) }), [
        PAGE,
      ]),
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
    expect(result.outcome.kind).toBe('response');
    expect(buildUxAiRequest(input).promptVersion).toBe('ux-conversion-v3');
  });
});
