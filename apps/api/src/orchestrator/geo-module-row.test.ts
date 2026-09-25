// AI SEO / GEO пишет наблюдения, а не оценку. Тесты фиксируют главное:
// успешный ответ провайдера сам по себе ничего не доказывает про видимость,
// поэтому строка модуля не несёт score ни в одной ветке, а счётчики упоминаний
// считаются по реально наблюдённым исходам и раздельно для brand-awareness и
// нейтрального discovery.

import { describe, expect, it } from 'vitest';
import type {
  AiRequest,
  GeoAnswerEvaluation,
  GeoEvidenceSnapshot,
  GeoModuleResult,
  MentionSignal,
} from '@fluxradar/ai';

import { GEO_SCORING_REASON, geoModuleRow } from './geo-module-row.ts';
import type { GeoQuestionGenerationResult } from './geo.ts';

const AI_CRAWLER_READINESS = {
  automation: 'public-http-dom',
  providerTokenRequired: false,
  robots: { present: true, aiCrawlersBlocked: [] },
  pages: { checked: 3, withMainContent: 3 },
  limitations: ['no rendering'],
} as unknown as Parameters<typeof geoModuleRow>[2];

function request(sequence: number, purpose: 'awareness' | 'discovery'): AiRequest {
  return {
    scanId: 'scan-1',
    provider: 'anthropic',
    promptVersion: `geo-questions-v4-${purpose}`,
    sequence,
    question: `question ${sequence}`,
    brandFacts: [],
    pageTitles: [],
    systemInstructions: 'answer factually',
  };
}

function answered(sequence: number, purpose: 'awareness' | 'discovery') {
  return {
    kind: 'response' as const,
    request: request(sequence, purpose),
    aiRequestKey: `key-${sequence}`,
    promptText: 'prompt',
    inputTruncated: false,
    redaction: {} as never,
    response: {
      provider: 'anthropic' as const,
      apiVersion: '2023-06-01',
      modelId: 'claude-sonnet-5',
      requestId: `req-${sequence}`,
      requestIdSource: 'provider' as const,
      createdAt: '2026-09-22T10:00:00.000Z',
      rawText: 'answer',
      citations: [],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      usageSource: 'provider' as const,
      finishReason: 'stop' as const,
    },
  };
}

function refused(sequence: number, purpose: 'awareness' | 'discovery') {
  return {
    kind: 'unavailable' as const,
    request: request(sequence, purpose),
    reason: 'ProviderUnavailable' as const,
    detail: 'provider is down',
  };
}

/**
 * Сигналы упоминаний на ответ, как их выдаёт `geoMentionSignals`.
 *
 * Вопрос, который сам назвал бренд или домен, даёт `named-in-question`:
 * измерения не было, и ни в числитель, ни в знаменатель такой ответ не идёт.
 */
function mentions(
  entries: Readonly<Record<string, readonly [MentionSignal, MentionSignal]>>,
): GeoModuleResult['mentions'] {
  return new Map(
    Object.entries(entries).map(([aiRequestKey, [brand, domain]]) => [
      aiRequestKey,
      { brand, domain },
    ]),
  );
}

/** No question of that kind was asked, or none of them was answered. */
const NOTHING_OBSERVED = {
  asked: 0,
  answered: 0,
  evaluated: 0,
  brandMeasured: 0,
  domainMeasured: 0,
  brandMentioned: 0,
  domainMentioned: 0,
} as const;

const NO_OBSERVATIONS = {
  asked: 0,
  answered: 0,
  evaluated: 0,
  brandMeasured: 0,
  domainMeasured: 0,
  brandMentioned: 0,
  domainMentioned: 0,
} as const;

function geoResult(overrides: Partial<GeoModuleResult> = {}): GeoModuleResult {
  const outcomes = overrides.outcomes ?? [];
  return {
    module: 'AI SEO / GEO',
    status: 'Completed',
    statusReason: null,
    outcomes,
    responses: outcomes.filter((outcome) => outcome.kind === 'response'),
    evaluations: [],
    findings: [],
    mentions: mentions({}),
    // No evidence snapshot reached the module, so no answer was judged.
    answerEvaluations: new Map(),
    evaluatedEvidence: null,
    evaluationOutcomes: [],
    quota: undefined as never,
    // Непрерванный прогон задал ровно те вопросы, что были в библиотеке.
    requested: outcomes.length,
    interrupted: false,
    ...overrides,
  } as GeoModuleResult;
}

function generationResult(
  overrides: Partial<GeoQuestionGenerationResult> = {},
): GeoQuestionGenerationResult {
  return {
    status: 'Completed',
    statusReason: null,
    applicableChecks: 1,
    completedApplicableChecks: 1,
    questions: ['who offers this locally?'],
    outcome: null,
    quota: undefined as never,
    ...overrides,
  };
}

