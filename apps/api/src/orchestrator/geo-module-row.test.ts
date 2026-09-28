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

/** The fixture site every case here is a scan of. */
const SITE_DOMAIN = 'acme-clinic.example';
const SITE_BRAND = 'Acme Clinic';

/**
 * The builder under test, with this fixture's site identity filled in.
 *
 * `geoModuleRow` requires the domain and the brand — an empty default there
 * once disabled the own-domain exclusion with no call site to reveal it — so
 * the defaults live here, in the fixture, where they are visibly this site's.
 */
function buildRow(
  geo: Parameters<typeof geoModuleRow>[0],
  generation: Parameters<typeof geoModuleRow>[1],
  readiness: Parameters<typeof geoModuleRow>[2],
  evidence: Parameters<typeof geoModuleRow>[3] = null,
  siteDomain: string = SITE_DOMAIN,
  brand: string = SITE_BRAND,
): ReturnType<typeof geoModuleRow> {
  return geoModuleRow(geo, generation, readiness, evidence, siteDomain, brand);
}

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
    const row = buildRow(
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
    const row = buildRow(
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
    const row = buildRow(
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
    const row = buildRow(
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
    const row = buildRow(
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
    const row = buildRow(
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
    const row = buildRow(
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
    const row = buildRow(
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
    const row = buildRow(
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
    const row = buildRow(
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
    const row = buildRow(
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
    const row = buildRow(
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
    const row = buildRow(
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

describe('T6 — visibility summary in metadata', () => {
  /** Same shape as `answered`, but with a custom purpose/provider/answer text. */
  function answeredWith(options: {
    sequence: number;
    provider?: 'anthropic' | 'openai';
    promptVersion: string;
    question?: string;
    rawText: string;
    citations?: readonly string[];
  }) {
    const provider = options.provider ?? 'anthropic';
    return {
      kind: 'response' as const,
      request: {
        scanId: 'scan-1',
        provider,
        promptVersion: options.promptVersion,
        sequence: options.sequence,
        question: options.question ?? `question ${options.sequence}`,
        brandFacts: [],
        pageTitles: [],
        systemInstructions: 'answer factually',
      },
      aiRequestKey: `key-${options.sequence}`,
      promptText: 'prompt',
      inputTruncated: false,
      redaction: {} as never,
      response: {
        provider,
        apiVersion: '2023-06-01',
        modelId: 'claude-sonnet-5',
        requestId: `req-${options.sequence}`,
        requestIdSource: 'provider' as const,
        createdAt: '2026-09-22T10:00:00.000Z',
        rawText: options.rawText,
        citations: options.citations ?? [],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        usageSource: 'provider' as const,
        finishReason: 'stop' as const,
      },
    };
  }

  function visibilitySummaryOf(row: ReturnType<typeof geoModuleRow>): {
    readonly minMeasuredForScore: number;
    readonly weightBrand: number;
    readonly weightDomain: number;
    readonly providers: readonly Record<string, unknown>[];
  } {
    const metadata = JSON.parse(row.metadataJson ?? '{}') as {
      providerVisibility: { visibilitySummary: ReturnType<typeof visibilitySummaryOf> };
    };
    return metadata.providerVisibility.visibilitySummary;
  }

  function requestsOf(row: ReturnType<typeof geoModuleRow>): readonly Record<string, unknown>[] {
    const metadata = JSON.parse(row.metadataJson ?? '{}') as {
      providerVisibility: { requests: readonly Record<string, unknown>[] };
    };
    return metadata.providerVisibility.requests;
  }

  it('stores the formula constants and one row per provider that answered', () => {
    const outcome = answeredWith({
      sequence: 1,
      promptVersion: 'geo-questions-v5-closed-book',
      rawText: 'Acme Clinic is a solid option — see https://acme-clinic.example/ for details.',
      citations: ['https://acme-clinic.example/'],
    });
    const row = buildRow(
      geoResult({
        outcomes: [outcome],
        mentions: mentions({ 'key-1': ['mentioned', 'mentioned'] }),
      }),
      generationResult(),
      AI_CRAWLER_READINESS,
      null,
      'acme-clinic.example',
      'Acme Clinic',
    );
    const summary = visibilitySummaryOf(row);
    expect(summary.minMeasuredForScore).toBe(3);
    expect(summary.weightBrand).toBe(0.6);
    expect(summary.weightDomain).toBe(0.4);
    expect(summary.providers).toEqual([
      expect.objectContaining({
        provider: 'anthropic',
        label: expect.any(String),
        questionsAnswered: 1,
        brandMentionedCount: 1,
        domainCitedCount: 1,
        // Fewer than 3 *measured* answers → counted, but no score.
        brandMeasuredCount: 1,
        domainMeasuredCount: 1,
        visibilityScore: null,
        scoreUnavailableReason: 'not-enough-measured',
      }),
    ]);
  });

  it('gives a real score once a provider has at least 3 answered questions', () => {
    const outcomes = [
      answeredWith({
        sequence: 1,
        promptVersion: 'geo-questions-v5-closed-book',
        rawText: 'Acme Clinic offers dental care — https://acme-clinic.example/.',
        citations: ['https://acme-clinic.example/'],
      }),
      answeredWith({
        sequence: 2,
        promptVersion: 'geo-questions-v5-closed-book',
        rawText: 'I have no information about this business.',
      }),
      answeredWith({
        sequence: 3,
        promptVersion: 'geo-questions-v5-discovery',
        rawText: 'Acme Clinic is one option, see https://acme-clinic.example/.',
        citations: ['https://acme-clinic.example/'],
      }),
    ];
    const row = buildRow(
      geoResult({
        outcomes,
        mentions: mentions({
          'key-1': ['mentioned', 'mentioned'],
          'key-2': ['not-mentioned', 'not-mentioned'],
          'key-3': ['mentioned', 'mentioned'],
        }),
      }),
      generationResult(),
      AI_CRAWLER_READINESS,
      null,
      'acme-clinic.example',
      'Acme Clinic',
    );
    const [provider] = visibilitySummaryOf(row).providers;
    expect(provider?.visibilityScore).toBe(Math.round(100 * (0.6 * (2 / 3) + 0.4 * (2 / 3))));
  });

  it('lists who got cited instead when our domain was not', () => {
    const outcome = answeredWith({
      sequence: 1,
      promptVersion: 'geo-questions-v5-closed-book',
      rawText: 'Popular vendors include Rival Dental.',
      citations: ['https://rival-dental.example/'],
    });
    const row = buildRow(
      geoResult({
        outcomes: [outcome],
        mentions: mentions({ 'key-1': ['not-mentioned', 'not-mentioned'] }),
      }),
      generationResult(),
      AI_CRAWLER_READINESS,
      null,
      'acme-clinic.example',
      'Acme Clinic',
    );
    const [provider] = visibilitySummaryOf(row).providers;
    expect(provider?.citedInstead).toEqual([{ hostname: 'rival-dental.example', answerCount: 1 }]);
  });

  // The builder used to default siteDomain and brand to '', which silently
  // disabled the own-domain exclusion: our own subdomains could be listed as
  // competitors in "cited instead". Both are required now, and an empty domain
  // yields no summary rather than one that cannot exclude anything.
  it('summarises nothing when the site domain is empty', () => {
    const row = buildRow(
      geoResult({
        outcomes: [
          answeredWith({
            sequence: 1,
            promptVersion: 'geo-questions-v5-discovery',
            rawText: 'Try these instead.',
            citations: ['https://docs.acme-clinic.example/', 'https://rival-dental.example/'],
          }),
        ],
        mentions: mentions({ 'key-1': ['not-mentioned', 'not-mentioned'] }),
      }),
      generationResult(),
      AI_CRAWLER_READINESS,
      null,
      '',
      '',
    );
    expect(visibilitySummaryOf(row).providers).toEqual([]);
    expect(requestsOf(row)[0]).not.toHaveProperty('mentionContext');
  });

  it('excludes our own subdomain from "cited instead" once the domain is known', () => {
    const row = buildRow(
      geoResult({
        outcomes: [
          answeredWith({
            sequence: 1,
            promptVersion: 'geo-questions-v5-discovery',
            rawText: 'Try these instead.',
            citations: ['https://docs.acme-clinic.example/', 'https://rival-dental.example/'],
          }),
        ],
        mentions: mentions({ 'key-1': ['not-mentioned', 'not-mentioned'] }),
      }),
      generationResult(),
      AI_CRAWLER_READINESS,
      null,
      'acme-clinic.example',
      'Acme Clinic',
    );
    const [provider] = visibilitySummaryOf(row).providers;
    expect(provider?.citedInstead).toEqual([{ hostname: 'rival-dental.example', answerCount: 1 }]);
  });

  it('attaches the mention-context sentence to the answer that mentioned the brand', () => {
    const outcome = answeredWith({
      sequence: 1,
      promptVersion: 'geo-questions-v5-closed-book',
      rawText: 'First a preamble. Acme Clinic is a solid choice for families. Then more text.',
    });
    const row = buildRow(
      geoResult({
        outcomes: [outcome],
        mentions: mentions({ 'key-1': ['mentioned', 'not-mentioned'] }),
      }),
      generationResult(),
      AI_CRAWLER_READINESS,
      null,
      'acme-clinic.example',
      'Acme Clinic',
    );
    const [request] = requestsOf(row);
    expect(request?.mentionContext).toBe('Acme Clinic is a solid choice for families.');
  });

  it('has no mentionContext field for an answer that did not mention the brand', () => {
    const outcome = answeredWith({
      sequence: 1,
      promptVersion: 'geo-questions-v5-closed-book',
      rawText: 'No relevant option found.',
    });
    const row = buildRow(
      geoResult({
        outcomes: [outcome],
        mentions: mentions({ 'key-1': ['not-mentioned', 'not-mentioned'] }),
      }),
      generationResult(),
      AI_CRAWLER_READINESS,
      null,
      'acme-clinic.example',
      'Acme Clinic',
    );
    const [request] = requestsOf(row);
    expect(request).not.toHaveProperty('mentionContext');
  });
});
