// GEO-правила ×5 (T-10, D-171): детерминированные функции над итогами
// AI-запросов (NormalizedAiResponse + метаданные), не над PageSnapshot.
// Все правила informational (severity null, D-109); findings документируют
// наблюдения и возможности, score не штрафуют (scoreDelta = 0, GEO-METHOD-005).
// Метаданные правила — только из реестра contracts (как в packages/rules).

import { ruleById } from '@fluxradar/contracts';
import type { RuleDescriptor } from '@fluxradar/contracts';

import { AiModuleError } from './errors.js';
import { geoFinding } from './geo-findings.js';
import type { GeoFinding } from './geo-findings.js';
import { validateNormalizedResponse } from './response-contract.js';
import type { AiRequestOutcome, AiResponseOutcome } from './run-request.js';

/** Вход GEO-правил: идентичность сайта и все итоги прогона AI-запросов. */
export interface GeoRuleInput {
  /** Нормализованный домен сайта (поле `domain` fingerprint-а, D-019). */
  readonly domain: string;
  /** Origin сайта — target_url для site/environment findings. */
  readonly siteUrl: string;
  readonly brand: string;
  readonly outcomes: readonly AiRequestOutcome[];
}

/** Итог одного правила — форма зеркалит RuleEvaluation движка rules (D-121). */
export interface GeoRuleEvaluation {
  readonly ruleId: string;
  readonly applicableTargets: number;
  readonly affectedTargets: number;
  readonly findings: readonly GeoFinding[];
}

function requireGeoDescriptor(ruleId: string): RuleDescriptor {
  const descriptor = ruleById(ruleId);
  if (descriptor === undefined) {
    throw new AiModuleError(`ai: ${ruleId} отсутствует в реестре rules-mvp-0.1 (contracts)`);
  }
  return descriptor;
}

function responses(input: GeoRuleInput): readonly AiResponseOutcome[] {
  return input.outcomes.filter((outcome): outcome is AiResponseOutcome => {
    return outcome.kind === 'response';
  });
}

/** `q<sequence>` — стабильный идентификатор вопроса библиотеки (D-176). */
function questionParameter(outcome: AiRequestOutcome): string {
  return `q${outcome.request.sequence}`;
}

function excerptHead(text: string, maxChars: number): string {
  const codePoints = [...text];
  if (codePoints.length <= maxChars) return text;
  return `${codePoints.slice(0, maxChars).join('')}…`;
}

// --- GEO-PROVIDER-001 — adapter-контракт §5 (environment) ---------------------
// Платформенный инвариант: каждый сохранённый ответ проходит normalized
// response contract (total = input + output, обязательные поля, tokenizerVersion
// при estimated). На живом pipeline нарушений быть не должно: run-request
// отбрасывает такие ответы до commit-а (D-175); правило — независимый контроль.
export function evaluateGeoProvider001(input: GeoRuleInput): GeoRuleEvaluation {
  const descriptor = requireGeoDescriptor('GEO-PROVIDER-001');
  const applicable = responses(input);
  const findings = applicable.flatMap((outcome): readonly GeoFinding[] => {
    const violations = validateNormalizedResponse(outcome.response);
    if (violations.length === 0) return [];
    return [
      geoFinding(descriptor, {
        targetUrl: input.siteUrl,
        evidenceType: 'trace',
        evidence:
          `ответ провайдера ${outcome.response.provider} (request ${outcome.response.requestId}) ` +
          `нарушает контракт §5: ${violations.join('; ')}`,
        recommendation:
          'Ответ не соответствует normalized response contract §5 — проверьте версию адаптера ' +
          'провайдера; такой ответ не должен попадать в ai_response record.',
        resource: outcome.response.provider,
        parameter: questionParameter(outcome),
        aiRequestKey: outcome.aiRequestKey,
      }),
    ];
  });
  return {
    ruleId: descriptor.ruleId,
    applicableTargets: applicable.length,
    affectedTargets: findings.length,
    findings,
  };
}

