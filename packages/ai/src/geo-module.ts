// Фасад модуля «AI SEO / GEO» (T-10, D-174) — точка входа для T-12 orchestrator
// (Basic/Complete). Прогоняет вопросы библиотеки через runAiRequest, агрегирует
// статус модуля и строит informational GEO-findings. Инварианты §5:
// consent-гейт срабатывает до единственного обращения к провайдеру; модуль
// Unavailable не имеет ни ai_response-материала, ни findings, ни списаний квоты.

import type { ModuleName, ModuleRuntimeStatus, Plan } from '@fluxradar/contracts';

import type { AiConsent } from './consent.js';
import { AiModuleError, AiRequestCancelledError } from './errors.js';
import { evaluateGeoAnswer, GEO_EVALUATION_PROMPT_VERSION } from './geo-evaluation.js';
import type {
  GeoAnswerEvaluation,
  GeoAnswerPurpose,
  GeoEvaluationUnavailableReason,
} from './geo-evaluation.js';
import { redactGeoEvidenceSnapshot } from './geo-evidence.js';
import type { GeoEvidenceSnapshot } from './geo-evidence.js';
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
  /**
   * What this scan actually observed about the site, for judging each answer.
   *
   * Omitted or null means no answer is evaluated — an older caller, or a scan
   * that read nothing. The report then says the answers were not evaluated; it
   * never implies a check that did not run.
   */
  readonly evidence?: GeoEvidenceSnapshot | null;
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
  /**
   * Per answer (by its `aiRequestKey`), what a separate, stateless evaluator
   * made of it against the scan's evidence — or the reason there is no verdict.
   *
   * Empty when the caller supplied no evidence snapshot. An answer with no
   * entry here is shown as unevaluated, never as verified.
   */
  readonly answerEvaluations: ReadonlyMap<string, GeoAnswerEvaluation>;
  /**
   * The exact snapshot the evaluators read: redacted once, frozen, shared.
   *
   * This is what belongs beside the verdicts, because it is the text they were
   * checked against. null when no evaluation ran — no snapshot was supplied, or
   * the snapshot could not be sanitised — and then nothing was sent either.
   */
  readonly evaluatedEvidence: GeoEvidenceSnapshot | null;
  /** The evaluators' own provider exchanges, for the ai_response ledger. */
  readonly evaluationOutcomes: readonly AiRequestOutcome[];
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

/** Which rubric an answer is judged under; a discovery answer is not a company profile. */
function purposeOf(request: AiRequest): GeoAnswerPurpose {
  return request.promptVersion.endsWith('-discovery') ? 'discovery' : 'closed-book';
}

interface EvaluationPass {
  readonly evaluations: ReadonlyMap<string, GeoAnswerEvaluation>;
  readonly outcomes: readonly AiRequestOutcome[];
  readonly evidence: GeoEvidenceSnapshot | null;
  readonly quota: AiQuotaTracker;
}

/** Every answer gets the same reason, because the one snapshot is the blocker. */
function evaluationsBlocked(
  responses: readonly AiResponseOutcome[],
  reason: GeoEvaluationUnavailableReason,
  detail: string,
): ReadonlyMap<string, GeoAnswerEvaluation> {
  return new Map(
    responses.map((answer) => [
      answer.aiRequestKey,
      {
        parentAiRequestKey: answer.aiRequestKey,
        purpose: purposeOf(answer.request),
        status: 'Unavailable' as const,
        reason,
        detail,
        payload: null,
        aiRequestKey: null,
        provider: null,
        modelId: null,
        promptVersion: GEO_EVALUATION_PROMPT_VERSION,
        usage: null,
      },
    ]),
  );
}

/**
 * Judges each answered question separately.
 *
 * One request per answer, in order, threading the immutable quota tracker from
 * one to the next. Sequential on purpose: the tracker is a value object, and
 * running judges concurrently would mean two callers reserving against the same
 * state and one of the reservations vanishing.
 */
async function evaluateAnswers(
  input: GeoModuleInput,
  responses: readonly AiResponseOutcome[],
  rawEvidence: GeoEvidenceSnapshot,
  options: GeoModuleOptions,
  startingQuota: AiQuotaTracker,
): Promise<EvaluationPass> {
  // Sanitised once for the whole scan: the judges, the quote checks and the
  // stored record all read this one object, so they cannot disagree about what
  // the evidence said.
  let evidence: GeoEvidenceSnapshot;
  try {
    evidence = redactGeoEvidenceSnapshot(rawEvidence, options.redaction);
  } catch (error) {
    return {
      evaluations: evaluationsBlocked(
        responses,
        'RedactionBlocked',
        error instanceof Error ? error.message : 'the evidence could not be redacted',
      ),
      outcomes: [],
      evidence: null,
      quota: startingQuota,
    };
  }

  const evaluations = new Map<string, GeoAnswerEvaluation>();
  const outcomes: AiRequestOutcome[] = [];
  let quota = startingQuota;

  for (const answer of responses) {
    const result = await evaluateGeoAnswer(
      {
        scanId: input.scanId,
        parentAiRequestKey: answer.aiRequestKey,
        purpose: purposeOf(answer.request),
        question: answer.request.question,
        // Exactly one answer. Nothing from a sibling answer, and nothing from
        // any previous verdict, is in this request.
        answer: answer.response.rawText,
        evidence,
        // The answer's own sequence: the same answer keeps the same judge key
        // across a retry, however many of its siblings failed that time.
        index: answer.request.sequence,
        consent: input.consent,
      },
      {
        provider: options.provider,
        quota,
        ...(options.redaction !== undefined ? { redaction: options.redaction } : {}),
      },
    );
    quota = result.quota;
    evaluations.set(answer.aiRequestKey, result.evaluation);
    if (result.outcome !== null) outcomes.push(result.outcome);
  }
  return { evaluations, outcomes, evidence, quota };
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

  const evidence = input.evidence ?? null;
  const evaluated: EvaluationPass =
    evidence === null || responses.length === 0
      ? { evaluations: new Map(), outcomes: [], evidence: null, quota }
      : await evaluateAnswers(input, responses, evidence, options, quota);
  quota = evaluated.quota;

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
    answerEvaluations: evaluated.evaluations,
    evaluatedEvidence: evaluated.evidence,
    evaluationOutcomes: evaluated.outcomes,
    quota,
    requested: input.requests.length,
    interrupted,
  };
}
