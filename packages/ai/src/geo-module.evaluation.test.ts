// The GEO module's evaluation pass: one judge per answer, and no answer in
// another answer's judging context.

import { describe, expect, it, vi } from 'vitest';

import { GEO_EVALUATION_PROMPT_VERSION } from './geo-evaluation.js';
import { CURRENT_AI_PROCESSING_NOTICE_VERSION } from './consent.js';
import { buildGeoEvidenceSnapshot } from './geo-evidence.js';
import type { GeoEvidenceSnapshot } from './geo-evidence.js';
import { runGeoModule } from './geo-module.js';
import type { GeoModuleInput } from './geo-module.js';
import { MockAiProvider } from './mock-provider.js';
import type { MockAiFixture } from './mock-provider.js';
import { AiQuotaTracker } from './quota.js';
import type { AiProvider, AiProviderConfig, AiRequest } from './types.js';

const SCAN_ID = 'scan-geo-eval';
const DOMAIN = 'smile.example';

const ANTHROPIC_CONFIG: AiProviderConfig = {
  provider: 'anthropic',
  apiVersion: '2023-06-01',
  modelId: 'claude-sonnet-5',
  timeoutMs: 1_000,
  maxRetries: 1,
};

const EVIDENCE: GeoEvidenceSnapshot = buildGeoEvidenceSnapshot({
  siteDomain: DOMAIN,
  brandIsHostname: false,
  profile: { brand: 'Smile Clinic', businessDescription: 'Dental clinic in Kyiv' },
  pages: [
    {
      url: `https://${DOMAIN}/`,
      title: 'Smile Clinic',
      visibleText: 'We place implants and see emergency patients in Kyiv.',
    },
  ],
});

const FIRST_ANSWER = 'Smile Clinic places implants in Kyiv.';
const SECOND_ANSWER = 'Smile Clinic is recommended by a Warsaw veterinary directory.';

function question(index: number): AiRequest {
  return {
    scanId: SCAN_ID,
    provider: 'anthropic',
    promptVersion: `geo-questions-v5-${index === 0 ? 'closed-book' : 'discovery'}`,
    sequence: index + 1,
    question: index === 0 ? 'ASK-FIRST about the clinic' : 'ASK-SECOND about local providers',
    brandFacts: [],
    pageTitles: [],
    systemInstructions: 'Answer factually.',
  };
}

function unverifiedVerdict(quote: string): string {
  return JSON.stringify({
    answerDescribesSubject: true,
    claims: [
      { claim: 'The answer names the business.', verdict: 'unverified', answerQuote: quote },
    ],
    overall: 'unverified',
  });
}

/** Judge fixtures first: an evaluation prompt quotes the question back. */
const FIXTURES: readonly MockAiFixture[] = [
  {
    questionIncludes: 'places implants in Kyiv',
    response: { status: 'completed', output_text: unverifiedVerdict('places implants in Kyiv') },
  },
  {
    questionIncludes: 'Warsaw veterinary directory',
    response: {
      status: 'completed',
      output_text: unverifiedVerdict('a Warsaw veterinary directory'),
    },
  },
  { questionIncludes: 'ASK-FIRST', response: { status: 'completed', output_text: FIRST_ANSWER } },
  { questionIncludes: 'ASK-SECOND', response: { status: 'completed', output_text: SECOND_ANSWER } },
];

function moduleInput(overrides: Partial<GeoModuleInput> = {}): GeoModuleInput {
  return {
    scanId: SCAN_ID,
    plan: 'Complete',
    brand: 'Smile Clinic',
    siteOrigin: `https://${DOMAIN}`,
    siteDomain: DOMAIN,
    consent: {
      scanId: SCAN_ID,
      providers: ['anthropic'],
      noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
    },
    requests: [question(0), question(1)],
    evidence: EVIDENCE,
    ...overrides,
  };
}

function recordingProvider(fixtures: readonly MockAiFixture[] = FIXTURES): {
  provider: AiProvider;
  prompts: () => readonly { request: AiRequest; promptText: string }[];
} {
  const inner = new MockAiProvider(fixtures, { config: ANTHROPIC_CONFIG });
  const seen: { request: AiRequest; promptText: string }[] = [];
  return {
    provider: {
      config: inner.config,
      send: async (request, promptText) => {
        seen.push({ request, promptText });
        return inner.send(request, promptText);
      },
    },
    prompts: () => seen,
  };
}

