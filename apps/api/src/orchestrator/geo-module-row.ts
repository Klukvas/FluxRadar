// Строка ScanModule для «AI SEO / GEO» — чистая функция над итогом модуля.
//
// Модуль informational-only (D-109): ни одно GEO-правило не штрафует score,
// поэтому «100 − 0» — не измерение, а константа. Раньше Completed/Partial
// получали ровно её, и успешный HTTP-ответ провайдера сам по себе давал Basic
// 40% общего балла (Complete — 15%) вне зависимости от того, упомянул ли
// ответ бренд или домен вообще. Это неправда, которую отчёт продавал как
// оценку видимости.
//
// Строка больше не несёт score (null во всех ветках). Вместо выдуманного
// числа она несёт наблюдения: сколько вопросов задано, сколько получило
// ответ, и в скольких ответах реально встретились бренд и домен — отдельно
// для прямых brand-awareness-вопросов (они называют бренд сами) и для
// нейтральных discovery-вопросов (они бренд не подсказывают, поэтому
// упоминание там значит совсем другое). Складывать эти две величины в один
// балл нечем: у нас нет ни весов, ни базы сравнения, а выдумать их — значит
// повторить ту же ошибку.
//
// Влияние на общий score (§15): модуль остаётся eligible по coverage, но без
// числового score выпадает из взвешенного среднего (overall-score.ts считает
// только модули с числовым score). Basic при отработавшем GEO сохраняет
// weighted coverage 1.0 и вердикт normal, а общий балл становится баллом SEO.

import type {
  GeoAnswerEvaluation,
  GeoEvidenceSnapshot,
  GeoMentionSignals,
  GeoModuleResult,
} from '@fluxradar/ai';
import { isMeasured } from '@fluxradar/ai';
import { computeCoverage } from '@fluxradar/scoring';
import type { assessAiCrawlerReadiness } from '@fluxradar/rules';

import { redactEvidence } from './ai-evidence.ts';
import type { GeoQuestionGenerationResult } from './geo.ts';
import type { ModuleRowData } from './module-row.ts';

/**
 * Почему у строки GEO нет score.
 *
 * §15/§16 запрещают обычному Completed-модулю нести status_reason, поэтому
 * причина едет в metadata — тем же механизмом, что FREE_CHECK_SCORING_REASON.
 */
export const GEO_SCORING_REASON = 'InformationalOnly';

/**
 * How a question was asked, as the report must label it.
 *
 * A row written before the closed-book release says `awareness`: those
 * questions named the brand and spelled out the domain with web search on, and
 * calling them closed-book now would relabel history into a check that never
 * ran.
 */
type QuestionPurpose = 'closed-book' | 'awareness' | 'discovery';

/** Наблюдения одного типа вопросов; все поля — счётчики реальных исходов. */
interface PurposeObservations {
  /** Сколько вопросов этого типа было задано провайдеру. */
  readonly asked: number;
  /** Сколько из них вернули ответ, прошедший контракт §5. */
  readonly answered: number;
  /** Для скольких ответов хоть один из сигналов был измерим. */
  readonly evaluated: number;
  /** Сколько ответов вообще могли что-то сказать о бренде (вопрос его не называл). */
  readonly brandMeasured: number;
  /** То же для домена. */
  readonly domainMeasured: number;
  readonly brandMentioned: number;
  readonly domainMentioned: number;
}

const EMPTY_OBSERVATIONS: PurposeObservations = {
  asked: 0,
  answered: 0,
  evaluated: 0,
  brandMeasured: 0,
  domainMeasured: 0,
  brandMentioned: 0,
  domainMentioned: 0,
};

function purposeOf(promptVersion: string): QuestionPurpose {
  if (promptVersion.endsWith('-discovery')) return 'discovery';
  return promptVersion.endsWith('-closed-book') ? 'closed-book' : 'awareness';
}

/**
 * Упоминания бренда/домена в одном ответе.
 *
 * Сигналы приходят из той же функции, которой пользуются правила
 * (`geoMentionSignals`), а не выводятся из отсутствия finding-а: вопрос,
 * который сам назвал бренд или домен, findings не порождает, и «нет finding-а
 * значит упомянуто» красило такой ответ зелёным на каждом скане. Теперь
 * сигнал прямо говорит, было ли измерение вообще (`named-in-question`,
 * `brand-is-hostname`). null — правила по прогону вердикта не выносили.
 */
function mentionSignals(geo: GeoModuleResult, aiRequestKey: string): GeoMentionSignals | null {
  return geo.mentions.get(aiRequestKey) ?? null;
}

