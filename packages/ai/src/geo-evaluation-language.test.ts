import { describe, expect, it } from 'vitest';

import { CURRENT_AI_PROCESSING_NOTICE_VERSION } from './consent.js';
import {
  buildGeoEvaluationRequest,
  evaluateGeoAnswer,
  GEO_EVALUATION_CAPS,
  GEO_EVALUATION_PROMPT_VERSION,
  GEO_EVALUATION_SYSTEM_INSTRUCTIONS,
} from './geo-evaluation.js';
import {
  GEO_EVALUATION_UKRAINIAN_INSTRUCTION,
  GEO_EVALUATION_UKRAINIAN_MAX_OUTPUT_TOKENS,
} from './geo-evaluation-language.js';
import type { GeoAnswerLanguage } from './geo-evaluation-language.js';
import { buildGeoEvidenceSnapshot } from './geo-evidence.js';
import { MockAiProvider } from './mock-provider.js';
import { AiQuotaTracker } from './quota.js';

// The judge in the answer's language (W1, D-237): a Ukrainian system line and a larger
// output budget for `uk`; English and paid requests byte-identical to before.

const SCAN_ID = 'scan-eval-uk';
const ANSWER_UK =
  'Smile Clinic — стоматологічна клініка в Києві, яка встановлює імпланти для всієї сімʼї.';

const EVIDENCE_UK = buildGeoEvidenceSnapshot({
  siteDomain: 'smile.example',
  brandIsHostname: false,
  profile: { brand: 'Smile Clinic', businessDescription: 'Стоматологічна клініка в Києві' },
  pages: [
    {
      url: 'https://smile.example/',
      title: 'Smile Clinic',
      visibleText: 'Ми встановлюємо імпланти та приймаємо пацієнтів у Києві — для всієї сімʼї.',
    },
  ],
});

function input(language?: GeoAnswerLanguage) {
  return {
    scanId: SCAN_ID,
    parentAiRequestKey: 'ai:scan-eval-uk:anthropic:abcd:1',
    purpose: 'closed-book' as const,
    question: 'Що вам відомо про Smile Clinic?',
    answer: ANSWER_UK,
    evidence: EVIDENCE_UK,
    index: 1,
    consent: {
      scanId: SCAN_ID,
      providers: ['anthropic' as const],
      noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
    },
    ...(language === undefined ? {} : { language }),
  };
}

function judge(outputText: string): MockAiProvider {
  return new MockAiProvider(
    [
      {
        questionIncludes: '[answer-to-judge]',
        response: { status: 'completed', output_text: outputText },
      },
    ],
    {
      config: {
        provider: 'anthropic',
        apiVersion: '2023-06-01',
        modelId: 'claude-sonnet-5',
        timeoutMs: 1_000,
        maxRetries: 1,
      },
    },
  );
}

const UKRAINIAN_CLAIMS = {
  answerDescribesSubject: true,
  claims: [
    {
      claim: 'Бізнес — стоматологічна клініка в Києві.',
      verdict: 'matched',
      answerQuote: 'стоматологічна клініка в Києві',
      sourceId: 'page-1',
      sourceQuote: 'приймаємо пацієнтів у Києві',
    },
    {
      // Both quotes re-type ʼ as ': still verbatim for the matcher.
      claim: 'Клініка встановлює імпланти для всієї сімʼї.',
      verdict: 'matched',
      answerQuote: "встановлює імпланти для всієї сім'ї",
      sourceId: 'page-1',
      sourceQuote: "для всієї сім'ї",
    },
  ],
  overall: 'matches-evidence',
  tone: null,
};