describe('GEO answer evaluation inside the module', () => {
  it('judges each answer in its own request, against the same evidence', async () => {
    const { provider, prompts } = recordingProvider();

    const result = await runGeoModule(moduleInput(), {
      provider,
      quota: AiQuotaTracker.withLimit(10),
    });

    const judgePrompts = prompts().filter(
      (call) => call.request.promptVersion === GEO_EVALUATION_PROMPT_VERSION,
    );
    expect(judgePrompts).toHaveLength(2);
    // The decisive property: neither answer is anywhere in the other's judging
    // context, so one answer cannot colour the verdict on another.
    expect(judgePrompts[0]?.promptText).toContain(FIRST_ANSWER);
    expect(judgePrompts[0]?.promptText).not.toContain(SECOND_ANSWER);
    expect(judgePrompts[1]?.promptText).toContain(SECOND_ANSWER);
    expect(judgePrompts[1]?.promptText).not.toContain(FIRST_ANSWER);
    for (const call of judgePrompts) {
      expect(call.promptText).toContain('We place implants and see emergency patients in Kyiv.');
    }
    expect(result.answerEvaluations.size).toBe(2);
  });

  it('never puts a verdict back into an answering request', async () => {
    const { provider, prompts } = recordingProvider();

    await runGeoModule(moduleInput(), { provider, quota: AiQuotaTracker.withLimit(10) });

    const answerPrompts = prompts().filter(
      (call) => call.request.promptVersion !== GEO_EVALUATION_PROMPT_VERSION,
    );
    expect(answerPrompts).toHaveLength(2);
    for (const call of answerPrompts) {
      expect(call.promptText).not.toContain('answer-to-judge');
      expect(call.promptText).not.toContain('matches-evidence');
      expect(call.promptText).not.toContain('We place implants');
    }
  });

  it('keys each verdict by the answer it belongs to, with its own request key', async () => {
    const { provider } = recordingProvider();

    const result = await runGeoModule(moduleInput(), {
      provider,
      quota: AiQuotaTracker.withLimit(10),
    });

    for (const answer of result.responses) {
      const evaluation = result.answerEvaluations.get(answer.aiRequestKey);
      expect(evaluation?.parentAiRequestKey).toBe(answer.aiRequestKey);
      expect(evaluation?.aiRequestKey).not.toBe(answer.aiRequestKey);
      expect(evaluation?.status).toBe('Completed');
    }
    expect(result.answerEvaluations.get(result.responses[0]?.aiRequestKey ?? '')?.purpose).toBe(
      'closed-book',
    );
    expect(result.answerEvaluations.get(result.responses[1]?.aiRequestKey ?? '')?.purpose).toBe(
      'discovery',
    );
  });

  it('spends one quota unit per answer and one per completed evaluation', async () => {
    const { provider } = recordingProvider();

    const result = await runGeoModule(moduleInput(), {
      provider,
      quota: AiQuotaTracker.withLimit(10),
    });

    expect(result.quota.spent).toBe(4);
    expect(result.quota.outstanding).toBe(0);
    expect(result.evaluationOutcomes).toHaveLength(2);
  });

  it('keeps both answers when the quota runs out mid-evaluation', async () => {
    const { provider } = recordingProvider();

    // Two answers and one judge fit; the second judge does not.
    const result = await runGeoModule(moduleInput(), {
      provider,
      quota: AiQuotaTracker.withLimit(3),
    });

    expect(result.responses).toHaveLength(2);
    expect(result.status).toBe('Completed');
    const verdicts = [...result.answerEvaluations.values()];
    expect(verdicts.filter((evaluation) => evaluation.status === 'Completed')).toHaveLength(1);
    expect(verdicts.filter((evaluation) => evaluation.reason === 'QuotaExceeded')).toHaveLength(1);
  });

  it('keeps an answer visible and unverified when its judge returns nonsense', async () => {
    const { provider } = recordingProvider([
      {
        questionIncludes: 'places implants in Kyiv',
        response: { status: 'completed', output_text: 'Looks right to me.' },
      },
      ...FIXTURES.slice(1),
    ]);

    const result = await runGeoModule(moduleInput(), {
      provider,
      quota: AiQuotaTracker.withLimit(10),
    });

    const first = result.answerEvaluations.get(result.responses[0]?.aiRequestKey ?? '');
    expect(first).toMatchObject({
      status: 'Unavailable',
      reason: 'ProviderContract',
      payload: null,
    });
    expect(result.responses[0]?.response.rawText).toBe(FIRST_ANSWER);
    expect(result.status).toBe('Completed');
  });

  it('evaluates nothing, and reports nothing, when no evidence snapshot is supplied', async () => {
    const { provider, prompts } = recordingProvider();

    const result = await runGeoModule(moduleInput({ evidence: null }), {
      provider,
      quota: AiQuotaTracker.withLimit(10),
    });

    expect(result.answerEvaluations.size).toBe(0);
    expect(result.evaluationOutcomes).toEqual([]);
    expect(
      prompts().filter((call) => call.request.promptVersion === GEO_EVALUATION_PROMPT_VERSION),
    ).toEqual([]);
  });

  it('does not judge answers that were never given', async () => {
    const { provider } = recordingProvider([
      { questionIncludes: 'ASK-FIRST', unavailable: 'provider down' },
      ...FIXTURES.slice(1),
    ]);
    const result = await runGeoModule(moduleInput(), {
      provider,
      quota: AiQuotaTracker.withLimit(10),
    });

    expect(result.status).toBe('Partial');
    expect(result.answerEvaluations.size).toBe(1);
  });

  // A judge's key is derived from its prompt and its sequence. Numbering the
  // judges by their position among the answers that happened to succeed meant a
  // retry where one more question answered renumbered the rest — the same
  // answer would be judged, and billed, under a second key.
  it('gives an answer the same judge key however many of its siblings failed', async () => {
    const full = recordingProvider();
    const firstFailed = recordingProvider([
      { questionIncludes: 'ASK-FIRST', unavailable: 'provider down' },
      ...FIXTURES.slice(1),
    ]);

    const complete = await runGeoModule(moduleInput(), {
      provider: full.provider,
      quota: AiQuotaTracker.withLimit(10),
    });
    const partial = await runGeoModule(moduleInput(), {
      provider: firstFailed.provider,
      quota: AiQuotaTracker.withLimit(10),
    });

    const secondAnswerKey = (result: typeof complete): string =>
      result.responses.find((answer) => answer.request.sequence === 2)?.aiRequestKey ?? '';
    const judgeKeyOf = (result: typeof complete): string | null =>
      result.answerEvaluations.get(secondAnswerKey(result))?.aiRequestKey ?? null;

    expect(judgeKeyOf(complete)).not.toBeNull();
    expect(judgeKeyOf(partial)).toBe(judgeKeyOf(complete));
  });

  it('hands every judge the redacted snapshot, and returns that same one to store', async () => {
    const { provider, prompts } = recordingProvider();

    const result = await runGeoModule(
      moduleInput({
        evidence: buildGeoEvidenceSnapshot({
          siteDomain: DOMAIN,
          brandIsHostname: false,
          profile: { brand: 'Smile Clinic', businessDescription: 'Write to owner@smile.example' },
          pages: [
            {
              url: `https://${DOMAIN}/`,
              title: 'Smile Clinic',
              visibleText: 'We place implants and see emergency patients in Kyiv.',
            },
          ],
        }),
      }),
      { provider, quota: AiQuotaTracker.withLimit(10) },
    );

    const judgePrompts = prompts().filter(
      (call) => call.request.promptVersion === GEO_EVALUATION_PROMPT_VERSION,
    );
    expect(judgePrompts).toHaveLength(2);
    for (const call of judgePrompts) {
      expect(call.promptText).not.toContain('owner@smile.example');
    }
    // What is stored is the text that was judged, not a differently sanitised
    // copy of the original.
    const stored = result.evaluatedEvidence?.sources.find(
      (source) => source.label === 'Business description',
    );
    expect(stored?.excerpt).toBe('Write to [REDACTED:email]');
    expect(Object.isFrozen(result.evaluatedEvidence)).toBe(true);
  });

  it('judges nothing and stores no evidence when the snapshot cannot be redacted', async () => {
    const { provider, prompts } = recordingProvider();
    // A clock that only runs away once both answers are in: the answers are
    // asked normally, and the redaction deadline is then missed on the snapshot
    // the judges would have read.
    let answersSent = 0;
    let tick = 0;
    const clocked: AiProvider = {
      config: provider.config,
      send: async (request, promptText) => {
        const response = await provider.send(request, promptText);
        answersSent += 1;
        return response;
      },
    };

    const result = await runGeoModule(moduleInput(), {
      provider: clocked,
      quota: AiQuotaTracker.withLimit(10),
      redaction: { now: () => (answersSent < 2 ? 0 : (tick += 10_000)) },
    });

    expect(result.responses).toHaveLength(2);
    // Nothing about the site went out, and no verdict came back on evidence
    // that was never sanitised.
    expect(
      prompts().filter((call) => call.request.promptVersion === GEO_EVALUATION_PROMPT_VERSION),
    ).toEqual([]);
    expect(result.evaluatedEvidence).toBeNull();
    expect([...result.answerEvaluations.values()].map((value) => value.reason)).toEqual([
      'RedactionBlocked',
      'RedactionBlocked',
    ]);
    expect(result.quota.spent).toBe(2);
  });

  it('refuses every evaluation without a processing record, exactly as the answers are', async () => {
    const { provider } = recordingProvider();
    const send = vi.spyOn(provider, 'send');

    const result = await runGeoModule(moduleInput({ consent: null }), {
      provider,
      quota: AiQuotaTracker.withLimit(10),
    });

    expect(send).not.toHaveBeenCalled();
    expect(result.status).toBe('Unavailable');
    expect(result.answerEvaluations.size).toBe(0);
  });
});