function visibilityOf(row: ReturnType<typeof geoModuleRow>): Record<string, never> {
  const metadata = JSON.parse(row.metadataJson ?? '{}') as {
    providerVisibility: Record<string, never>;
  };
  return metadata.providerVisibility;
}

/** The two sentences the report shows about how the row was produced. */
function wordingOf(row: ReturnType<typeof geoModuleRow>): {
  readonly method: string;
  readonly interpretation: string;
} {
  const metadata = JSON.parse(row.metadataJson ?? '{}') as {
    providerVisibility: { method: string; interpretation: string };
  };
  const { method, interpretation } = metadata.providerVisibility;
  return { method, interpretation };
}

/** A snapshot with one profile source — enough to be the evidence a verdict cites. */
const EVIDENCE: GeoEvidenceSnapshot = {
  siteDomain: 'smile.example',
  sources: [
    {
      id: 'profile-1',
      kind: 'profile',
      label: 'name',
      url: null,
      excerpt: 'Smile Clinic',
      provenance: 'a field the site owner typed into their profile',
    },
  ],
  limits: ['A profile field confirms identity only.'],
  sufficiency: 'profile-only',
};

function verdict(
  parentAiRequestKey: string,
  status: 'Completed' | 'Unavailable',
): GeoAnswerEvaluation {
  const completed = status === 'Completed';
  return {
    parentAiRequestKey,
    purpose: 'closed-book',
    status,
    reason: completed ? null : 'ScanCancelled',
    detail: null,
    payload: null,
    aiRequestKey: completed ? `judge-${parentAiRequestKey}` : null,
    provider: completed ? 'anthropic' : null,
    modelId: completed ? 'claude-sonnet-5' : null,
    promptVersion: 'geo-answer-evaluation-v1',
    usage: null,
  };
}

function verdicts(
  entries: Readonly<Record<string, 'Completed' | 'Unavailable'>>,
): GeoModuleResult['answerEvaluations'] {
  return new Map(
    Object.entries(entries).map(([parentAiRequestKey, status]) => [
      parentAiRequestKey,
      verdict(parentAiRequestKey, status),
    ]),
  );
}