describe('buildGeoEvaluationRequest language', () => {
  it('is byte-identical for en and for no language (paid)', () => {
    const base = { ...input(), judgeTone: true };
    const withoutLanguage = buildGeoEvaluationRequest(base);
    const english = buildGeoEvaluationRequest({ ...base, language: 'en' });
    expect(JSON.stringify(english)).toBe(JSON.stringify(withoutLanguage));
    expect(withoutLanguage.systemInstructions).toBe(GEO_EVALUATION_SYSTEM_INSTRUCTIONS);
    expect(withoutLanguage.caps).toBe(GEO_EVALUATION_CAPS);
    expect(JSON.stringify(withoutLanguage)).not.toContain('Ukrainian');
  });

  it('adds the Ukrainian claim line to the system prompt only, for uk', () => {
    const base = { ...input(), judgeTone: true };
    const english = buildGeoEvaluationRequest(base);
    const ukrainian = buildGeoEvaluationRequest({ ...base, language: 'uk' });
    expect(ukrainian.systemInstructions).toBe(
      `${GEO_EVALUATION_SYSTEM_INSTRUCTIONS} ${GEO_EVALUATION_UKRAINIAN_INSTRUCTION}`,
    );
    expect(GEO_EVALUATION_UKRAINIAN_INSTRUCTION).toContain('Write each `claim` in Ukrainian.');
    expect(GEO_EVALUATION_UKRAINIAN_INSTRUCTION).toContain(
      '`answerQuote`, `sourceQuote` and the tone `quote` are copied verbatim',
    );
    expect(GEO_EVALUATION_UKRAINIAN_INSTRUCTION).toContain('never translated, never paraphrased');
    // The data part, the version and the schema are the English ones.
    expect(ukrainian.question).toBe(english.question);
    expect(ukrainian.promptVersion).toBe(GEO_EVALUATION_PROMPT_VERSION);
    expect(ukrainian.responseSchema).toBe(english.responseSchema);
    expect(ukrainian.caps).toEqual({
      ...GEO_EVALUATION_CAPS,
      maxOutputTokens: GEO_EVALUATION_UKRAINIAN_MAX_OUTPUT_TOKENS,
    });
    expect(GEO_EVALUATION_CAPS.maxOutputTokens).toBe(2_000);
  });
});

describe('evaluateGeoAnswer in Ukrainian', () => {
  it('accepts Ukrainian claims whose quotes re-type the apostrophe', async () => {
    const { evaluation } = await evaluateGeoAnswer(input('uk'), {
      provider: judge(JSON.stringify(UKRAINIAN_CLAIMS)),
      quota: AiQuotaTracker.forPlan('Free'),
    });
    expect(evaluation.status).toBe('Completed');
    expect(evaluation.payload?.claims.map((claim) => claim.claim)).toEqual([
      'Бізнес — стоматологічна клініка в Києві.',
      'Клініка встановлює імпланти для всієї сімʼї.',
    ]);
    // Tone stays judged exactly when the English request would judge it.
    expect(evaluation.promptVersion).toBe(GEO_EVALUATION_PROMPT_VERSION);
  });

  it('still voids the evaluation when a quote is not in the answer', async () => {
    const invented = {
      ...UKRAINIAN_CLAIMS,
      claims: [{ ...UKRAINIAN_CLAIMS.claims[0], answerQuote: 'клініка у Львові' }],
    };
    const { evaluation } = await evaluateGeoAnswer(input('uk'), {
      provider: judge(JSON.stringify(invented)),
      quota: AiQuotaTracker.forPlan('Free'),
    });
    expect(evaluation.status).not.toBe('Completed');
  });

  it('fits a long Ukrainian verdict that the English cap would cut off', async () => {
    // ~5,000 characters, past the English cap (2,000 tokens at the mock's two
    // characters per token) and inside the Ukrainian one. The bulk is leading
    // whitespace so that a cut can only land inside the JSON itself.
    const long = `${' '.repeat(4_600)}${JSON.stringify(UKRAINIAN_CLAIMS)}`;
    expect(long.length).toBeGreaterThan(4_000);
    expect(long.length).toBeLessThan(GEO_EVALUATION_UKRAINIAN_MAX_OUTPUT_TOKENS * 2);
    const run = async (language: GeoAnswerLanguage) =>
      (
        await evaluateGeoAnswer(input(language), {
          provider: judge(long),
          quota: AiQuotaTracker.forPlan('Free'),
        })
      ).evaluation.status;
    expect(await run('uk')).toBe('Completed');
    expect(await run('en')).not.toBe('Completed');
  });
});
