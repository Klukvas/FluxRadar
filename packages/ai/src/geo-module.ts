// Фасад модуля «AI SEO / GEO» (T-10, D-174) — точка входа для T-12 orchestrator
// (Basic/Complete). Прогоняет вопросы библиотеки через runAiRequest, агрегирует
// статус модуля и строит informational GEO-findings. Инварианты §5:
// consent-гейт срабатывает до единственного обращения к провайдеру; модуль
// Unavailable не имеет ни ai_response-материала, ни findings, ни списаний квоты.

import type { ModuleName, ModuleRuntimeStatus, Plan } from '@fluxradar/contracts';

import type { AiConsent } from './consent.js';
import { AiModuleError, AiRequestCancelledError } from './errors.js';
import type { GeoFinding } from './geo-findings.js';
import { evaluateGeoRules, geoMentionSignals } from './geo-rules.js';
import type { GeoMentionSignals, GeoRuleEvaluation } from './geo-rules.js';
import { AiQuotaTracker } from './quota.js';
import type { RedactionOptions } from './redaction.js';
import { runAiRequest } from './run-request.js';
import type { AiRequestOutcome, AiResponseOutcome } from './run-request.js';
import type { AiProvider, AiRequest } from './types.js';

export const GEO_MODULE_NAME: ModuleName = 'AI SEO / GEO';

export type GeoModuleStatus = Extract<ModuleRuntimeStatus, 'Completed' | 'Partial' | 'Unavailable'>;

export interface GeoModuleInput {
  readonly scanId: string;
  readonly plan: Plan;
  readonly brand: string;
  /** Origin сайта — target_url для site/environment findings. */
  readonly siteOrigin: string;
  /** Нормализованный домен (поле `domain` fingerprint-а, D-019). */
  readonly siteDomain: string;
  readonly consent: AiConsent | null;
  readonly requests: readonly AiRequest[];
}

export interface GeoModuleOptions {
  readonly provider: AiProvider;
  /** Продолжение прогона (retry) передаёт прежний трекер; дефолт — лимит тарифа. */
  readonly quota?: AiQuotaTracker;
  readonly redaction?: RedactionOptions;
  /**
   * Отмена прогона. Вопросы идут последовательно, поэтому отмена прерывает
   * цикл до следующего платного запроса, а не после всех; запрос, который уже
   * в полёте, прерывается адаптером и поднимает AiRequestCancelledError.
   * Уже полученные ответы остаются результатом — их оплатили. Судьбу самого
   * скана решает оркестратор.
   */
  readonly signal?: AbortSignal;
}

export interface GeoModuleResult {
  readonly module: ModuleName;
  readonly status: GeoModuleStatus;
  /** null только для Completed (§16: non-Completed модуль обязан иметь reason). */
  readonly statusReason: string | null;
  readonly outcomes: readonly AiRequestOutcome[];
  /** Материал будущих ai_response records — только реально полученные ответы. */
  readonly responses: readonly AiResponseOutcome[];
  readonly evaluations: readonly GeoRuleEvaluation[];
  readonly findings: readonly GeoFinding[];
  /**
   * Per answer (by `aiRequestKey`), what it showed about brand and domain
   * visibility — including that a signal was not measurable because the
   * question already named the thing being looked for.
   *
   * The report's badges read this rather than inferring a pass from "no finding
   * for this answer", which is how they came to be green on every scan.
   */
  readonly mentions: ReadonlyMap<string, GeoMentionSignals>;
  /** Финальное состояние квоты: spent = число ответов, outstanding = 0. */
  readonly quota: AiQuotaTracker;
  /** Сколько вопросов было в библиотеке прогона — знаменатель coverage (§15). */
  readonly requested: number;
  /** Прогон прерван отменой: часть вопросов не задавалась вовсе. */
  readonly interrupted: boolean;
}

/** Причина незавершённости прерванного отменой прогона (§16). */
export const GEO_CANCELLED_REASON = 'ScanCancelled';

function validateInput(input: GeoModuleInput): void {
  if (input.scanId.trim() === '') throw new AiModuleError('ai: geo-module — пустой scanId');
  if (input.brand.trim() === '') throw new AiModuleError('ai: geo-module — пустой brand');
  if (input.siteDomain.trim() === '') throw new AiModuleError('ai: geo-module — пустой siteDomain');
  for (const request of input.requests) {
    if (request.scanId !== input.scanId) {
      throw new AiModuleError(
        `ai: geo-module — запрос №${request.sequence} принадлежит чужому скану ` +
          `"${request.scanId}" (ожидался "${input.scanId}")`,
      );
    }
  }
}