function addOutcome(
  totals: PurposeObservations,
  signals: GeoMentionSignals | null,
  answered: boolean,
): PurposeObservations {
  const counted = signals !== null && answered;
  // Неизмеримый сигнал не идёт ни в числитель, ни в знаменатель: «не
  // измерено» — это не «не упомянуто».
  const brandMeasured = counted && isMeasured(signals.brand);
  const domainMeasured = counted && isMeasured(signals.domain);
  return {
    asked: totals.asked + 1,
    answered: totals.answered + (answered ? 1 : 0),
    evaluated: totals.evaluated + (brandMeasured || domainMeasured ? 1 : 0),
    brandMeasured: totals.brandMeasured + (brandMeasured ? 1 : 0),
    domainMeasured: totals.domainMeasured + (domainMeasured ? 1 : 0),
    brandMentioned:
      totals.brandMentioned + (brandMeasured && signals.brand === 'mentioned' ? 1 : 0),
    domainMentioned:
      totals.domainMentioned + (domainMeasured && signals.domain === 'mentioned' ? 1 : 0),
  };
}

/** Что прогон реально наблюдал, раздельно по типу вопроса. */
export function geoObservations(
  geo: GeoModuleResult,
): Readonly<Record<QuestionPurpose, PurposeObservations>> {
  return geo.outcomes.reduce<Record<QuestionPurpose, PurposeObservations>>(
    (totals, outcome) => {
      const purpose = purposeOf(outcome.request.promptVersion);
      const answered = outcome.kind === 'response';
      const signals = answered ? mentionSignals(geo, outcome.aiRequestKey) : null;
      return { ...totals, [purpose]: addOutcome(totals[purpose], signals, answered) };
    },
    {
      'closed-book': EMPTY_OBSERVATIONS,
      awareness: EMPTY_OBSERVATIONS,
      discovery: EMPTY_OBSERVATIONS,
    },
  );
}

/** One answer's verdict, or the honest reason it has none. */
function evaluationRecord(
  evaluation: GeoAnswerEvaluation | undefined,
): Record<string, unknown> | null {
  if (evaluation === undefined) return null;
  return {
    status: evaluation.status,
    reason: evaluation.reason,
    detail: evaluation.detail === null ? null : redactEvidence(evaluation.detail),
    purpose: evaluation.purpose,
    promptVersion: evaluation.promptVersion,
    // The judge's own request key, kept so a stored verdict can be traced back
    // to the exact provider exchange that produced it.
    aiRequestKey: evaluation.aiRequestKey,
    provider: evaluation.provider,
    modelId: evaluation.modelId,
    usage: evaluation.usage,
    ...(evaluation.payload === null
      ? {}
      : {
          overall: evaluation.payload.overall,
          overallAdjusted: evaluation.payload.overallAdjusted,
          answerDescribesSubject: evaluation.payload.answerDescribesSubject,
          claims: redactEvidence(evaluation.payload.claims),
        }),
  };
}

/**
 * The evidence every answer of this scan was judged against, with its provenance.
 *
 * The snapshot arrives already redacted — the module sanitises it once, before
 * any judge reads it, so that the text sent, the text quotes are checked
 * against and the text stored here are one string. `redactEvidence` runs over
 * it anyway: it is idempotent, and this is the boundary where every other piece
 * of stored scan material is sanitised.
 */
function evidenceRecord(evidence: GeoEvidenceSnapshot | null): Record<string, unknown> | null {
  if (evidence === null) return null;
  return {
    sufficiency: evidence.sufficiency,
    limits: evidence.limits,
    sources: redactEvidence(evidence.sources),
  };
}

/** Why some answers have no verdict — named, never rounded away. */
function evaluationStatusReason(geo: GeoModuleResult): string | null {
  const reasons = [...geo.answerEvaluations.values()]
    .filter((evaluation) => evaluation.status === 'Unavailable')
    .map((evaluation) => evaluation.reason ?? 'Unavailable');
  if (reasons.length === 0) return null;
  return (
    `AnswerEvaluationUnavailable: ${reasons.length} of ${geo.answerEvaluations.size} ` +
    `(${[...new Set(reasons)].join(', ')})`
  );
}

function statusReasonParts(
  geo: GeoModuleResult,
  generation: GeoQuestionGenerationResult,
): readonly string[] {
  return [
    geo.statusReason,
    generation.status === 'Unavailable' || generation.status === 'InvalidResponse'
      ? `QueryGeneration${generation.status}: ${generation.statusReason ?? 'unknown reason'}`
      : null,
    evaluationStatusReason(geo),
  ].filter((reason): reason is string => reason !== null);
}

