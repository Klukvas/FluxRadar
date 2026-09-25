// The GEO module's evaluation pass: one judge per answer, and no answer in
// another answer's judging context.

import { describe, expect, it, vi } from 'vitest';

import { GEO_EVALUATION_PROMPT_VERSION } from './geo-evaluation.js';
import { CURRENT_AI_PROCESSING_NOTICE_VERSION } from './consent.js';
import { buildGeoEvidenceSnapshot } from './geo-evidence.js';
import type { GeoEvidenceSnapshot } from './geo-evidence.js';
import { runGeoModule } from './geo-module.js';
import type { GeoModuleInput } from './geo-module.js';
import { MockAiProvider, mockRoutingProvider } from './mock-provider.js';
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

interface RecordedCall {
  readonly request: AiRequest;
  readonly promptText: string;
  /** What the module handed the adapter — undefined means the cancel never reached it. */
  readonly signal: AbortSignal | undefined;
}

function recordingProvider(fixtures: readonly MockAiFixture[] = FIXTURES): {
  provider: AiProvider;
  prompts: () => readonly RecordedCall[];
} {
  const inner = new MockAiProvider(fixtures, { config: ANTHROPIC_CONFIG });
  const seen: RecordedCall[] = [];
  return {
    provider: {
      config: inner.config,
      send: async (request, promptText, signal) => {
        seen.push({ request, promptText, signal });
        return inner.send(request, promptText, signal);
      },
    },
    prompts: () => seen,
  };
}