// --- GEO-VIS-003 — присутствие бренда в ответе (site) -------------------------
// Оракул: rawText содержит имя бренда (case-insensitive substring).
// Finding — на каждый ответ БЕЗ бренда: это возможность для контента, не штраф.
export function evaluateGeoVis003(input: GeoRuleInput): GeoRuleEvaluation {
  const descriptor = requireGeoDescriptor('GEO-VIS-003');
  const brand = input.brand.trim();
  if (brand === '') {
    throw new AiModuleError('ai: GEO-VIS-003 требует непустое имя бренда');
  }
  const needle = brand.toLowerCase();
  const applicable = responses(input);
  const findings = applicable
    .filter((outcome) => !outcome.response.rawText.toLowerCase().includes(needle))
    .map((outcome) =>
      geoFinding(descriptor, {
        targetUrl: input.siteUrl,
        evidenceType: 'trace',
        evidence:
          `вопрос «${outcome.request.question}»: ответ ${outcome.response.provider}/` +
          `${outcome.response.modelId} не упоминает бренд «${brand}»; фрагмент ответа: ` +
          excerptHead(outcome.response.rawText, 300),
        recommendation:
          `Усильте присутствие бренда «${brand}» в контенте по теме вопроса: явные факты, ` +
          'определения и страницы-источники повышают шанс упоминания в AI-ответах.',
        resource: outcome.response.provider,
        parameter: questionParameter(outcome),
        aiRequestKey: outcome.aiRequestKey,
      }),
    );
  return {
    ruleId: descriptor.ruleId,
    applicableTargets: applicable.length,
    affectedTargets: findings.length,
    findings,
  };
}