function queryGenerationMetadata(
  generation: GeoQuestionGenerationResult,
): Readonly<Record<string, unknown>> {
  return {
    status: generation.status,
    statusReason: generation.statusReason,
    promptVersion: generation.outcome?.request.promptVersion ?? null,
    generatedQuestions: redactEvidence(generation.questions),
    ...(generation.outcome?.kind === 'response'
      ? { aiRequestKey: generation.outcome.aiRequestKey, usage: generation.outcome.response.usage }
      : generation.outcome?.kind === 'unavailable'
        ? { reason: generation.outcome.reason }
        : {}),
  };
}

/** Строка ScanModule для GEO; побочных эффектов нет — запись делает вызывающий. */
export function geoModuleRow(
  geo: GeoModuleResult,
  generation: GeoQuestionGenerationResult,
  aiCrawlerReadiness: ReturnType<typeof assessAiCrawlerReadiness>,
  evidence: GeoEvidenceSnapshot | null = null,
): ModuleRowData {
  const reasonParts = statusReasonParts(geo, generation);
  // Each answer's evaluation is a check of its own: a judge that could not run
  // has to lower coverage, not disappear behind a Completed module.
  const completedEvaluations = [...geo.answerEvaluations.values()].filter(
    (evaluation) => evaluation.status === 'Completed',
  ).length;
  const coverage = computeCoverage({
    // Знаменатель — все вопросы библиотеки, а не только заданные: прерванный
    // отменой прогон обязан показать, что часть проверок не выполнялась, иначе
    // две заданные из пяти выглядели бы как полное покрытие (§15/§575).
    applicableChecks: geo.requested + generation.applicableChecks + geo.answerEvaluations.size,
    completedApplicableChecks:
      geo.responses.length + generation.completedApplicableChecks + completedEvaluations,
    ...(reasonParts.length > 0 ? { statusReason: reasonParts.join('; ') } : {}),
  });
  return {
    runtimeStatus: coverage.status,
    statusReason: coverage.statusReason,
    coverage: coverage.coverage,
    // Informational-only (D-109): штрафующих правил нет, измеренного балла
    // тоже нет — см. шапку файла.
    score: null,
    applicableChecks: coverage.applicableChecks,
    completedApplicableChecks: coverage.completedApplicableChecks,
    usableOutput: geo.responses.length > 0,
    metadataJson: JSON.stringify({
      standard: 'AI crawler readiness',
      scoring: GEO_SCORING_REASON,
      automation: aiCrawlerReadiness.automation,
      providerTokenRequired: aiCrawlerReadiness.providerTokenRequired,
      robots: aiCrawlerReadiness.robots,
      pages: aiCrawlerReadiness.pages,
      limitations: aiCrawlerReadiness.limitations,
      providerVisibility: {
        status: coverage.status,
        statusReason: coverage.statusReason,
        requiresConsent: true,
        providers: [...new Set(geo.outcomes.map((outcome) => outcome.request.provider))],
        // Per purpose, because it is no longer one answer for the module: a
        // discovery question needs a searching assistant, a direct one is
        // answered from memory or not at all.
        webSearch: { discovery: true, closedBook: false },
        method:
          'AI-generated neutral discovery questions asked of each provider with its own web ' +
          'search enabled, plus closed-book questions about the business asked without search ' +
          'or tools, each answer evaluated separately against this scan’s own evidence',
        interpretation:
          'Prompt-specific observations; a discovery citation is a source the model used, a ' +
          'mention does not prove remembered knowledge, and an evaluation states only what ' +
          'this scan’s evidence supports.',
        observations: geoObservations(geo),
        evidence: evidenceRecord(evidence),
        queryGeneration: queryGenerationMetadata(generation),
        requests: geo.outcomes.map((outcome) => ({
          purpose: purposeOf(outcome.request.promptVersion),
          promptVersion: outcome.request.promptVersion,
          // On the ledger entry as well as on the response row, so an
          // unavailable observation can still say which provider was asked.
          provider: outcome.request.provider,
          sequence: outcome.request.sequence,
          status: outcome.kind,
          question: redactEvidence(outcome.request.question),
          ...(outcome.kind === 'response'
            ? {
                aiRequestKey: outcome.aiRequestKey,
                usage: outcome.response.usage,
                mentions: mentionSignals(geo, outcome.aiRequestKey),
                evaluation: evaluationRecord(geo.answerEvaluations.get(outcome.aiRequestKey)),
              }
            : { reason: outcome.reason }),
        })),
      },
    }),
  };
}
