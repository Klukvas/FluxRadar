// AI SEO / GEO пишет наблюдения, а не оценку. Тесты фиксируют главное:
// успешный ответ провайдера сам по себе ничего не доказывает про видимость,
// поэтому строка модуля не несёт score ни в одной ветке, а счётчики упоминаний
// считаются по реально наблюдённым исходам и раздельно для brand-awareness и
// нейтрального discovery.

import { describe, expect, it } from 'vitest';
import type { AiRequest, GeoModuleResult } from '@fluxradar/ai';

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
 * GEO-VIS-003/004 сообщают об ОТСУТСТВИИ упоминания: finding на ai_request_key
 * означает, что бренд (003) или домен (004) в этом ответе не встретился.
 */
function evaluations(missingBrandKeys: readonly string[], missingDomainKeys: readonly string[]) {
  const findings = (keys: readonly string[]) => keys.map((aiRequestKey) => ({ aiRequestKey }));
  return [
    { ruleId: 'GEO-VIS-003', findings: findings(missingBrandKeys) },
    { ruleId: 'GEO-VIS-004', findings: findings(missingDomainKeys) },
  ] as unknown as GeoModuleResult['evaluations'];
}

function geoResult(overrides: Partial<GeoModuleResult> = {}): GeoModuleResult {
  const outcomes = overrides.outcomes ?? [];
  return {
    module: 'AI SEO / GEO',
    status: 'Completed',
    statusReason: null,
    outcomes,
    responses: outcomes.filter((outcome) => outcome.kind === 'response'),
    evaluations: evaluations([], []),
    findings: [],
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
        evaluations: evaluations(['key-1', 'key-2'], ['key-1', 'key-2']),
      }),
      generationResult(),
      AI_CRAWLER_READINESS,
    );
    expect(row.score).toBeNull();
    expect(visibilityOf(row).observations).toEqual({
      awareness: { asked: 1, answered: 1, evaluated: 1, brandMentioned: 0, domainMentioned: 0 },
      discovery: { asked: 1, answered: 1, evaluated: 1, brandMentioned: 0, domainMentioned: 0 },
    });
  });

  it('смешанный исход считает упоминания раздельно по типу вопроса', () => {
    const row = geoModuleRow(
      geoResult({
        outcomes: [answered(1, 'awareness'), answered(2, 'discovery'), answered(3, 'discovery')],
        // Бренд не назван только в третьем ответе; домен — во втором и третьем.
        evaluations: evaluations(['key-3'], ['key-2', 'key-3']),
      }),
      generationResult(),
      AI_CRAWLER_READINESS,
    );
    expect(visibilityOf(row).observations).toEqual({
      awareness: { asked: 1, answered: 1, evaluated: 1, brandMentioned: 1, domainMentioned: 1 },
      discovery: { asked: 2, answered: 2, evaluated: 2, brandMentioned: 1, domainMentioned: 0 },
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
      awareness: { asked: 1, answered: 0, evaluated: 0, brandMentioned: 0, domainMentioned: 0 },
      discovery: { asked: 1, answered: 0, evaluated: 0, brandMentioned: 0, domainMentioned: 0 },
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
      geoResult({ outcomes: [answered(1, 'awareness')] }),
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
      awareness: { asked: 1, answered: 1, evaluated: 1, brandMentioned: 1, domainMentioned: 1 },
      discovery: { asked: 0, answered: 0, evaluated: 0, brandMentioned: 0, domainMentioned: 0 },
    });
  });
});