// --- GEO-VIS-004 — ссылка на домен сайта в ответе (site) ----------------------
// Оракул: rawText упоминает домен на границе hostname ЛИБО среди citations есть
// URL с host = домен или его поддомен. Finding — на каждый ответ без ссылки.
function citationMatchesDomain(citation: string, domain: string): boolean {
  try {
    const host = new URL(citation).hostname.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    // Не-URL citation не считается ссылкой на сайт; это не ошибка pipeline.
    return false;
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Домен в тексте — ссылка на сайт только на границе hostname (D-178):
 * слева не допускается символ hostname (иначе notsite.com даёт false positive),
 * справа — ни символ hostname (site.community), ни продолжение через точку
 * (site.com.evil). Поддомен слева (docs.site.com) остаётся упоминанием сайта:
 * точка не входит в граничный класс.
 */
function textMentionsDomain(text: string, domain: string): boolean {
  const boundary = '[a-z0-9-]';
  const pattern = new RegExp(
    `(?<!${boundary})${escapeRegExp(domain)}(?!${boundary}|\\.[a-z0-9])`,
    'i',
  );
  return pattern.test(text);
}

function mentionsSiteLink(outcome: AiResponseOutcome, domain: string): boolean {
  if (textMentionsDomain(outcome.response.rawText, domain)) return true;
  return outcome.response.citations.some((citation) => citationMatchesDomain(citation, domain));
}

export function evaluateGeoVis004(input: GeoRuleInput): GeoRuleEvaluation {
  const descriptor = requireGeoDescriptor('GEO-VIS-004');
  const domain = input.domain.trim().toLowerCase();
  if (domain === '') {
    throw new AiModuleError('ai: GEO-VIS-004 требует непустой домен сайта');
  }
  const applicable = responses(input);
  const findings = applicable
    .filter((outcome) => !mentionsSiteLink(outcome, domain))
    .map((outcome) =>
      geoFinding(descriptor, {
        targetUrl: input.siteUrl,
        evidenceType: 'trace',
        evidence:
          `вопрос «${outcome.request.question}»: в ответе ${outcome.response.provider}/` +
          `${outcome.response.modelId} нет ссылки на ${domain} (ни в тексте, ни в citations: ` +
          `${outcome.response.citations.length} шт.)`,
        recommendation:
          `Сделайте страницы ${domain} цитируемыми источниками: структурированные данные, ` +
          'ясные факты со ссылками и стабильные URL повышают шанс попасть в citations.',
        resource: outcome.response.provider,
        parameter: questionParameter(outcome),
        aiRequestKey: outcome.aiRequestKey,
      }),
    );
  return {
    ruleId: descriptor.ruleId,
    applicableTargets: applicable.length,
    affectedTargets: findings.length,
    findings,
  };
}

// --- GEO-METHOD-002 — фиксация метаданных запроса (environment) ---------------
// Оракул: каждый сохранённый ответ несёт provider/model/promptVersion/requestId/
// createdAt/source (вопрос). Регион/язык в v0.1 фиксируются версией библиотеки
// вопросов (promptVersion) и отдельными полями не представлены (D-176).
function missingMetadata(outcome: AiResponseOutcome): readonly string[] {
  const checks: ReadonlyArray<readonly [string, string]> = [
    ['provider', outcome.response.provider],
    ['model_id', outcome.response.modelId],
    ['prompt_version', outcome.request.promptVersion],
    ['request_id', outcome.response.requestId],
    ['created_at', outcome.response.createdAt],
    ['question', outcome.request.question],
    ['ai_request_key', outcome.aiRequestKey],
  ];
  return checks.filter(([, value]) => value.trim() === '').map(([field]) => field);
}

export function evaluateGeoMethod002(input: GeoRuleInput): GeoRuleEvaluation {
  const descriptor = requireGeoDescriptor('GEO-METHOD-002');
  const applicable = responses(input);
  const findings = applicable.flatMap((outcome): readonly GeoFinding[] => {
    const missing = missingMetadata(outcome);
    if (missing.length === 0) return [];
    return [
      geoFinding(descriptor, {
        targetUrl: input.siteUrl,
        evidenceType: 'trace',
        evidence:
          `ответ на вопрос №${outcome.request.sequence} сохранён без обязательных ` +
          `метаданных: ${missing.join(', ')}`,
        recommendation:
          'Каждый AI-ответ обязан фиксировать provider, model ID, версию промпта, request ID ' +
          'и дату (§5 методика) — дополните метаданные записи.',
        resource: outcome.response.provider,
        parameter: questionParameter(outcome),
        aiRequestKey: outcome.aiRequestKey,
      }),
    ];
  });
  return {
    ruleId: descriptor.ruleId,
    applicableTargets: applicable.length,
    affectedTargets: findings.length,
    findings,
  };
}

// --- GEO-METHOD-005 — Unavailable без штрафа (environment) --------------------
// Оракул: недоступный провайдер/запрос представлен Unavailable-итогом без
// ai_response record и с нулевым влиянием на score. Finding документирует
// пропуск для пользователя; scoreDelta = 0 гарантирован билдером.
export function evaluateGeoMethod005(input: GeoRuleInput): GeoRuleEvaluation {
  const descriptor = requireGeoDescriptor('GEO-METHOD-005');
  const unavailableOutcomes = input.outcomes.filter((outcome) => outcome.kind === 'unavailable');
  const findings = unavailableOutcomes.map((outcome) =>
    geoFinding(descriptor, {
      targetUrl: input.siteUrl,
      evidenceType: 'none',
      evidence:
        `AI-запрос №${outcome.request.sequence} (${outcome.request.provider}) недоступен: ` +
        `${outcome.reason} — ${outcome.detail}`,
      recommendation:
        'Запрос получил статус Unavailable и не уменьшает score (§5 методика); ' +
        'повторите проверку позже или уточните consent/настройки провайдера.',
      resource: outcome.request.provider,
      parameter: questionParameter(outcome),
    }),
  );
  return {
    ruleId: descriptor.ruleId,
    applicableTargets: input.outcomes.length,
    affectedTargets: findings.length,
    findings,
  };
}

/** Все 5 GEO-правил в фиксированном порядке реестра. */
export function evaluateGeoRules(input: GeoRuleInput): readonly GeoRuleEvaluation[] {
  return [
    evaluateGeoProvider001(input),
    evaluateGeoVis003(input),
    evaluateGeoVis004(input),
    evaluateGeoMethod002(input),
    evaluateGeoMethod005(input),
  ];
}