function isJudgeCall(call: RecordedCall): boolean {
  return call.request.promptVersion === GEO_EVALUATION_PROMPT_VERSION;
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

  // Two providers get the same question, and the question numbering restarts at
  // 1 for each of them, so two identical answers produce two judge requests
  // whose rubric, wording, sequence and judging provider are all the same. Keyed
  // by the prompt alone they were ONE key: one quota reservation for two paid
  // calls, and one ai_response row upserted twice.
  it('gives two providers that answered identically two distinct judge keys', async () => {
    const bothProviders = (['anthropic', 'openai'] as const).map((provider) => ({
      ...question(0),
      provider,
    }));
    const input = moduleInput({
      requests: bothProviders,
      consent: {
        scanId: SCAN_ID,
        providers: ['anthropic', 'openai'],
        noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
      },
    });

    const result = await runGeoModule(input, {
      provider: mockRoutingProvider(FIXTURES, ['anthropic', 'openai']),
      quota: AiQuotaTracker.withLimit(10),
    });

    // The premise: the two answers really are the same text under the same
    // sequence, which is what used to collapse the two verdicts into one.
    expect(result.responses.map((answer) => answer.response.rawText)).toEqual([
      FIRST_ANSWER,
      FIRST_ANSWER,
    ]);
    expect(result.responses.map((answer) => answer.request.sequence)).toEqual([1, 1]);

    const judgeKeys = result.responses.map(
      (answer) => result.answerEvaluations.get(answer.aiRequestKey)?.aiRequestKey,
    );
    expect(judgeKeys.every((key) => typeof key === 'string')).toBe(true);
    expect(new Set(judgeKeys).size).toBe(2);
    // Two ledger entries, because two provider exchanges were paid for. One
    // shared key would mean one ai_response row upserted over itself.
    const ledgerKeys = result.evaluationOutcomes.flatMap((outcome) =>
      outcome.kind === 'response' ? [outcome.aiRequestKey] : [],
    );
    expect(ledgerKeys).toHaveLength(2);
    expect(new Set(ledgerKeys).size).toBe(2);
    // And two units of quota, because a shared key made the second judge look
    // like a retry of the first and cost nothing.
    expect(result.quota.spent).toBe(4);
  });

  it('gives the same answer the same judge key when the scan is run again', async () => {
    const bothProviders = (['anthropic', 'openai'] as const).map((provider) => ({
      ...question(0),
      provider,
    }));
    const input = moduleInput({
      requests: bothProviders,
      consent: {
        scanId: SCAN_ID,
        providers: ['anthropic', 'openai'],
        noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
      },
    });
    const judgeKeysOf = async (): Promise<readonly (string | null)[]> => {
      const result = await runGeoModule(input, {
        provider: mockRoutingProvider(FIXTURES, ['anthropic', 'openai']),
        quota: AiQuotaTracker.withLimit(10),
      });
      return result.responses.map(
        (answer) => result.answerEvaluations.get(answer.aiRequestKey)?.aiRequestKey ?? null,
      );
    };

    // A retry must not pay twice for the same verdict: the key is derived from
    // the answer it judges, not from the order the judges happened to run in.
    expect(await judgeKeysOf()).toEqual(await judgeKeysOf());
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

// A cancelled scan stops asking. That has to hold for the judges too: they are
// paid provider calls made after every answer is already in hand, so a pass
// that ignores the signal spends the customer's quota on verdicts for a scan
// nobody is waiting for — and then reports a coverage that hides the gap.
describe('cancelling the evaluation pass', () => {
  const THIRD_ANSWER = 'Smile Clinic sees emergency patients in Kyiv.';
  const THIRD_QUESTION: AiRequest = {
    ...question(1),
    sequence: 3,
    question: 'ASK-THIRD about emergency care',
  };
  const THREE_ANSWER_FIXTURES: readonly MockAiFixture[] = [
    {
      questionIncludes: 'sees emergency patients',
      response: { status: 'completed', output_text: unverifiedVerdict('sees emergency patients') },
    },
    ...FIXTURES,
    { questionIncludes: 'ASK-THIRD', response: { status: 'completed', output_text: THIRD_ANSWER } },
  ];

  it('asks no judge at all when the cancel lands before the pass', async () => {
    const controller = new AbortController();
    const { provider, prompts } = recordingProvider();
    const cancelled: AiProvider = {
      config: provider.config,
      send: async (request, promptText, signal) => {
        const response = await provider.send(request, promptText, signal);
        // Both answers are in and paid for; the cancel arrives before the first
        // judge, which is the window this test is about.
        if (prompts().length === 2) controller.abort();
        return response;
      },
    };

    const result = await runGeoModule(moduleInput(), {
      provider: cancelled,
      quota: AiQuotaTracker.withLimit(10),
      signal: controller.signal,
    });

    expect(prompts().filter(isJudgeCall)).toEqual([]);
    expect(result.quota.spent).toBe(2);
    expect(result.quota.outstanding).toBe(0);
    // The answers survive: they were paid for, and each carries the deletion
    // reference that is the only record the provider ever held them.
    expect(result.responses.map((answer) => answer.response.rawText)).toEqual([
      FIRST_ANSWER,
      SECOND_ANSWER,
    ]);
    expect(result.interrupted).toBe(true);
    // Every answer still has an entry, so the checks that did not run stay in
    // the module row's denominator instead of vanishing from it.
    expect(result.answerEvaluations.size).toBe(2);
    expect([...result.answerEvaluations.values()].map((evaluation) => evaluation.reason)).toEqual([
      'ScanCancelled',
      'ScanCancelled',
    ]);
    expect(result.evaluationOutcomes).toEqual([]);
    // Nothing was judged, so no snapshot was read — storing one would claim a
    // comparison that never happened.
    expect(result.evaluatedEvidence).toBeNull();
  });

  it('keeps the verdicts already paid for when a judge is cancelled mid-flight', async () => {
    const controller = new AbortController();
    const { provider, prompts } = recordingProvider(THREE_ANSWER_FIXTURES);
    const cancelled: AiProvider = {
      config: provider.config,
      send: async (request, promptText, signal) => {
        // The second judge is the one the cancel catches in flight: the adapter
        // sees an aborted signal and refuses, exactly as a real one would.
        if (
          request.promptVersion === GEO_EVALUATION_PROMPT_VERSION &&
          prompts().filter(isJudgeCall).length === 1
        ) {
          controller.abort();
        }
        return provider.send(request, promptText, signal);
      },
    };

    const result = await runGeoModule(
      moduleInput({ requests: [question(0), question(1), THIRD_QUESTION] }),
      { provider: cancelled, quota: AiQuotaTracker.withLimit(10), signal: controller.signal },
    );

    const judgeCalls = prompts().filter(isJudgeCall);
    // One verdict, one cancelled attempt, and no third call: the pass stops
    // rather than working its way through the rest of the answers.
    expect(judgeCalls).toHaveLength(2);
    // The cancel reached the adapter — without that, a judge in flight runs to
    // completion and is billed after the scan was called off.
    expect(judgeCalls.map((call) => call.signal)).toEqual([controller.signal, controller.signal]);

    const verdicts = result.responses.map((answer) =>
      result.answerEvaluations.get(answer.aiRequestKey),
    );
    expect(verdicts.map((evaluation) => evaluation?.status)).toEqual([
      'Completed',
      'Unavailable',
      'Unavailable',
    ]);
    // A cancel is not an unavailable provider: calling it one would invite the
    // next attempt to ask again and pay again.
    expect(verdicts.map((evaluation) => evaluation?.reason)).toEqual([
      null,
      'ScanCancelled',
      'ScanCancelled',
    ]);
    // The completed exchange keeps its ledger entry; the cancelled one has none
    // and released its reservation.
    expect(result.evaluationOutcomes).toHaveLength(1);
    expect(result.quota.spent).toBe(4);
    expect(result.quota.outstanding).toBe(0);
    expect(result.responses).toHaveLength(3);
    expect(result.interrupted).toBe(true);
  });
});