interface StatusSummary {
  readonly status: GeoModuleStatus;
  readonly statusReason: string | null;
}

function summarizeStatus(
  outcomes: readonly AiRequestOutcome[],
  requested: number,
  interrupted: boolean,
): StatusSummary {
  const unavailable = outcomes.filter((outcome) => outcome.kind === 'unavailable');
  if (interrupted) {
    // Отмена — не вердикт о сайте и не сбой провайдера. Заданные вопросы
    // остаются честным частичным результатом (§575: завершённая часть
    // сохраняется как Partial), незаданные — просто не заданы.
    const answered = outcomes.filter((outcome) => outcome.kind === 'response').length;
    return answered === 0
      ? { status: 'Unavailable', statusReason: GEO_CANCELLED_REASON }
      : {
          status: 'Partial',
          statusReason: `${GEO_CANCELLED_REASON}: ${answered} of ${requested} questions answered`,
        };
  }
  if (outcomes.length === 0) {
    return { status: 'Unavailable', statusReason: 'EmptyQuestionLibrary' };
  }
  if (unavailable.length === outcomes.length) {
    // Причина — первый отказ: у полностью недоступного модуля она одна и та же
    // (consent/redaction) либо репрезентативна (quota/provider).
    const first = unavailable[0];
    return { status: 'Unavailable', statusReason: first?.reason ?? 'Unavailable' };
  }
  if (unavailable.length > 0) {
    const reasons = [...new Set(unavailable.map((outcome) => outcome.reason))].join(', ');
    return {
      status: 'Partial',
      statusReason: `${unavailable.length} of ${outcomes.length} AI requests unavailable (${reasons})`,
    };
  }
  return { status: 'Completed', statusReason: null };
}

/**
 * Прогон модуля. Запросы выполняются последовательно (детерминированный порядок
 * квоты и outcomes); квота передаётся по цепочке иммутабельных состояний.
 *
 * Отменённый прогон возвращает outcomes только по заданным вопросам — это
 * честный неполный результат, а не ошибка. Так же он ведёт себя и когда отмена
 * застала запрос в полёте: AiRequestCancelledError прекращает цикл, но НЕ
 * выбрасывает уже полученные ответы. Они оплачены, и у каждого есть
 * ai_response record с ссылкой на удаление (AI-001) — потерять их значило бы
 * оставить данные у провайдера без единой записи о них.
 */
export async function runGeoModule(
  input: GeoModuleInput,
  options: GeoModuleOptions,
): Promise<GeoModuleResult> {
  validateInput(input);
  let quota = options.quota ?? AiQuotaTracker.forPlan(input.plan);
  const outcomes: AiRequestOutcome[] = [];
  let interrupted = false;

  for (const request of input.requests) {
    if (options.signal?.aborted === true) {
      interrupted = true;
      break;
    }
    let result;
    try {
      result = await runAiRequest(request, {
        provider: options.provider,
        quota,
        consent: input.consent,
        ...(options.redaction !== undefined ? { redaction: options.redaction } : {}),
        // Отмена в полёте прерывает запрос и поднимает AiRequestCancelledError —
        // отменённый прогон не ждёт ответа, который никто не прочитает.
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      });
    } catch (error) {
      // База, а не AiRequestAbortedError: отмену может заметить и адаптер, и
      // слой вокруг него, и модулю всё равно кто именно — уже полученные
      // ответы сохраняются в обоих случаях.
      if (error instanceof AiRequestCancelledError) {
        interrupted = true;
        break;
      }
      throw error;
    }
    quota = result.quota;
    outcomes.push(result.outcome);
  }

  const { status, statusReason } = summarizeStatus(outcomes, input.requests.length, interrupted);
  const responses = outcomes.filter((outcome): outcome is AiResponseOutcome => {
    return outcome.kind === 'response';
  });

  // Unavailable-модуль — только module record со status_reason (§5): без issue-
  // findings; GEO-METHOD-005 документирует пропуски в Completed/Partial-ветке.
  const ruleInput = {
    domain: input.siteDomain.trim().toLowerCase(),
    siteUrl: input.siteOrigin,
    brand: input.brand,
    outcomes,
  };
  const evaluations = status === 'Unavailable' ? [] : evaluateGeoRules(ruleInput);

  return {
    module: GEO_MODULE_NAME,
    status,
    statusReason,
    outcomes,
    responses,
    evaluations,
    findings: evaluations.flatMap((evaluation) => evaluation.findings),
    mentions:
      status === 'Unavailable'
        ? new Map<string, GeoMentionSignals>()
        : geoMentionSignals(ruleInput),
    quota,
    requested: input.requests.length,
    interrupted,
  };
}