describe('AI SEO / GEO module row', () => {
  it('не выставляет score, даже когда все запросы ответили', () => {
    const row = geoModuleRow(
      geoResult({ outcomes: [answered(1, 'awareness'), answered(2, 'discovery')] }),
      generationResult(),
      AI_CRAWLER_READINESS,
    );
    expect(row.runtimeStatus).toBe('Completed');
    // Ответ провайдера — не доказательство видимости: выдуманная сотня здесь
    // давала Basic 40% общего балла ни за что.
    expect(row.score).toBeNull();
    expect(row.usableOutput).toBe(true);
    const metadata = JSON.parse(row.metadataJson ?? '{}') as { scoring: string };
    expect(metadata.scoring).toBe(GEO_SCORING_REASON);
  });

  it('ответы без бренда и домена не завышают наблюдения', () => {
    const row = geoModuleRow(
      geoResult({
        outcomes: [answered(1, 'awareness'), answered(2, 'discovery')],
        mentions: mentions({
          // Awareness-вопрос называет бренд сам, поэтому измерим только домен.
          'key-1': ['named-in-question', 'not-mentioned'],
          'key-2': ['not-mentioned', 'not-mentioned'],
        }),
      }),
      generationResult(),
      AI_CRAWLER_READINESS,
    );
    expect(row.score).toBeNull();
    expect(visibilityOf(row).observations).toEqual({
      // No question of this scan was asked closed-book; the bucket still exists
      // so the shape is the same for every scan.
      'closed-book': NO_OBSERVATIONS,
      awareness: {
        asked: 1,
        answered: 1,
        evaluated: 1,
        brandMeasured: 0,
        domainMeasured: 1,
        brandMentioned: 0,
        domainMentioned: 0,
      },
      discovery: {
        asked: 1,
        answered: 1,
        evaluated: 1,
        brandMeasured: 1,
        domainMeasured: 1,
        brandMentioned: 0,
        domainMentioned: 0,
      },
    });
  });

  it('названное в вопросе не считается упоминанием', () => {
    // Раньше вопрос, назвавший бренд и домен, findings не порождал — и обе
    // «зелёные» метки отчёт писал себе сам. Такой ответ теперь не измерен.
    const row = geoModuleRow(
      geoResult({
        outcomes: [answered(1, 'awareness')],
        mentions: mentions({ 'key-1': ['named-in-question', 'named-in-question'] }),
      }),
      generationResult(),
      AI_CRAWLER_READINESS,
    );
    expect(visibilityOf(row).observations).toEqual({
      // No question of this scan was asked closed-book; the bucket still exists
      // so the shape is the same for every scan.
      'closed-book': NO_OBSERVATIONS,
      awareness: {
        asked: 1,
        answered: 1,
        evaluated: 0,
        brandMeasured: 0,
        domainMeasured: 0,
        brandMentioned: 0,
        domainMentioned: 0,
      },
      discovery: {
        asked: 0,
        answered: 0,
        evaluated: 0,
        brandMeasured: 0,
        domainMeasured: 0,
        brandMentioned: 0,
        domainMentioned: 0,
      },
    });
  });

  it('смешанный исход считает упоминания раздельно по типу вопроса', () => {
    const row = geoModuleRow(
      geoResult({
        outcomes: [answered(1, 'awareness'), answered(2, 'discovery'), answered(3, 'discovery')],
        mentions: mentions({
          'key-1': ['named-in-question', 'mentioned'],
          'key-2': ['mentioned', 'not-mentioned'],
          'key-3': ['not-mentioned', 'not-mentioned'],
        }),
      }),
      generationResult(),
      AI_CRAWLER_READINESS,
    );
    expect(visibilityOf(row).observations).toEqual({
      // No question of this scan was asked closed-book; the bucket still exists
      // so the shape is the same for every scan.
      'closed-book': NO_OBSERVATIONS,
      awareness: {
        asked: 1,
        answered: 1,
        evaluated: 1,
        brandMeasured: 0,
        domainMeasured: 1,
        brandMentioned: 0,
        domainMentioned: 1,
      },
      discovery: {
        asked: 2,
        answered: 2,
        evaluated: 2,
        brandMeasured: 2,
        domainMeasured: 2,
        brandMentioned: 1,
        domainMentioned: 0,
      },
    });
  });

  it('недоступный провайдер: Unavailable без score и без usable output', () => {
    const row = geoModuleRow(
      geoResult({
        status: 'Unavailable',
        statusReason: 'ProviderUnavailable',
        outcomes: [refused(1, 'awareness'), refused(2, 'discovery')],
        evaluations: [],
      }),
      generationResult({
        status: 'Unavailable',
        statusReason: 'ProviderUnavailable',
        completedApplicableChecks: 0,
        questions: [],
      }),
      AI_CRAWLER_READINESS,
    );
    expect(row.runtimeStatus).toBe('Unavailable');
    expect(row.score).toBeNull();
    expect(row.usableOutput).toBe(false);
    expect(row.coverage).toBe(0);
    expect(visibilityOf(row).observations).toEqual({
      // No question of this scan was asked closed-book; the bucket still exists
      // so the shape is the same for every scan.
      'closed-book': NO_OBSERVATIONS,
      awareness: { ...NOTHING_OBSERVED, asked: 1 },
      discovery: { ...NOTHING_OBSERVED, asked: 1 },
    });
  });

  it('частичное покрытие остаётся Partial и по-прежнему без score', () => {
    const row = geoModuleRow(
      geoResult({
        status: 'Partial',
        statusReason: '1 of 2 AI requests unavailable (QuotaExceeded)',
        outcomes: [answered(1, 'awareness'), refused(2, 'discovery')],
      }),
      generationResult(),
      AI_CRAWLER_READINESS,
    );
    expect(row.runtimeStatus).toBe('Partial');
    expect(row.score).toBeNull();
    expect(row.usableOutput).toBe(true);
    expect(row.statusReason).toContain('QuotaExceeded');
  });

  it('прерванный отменой прогон сохраняет заданную часть как Partial', () => {
    // §575: незавершённые проверки баллов не получают, а завершённая часть
    // сохраняется. Знаменатель — вся библиотека вопросов, иначе «2 из 5» в
    // отчёте выглядели бы полным покрытием.
    const row = geoModuleRow(
      geoResult({
        status: 'Partial',
        statusReason: 'ScanCancelled: 2 of 5 questions answered',
        outcomes: [answered(1, 'awareness'), answered(2, 'awareness')],
        requested: 5,
        interrupted: true,
      }),
      generationResult(),
      AI_CRAWLER_READINESS,
    );
    expect(row.runtimeStatus).toBe('Partial');
    expect(row.applicableChecks).toBe(6);
    expect(row.completedApplicableChecks).toBe(3);
    expect(row.coverage).toBe(0.5);
    expect(row.score).toBeNull();
    // Ответы получены и оплачены — это пригодный материал отчёта.
    expect(row.usableOutput).toBe(true);
    expect(row.statusReason).toContain('ScanCancelled');
  });

  it('отмена до первого ответа: Unavailable, но генерация вопросов зачтена', () => {
    const row = geoModuleRow(
      geoResult({
        status: 'Unavailable',
        statusReason: 'ScanCancelled',
        outcomes: [],
        requested: 5,
        interrupted: true,
        evaluations: [],
      }),
      generationResult(),
      AI_CRAWLER_READINESS,
    );
    expect(row.usableOutput).toBe(false);
    expect(row.score).toBeNull();
    expect(row.completedApplicableChecks).toBe(1);
    expect(row.applicableChecks).toBe(6);
    expect(row.statusReason).toContain('ScanCancelled');
  });

  it('без контекста профиля discovery-вопросы не генерируются, score всё равно null', () => {
    const row = geoModuleRow(
      geoResult({
        outcomes: [answered(1, 'awareness')],
        mentions: mentions({ 'key-1': ['named-in-question', 'mentioned'] }),
      }),
      generationResult({
        status: 'NotApplicable',
        statusReason: 'ProfileContextMissing',
        applicableChecks: 0,
        completedApplicableChecks: 0,
        questions: [],
      }),
      AI_CRAWLER_READINESS,
    );
    expect(row.runtimeStatus).toBe('Completed');
    expect(row.score).toBeNull();
    expect(visibilityOf(row).observations).toEqual({
      // No question of this scan was asked closed-book; the bucket still exists
      // so the shape is the same for every scan.
      'closed-book': NO_OBSERVATIONS,
      awareness: {
        asked: 1,
        answered: 1,
        evaluated: 1,
        brandMeasured: 0,
        domainMeasured: 1,
        brandMentioned: 0,
        domainMentioned: 1,
      },
      discovery: NOTHING_OBSERVED,
    });
  });

  // A scan bought under an older accepted notice still asks its questions, and
  // no evidence of the site is ever sent for judging them. A row that describes
  // the evaluation anyway sells a check that never ran for that customer.
  it('says no answer was evaluated when the scan sent no evidence', () => {
    const row = geoModuleRow(
      geoResult({ outcomes: [answered(1, 'awareness'), answered(2, 'discovery')] }),
      generationResult(),
      AI_CRAWLER_READINESS,
    );
    const { method, interpretation } = wordingOf(row);
    expect(method).toContain('no answer was evaluated');
    expect(method).not.toContain('evaluated separately');
    expect(interpretation).not.toContain('An evaluation states');
    // The metadata DTO keeps its shape: absent evidence is null, not missing.
    expect(visibilityOf(row).evidence).toBeNull();
  });

  it('counts the answers actually evaluated when evidence was sent', () => {
    const row = geoModuleRow(
      geoResult({
        outcomes: [answered(1, 'awareness'), answered(2, 'discovery')],
        answerEvaluations: verdicts({ 'key-1': 'Completed', 'key-2': 'Unavailable' }),
      }),
      generationResult(),
      AI_CRAWLER_READINESS,
      EVIDENCE,
    );
    const { method, interpretation } = wordingOf(row);
    expect(method).toContain(
      '1 of 2 answers evaluated separately against this scan’s own evidence',
    );
    expect(interpretation).toContain(
      'An evaluation states only what this scan’s evidence supports.',
    );
    expect(visibilityOf(row).evidence).toMatchObject({ sufficiency: 'profile-only' });
  });

  // Cancellation leaves the snapshot built and every verdict missing: the row
  // must not read as if all of them completed.
  it('does not claim completed evaluations when every judge was cancelled', () => {
    const row = geoModuleRow(
      geoResult({
        status: 'Partial',
        statusReason: 'ScanCancelled',
        outcomes: [answered(1, 'awareness'), answered(2, 'discovery')],
        answerEvaluations: verdicts({ 'key-1': 'Unavailable', 'key-2': 'Unavailable' }),
        interrupted: true,
      }),
      generationResult(),
      AI_CRAWLER_READINESS,
      EVIDENCE,
    );
    const { method, interpretation } = wordingOf(row);
    expect(method).toContain('none of the 2 evaluations');
    expect(method).not.toContain('evaluated separately');
    expect(interpretation).not.toContain('An evaluation states');
    expect(row.statusReason).toContain('AnswerEvaluationUnavailable');
  });

  // Evidence was built, the scan stopped before the first judge request: there
  // is nothing to report as evaluated, and nothing to report as failed either.
  it('says no answer reached evaluation when the judge never ran', () => {
    const row = geoModuleRow(
      geoResult({ outcomes: [answered(1, 'awareness')], interrupted: true }),
      generationResult(),
      AI_CRAWLER_READINESS,
      EVIDENCE,
    );
    const { method, interpretation } = wordingOf(row);
    expect(method).toContain('no answer reached evaluation');
    expect(method).not.toContain('evaluated separately');
    expect(interpretation).not.toContain('An evaluation states');
  });
});
