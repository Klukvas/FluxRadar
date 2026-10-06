// Why one audit section ended where it did, in the owner's own language.
//
// Every module row the API sends carries a machine `status_reason` alongside its
// status — `PerformanceIntegrationNotConfigured`, `ConsentMissing`,
// `AnalyticsPropertyNotSelected`. None of it reached the screen, so a report
// answered "why is Performance unavailable?" and "why did AI SEO / GEO not run?"
// with the same word, and the two causes an owner could actually act on
// differently looked identical.
//
// The vocabulary is the producing side's own, matched as literals for the reason
// `scan-status.ts` matches the free-check scoring reason as one: the web app has
// no dependency on the contracts package. The sources are
// `apps/api/src/orchestrator/module-result.ts` (crawl coverage),
// `module-plan.ts` (the tariff/module plan), `performance-module.ts`
// (`PERFORMANCE_STATUS_REASONS`),
// `packages/ai/src/run-request.ts` (the AI refusals) and
// `apps/api/src/integrations/google/module-row.ts` (Google).

import type { ScanModule } from './api';
import { copy, fillCopy, type Language } from './i18n';

type ReasonKey = keyof (typeof copy)['en']['report']['moduleReason'];

/**
 * Whose problem a reason is, and whether the owner has to do anything.
 *
 * The chip said "Checked with limits" beside a score of 100 and the reason
 * underneath read "The AI provider answered in a shape FluxRadar refuses to
 * store, so the answer was discarded instead of being reported as a result".
 * An owner cannot tell from that whether their site is broken, whether they
 * have been short-changed, or whether they are meant to act. One short
 * sentence answers it, chosen per reason code rather than per section:
 *
 *  `ours`        something inside FluxRadar or a service it uses; nothing to do
 *  `oursRetry`   the same, but running the check again can fix it
 *  `eitherSide`  we cannot say whose it is; running it again is what tells them
 *                apart. For a measurement that can be missing because the
 *                service dropped it *or* because the page it read did not
 *                answer — claiming "nothing to do" there would be a guess.
 *  `byPlan`      the plan's own limit, working as sold
 *  `yours`       the owner has to act, and the reason above says how
 *  `yourChoice`  the owner's own cancel
 *  `theSite`     about what the site gave us, which is what a check reports
 *  `nothingToMeasure` neither side: there was nothing here to measure
 *  `notYet`      FluxRadar does not measure this area yet
 */
type ReasonBlame =
  | 'ours'
  | 'oursRetry'
  | 'eitherSide'
  | 'byPlan'
  | 'yours'
  | 'yourChoice'
  | 'theSite'
  | 'nothingToMeasure'
  | 'notYet';

/** A sentence this row owes its reader, and the reason key it came from. */
interface ReasonSentence {
  /** Null for a counted or composite clause assembled from numbers. */
  readonly key: ReasonKey | null;
  readonly text: string;
}

/** Wire reason → the sentence key that explains it. */
const REASON_KEYS: Readonly<Record<string, ReasonKey>> = {
  // Crawl coverage, shared by every rules module.
  NoApplicableTargets: 'noApplicableTargets',
  TargetsUnreachable: 'targetsUnreachable',
  TargetsPartiallyUnreachable: 'targetsPartiallyUnreachable',
  // A section the tariff lists but v0.1 has no evidence-based check for.
  NoDeterministicOracle: 'noDeterministicOracle',
  PlatformFailure: 'platformFailure',
  // A section the worker stopped because the owner cancelled the scan. Its own
  // doing, not a fault of the site — and not a platform failure either.
  ScanCancelled: 'scanCancelled',
  // Performance, whose measurements come from an external service.
  PerformanceIntegrationNotConfigured: 'performanceNotConfigured',
  PerformanceScoreUnavailable: 'performanceScoreUnavailable',
  PerformanceSamplesIncomplete: 'performanceSamplesIncomplete',
  PerformanceProviderUnavailable: 'performanceProviderUnavailable',
  // AI SEO / GEO. These are the pre-response refusals: the request never left.
  ConsentMissing: 'aiConsentMissing',
  RedactionBlocked: 'aiRedactionBlocked',
  QuotaExceeded: 'aiQuotaExceeded',
  ProviderUnavailable: 'aiProviderUnavailable',
  ProviderContract: 'aiProviderContract',
  EmptyQuestionLibrary: 'aiEmptyQuestionLibrary',
  UxAiConsentMissing: 'uxAiConsentMissing',
  UxAiRedactionBlocked: 'uxAiRedactionBlocked',
  UxAiQuotaExceeded: 'uxAiQuotaExceeded',
  UxAiProviderUnavailable: 'uxAiProviderUnavailable',
  UxAiProviderContract: 'uxAiProviderContract',
  // The static UX checks finished; only the AI review was interrupted (§575).
  UxAiScanCancelled: 'uxAiScanCancelled',
  // The AI review answered and every claim it made was dropped for resting on
  // rendering the crawl never read (`apps/api/src/orchestrator/ux-ai-claims.ts`).
  UxAiUnsupportedClaims: 'uxAiUnsupportedClaims',
  // Analytics, written from the live Google connection state.
  AnalyticsIntegrationNotConnected: 'analyticsNotConnected',
  AnalyticsPropertyNotSelected: 'analyticsPropertyNotSelected',
  AnalyticsIntegrationNeedsReconnect: 'analyticsNeedsReconnect',
  AnalyticsPropertyAccessDenied: 'analyticsAccessDenied',
  AnalyticsNoDataForPeriod: 'analyticsNoData',
  AnalyticsProviderUnavailable: 'analyticsProviderUnavailable',
};

/**
 * Whose problem each reason is. Read off the producing side's own causes, not
 * off the section: a Performance row whose provider was never configured and a
 * Performance row whose provider timed out ask opposite things of the owner.
 */
const REASON_BLAME: Readonly<Record<ReasonKey, ReasonBlame | null>> = {
  // Crawl coverage: what the site gave the crawler.
  noApplicableTargets: 'nothingToMeasure',
  targetsUnreachable: 'theSite',
  targetsPartiallyUnreachable: 'theSite',
  noDeterministicOracle: 'notYet',
  platformFailure: 'oursRetry',
  scanCancelled: 'yourChoice',
  // Performance: measured by an external service. A deployment with no service
  // configured is ours alone. The other three are not: a *sample* is lost
  // whenever the measurement throws
  // (`apps/api/src/integrations/performance/audit.ts`), and that includes
  // Lighthouse failing to load the owner's own page — blocked, slow or
  // erroring — as well as the run budget being spent; a missing overall score
  // usually has the same cause. "Nothing for you to do about it" would be a
  // false promise on a page that is in fact unreachable, so none of the three
  // claims a side.
  //
  // `PerformanceProviderUnavailable` reads like the service being down, and it
  // was answered as ours to retry. It is not: the API writes it whenever the
  // performance row ends Unavailable — no usable sample and no field data
  // (`apps/api/src/orchestrator/performance-module.ts`) — and every sample is
  // lost through the same throw, which `pagespeed.ts` raises for any answer
  // that is not OK. That is exactly what Google answers when it cannot load the
  // owner's page, so the reason cannot promise the owner has nothing to fix.
  performanceNotConfigured: 'ours',
  performanceScoreUnavailable: 'eitherSide',
  performanceSamplesIncomplete: 'eitherSide',
  performanceProviderUnavailable: 'eitherSide',
  // AI SEO / GEO. A notice this scan does not carry, a redaction step that did
  // not finish and a provider answering outside its contract are all ours.
  aiConsentMissing: 'ours',
  aiRedactionBlocked: 'ours',
  aiQuotaExceeded: 'byPlan',
  aiProviderUnavailable: 'oursRetry',
  aiProviderContract: 'ours',
  aiEmptyQuestionLibrary: 'ours',
  uxAiConsentMissing: 'ours',
  uxAiRedactionBlocked: 'ours',
  uxAiQuotaExceeded: 'byPlan',
  uxAiProviderUnavailable: 'oursRetry',
  uxAiProviderContract: 'ours',
  uxAiScanCancelled: 'yourChoice',
  uxAiUnsupportedClaims: 'ours',
  // The counted and composite clauses name their own causes immediately after
  // themselves, and those carry the sentence; one here would answer for them.
  aiPartial: null,
  aiCancelled: 'yourChoice',
  aiEvaluationUnavailable: null,
  aiQueryGenerationUnavailable: null,
  aiQueryGenerationInvalidResponse: 'ours',
  // Analytics: the only group where the owner is the one who can act.
  analyticsNotConnected: 'yours',
  analyticsPropertyNotSelected: 'yours',
  analyticsNeedsReconnect: 'yours',
  analyticsAccessDenied: 'yours',
  analyticsNoData: 'nothingToMeasure',
  analyticsProviderUnavailable: 'oursRetry',
  // A reason this build has never seen: saying whose it is would be guessing.
  unknown: null,
};

/**
 * The one reason that is a sentence rather than a token.
 *
 * A GEO run where some questions succeeded reports how many failed and which
 * refusals it saw, assembled in `packages/ai/src/geo-module.ts`. It is read
 * here for the numbers and for the causes inside the brackets, because a
 * translated report cannot show an English sentence and a count with no
 * explanation is not a reason.
 */
const GEO_PARTIAL = /^(\d+) of (\d+) AI requests unavailable \(([^)]*)\)$/;

/**
 * The other GEO sentence with numbers in it: the run was cancelled part-way.
 *
 * The section keeps the answers it already received (§575), so the reader is
 * owed both halves — what was answered, and that the rest was never asked.
 * Assembled in `packages/ai/src/geo-module.ts`.
 */
const GEO_CANCELLED = /^ScanCancelled: (\d+) of (\d+) questions answered$/;

/** Whether the API is saying it deliberately did not run this section. */
export function isNotApplicable(status: string): boolean {
  return /not applicable/i.test(status);
}

/**
 * The clause a GEO row adds when the question generation itself failed.
 *
 * `geo-module-row.ts` joins the run's own reason and this one with `'; '`, so a
 * cancel that landed after generation had already failed produces
 * `ScanCancelled: 1 of 2 questions answered; QueryGenerationUnavailable: …` —
 * one string that matches no single token. Matched as a tail rather than by
 * splitting on every `'; '`, because the detail after the colon is free text
 * (a validation message) and may contain separators of its own.
 */
const QUERY_GENERATION_CLAUSE = /(?:^|; )QueryGeneration(Unavailable|InvalidResponse): ([\s\S]+)$/;

/**
 * The clause a GEO row adds when some answers never reached a verdict.
 *
 * Assembled in `apps/api/src/orchestrator/geo-module-row.ts` as
 * `AnswerEvaluationUnavailable: 1 of 12 (ProviderContract)`. Nothing here
 * matched it, so the whole clause went to the raw-token fallback and an owner
 * read `AnswerEvaluationUnavailable: 1 of 12 (ProviderContract)` on their
 * report. Read for the numbers and for the causes in the brackets, exactly as
 * the counted GEO reason above is: the causes have sentences of their own.
 *
 * Always the last of the three parts the producing side joins with `'; '`, so
 * it is matched at the end and taken off before the rest is read — the
 * question-generation clause ends in free text and would otherwise absorb it.
 */
const ANSWER_EVALUATION_CLAUSE = /(?:^|; )AnswerEvaluationUnavailable: (\d+) of (\d+) \(([^)]*)\)$/;

/**
 * Every sentence this module row owes its reader, in order.
 *
 * Empty for a section that simply completed: a report that explains a success is
 * noise, and §15/§16 forbid an ordinary `Completed` row from carrying a reason
 * at all. A partial AI run returns the count first and then one sentence per
 * distinct cause — naming each of them is the whole point, since folding them
 * into one label is the defect this exists to fix. A composite reason is read
 * clause by clause for the same reason: one unrecognised half must not send the
 * whole sentence to the raw-English fallback.
 */
export function moduleStatusReasons(module: ScanModule, language: Language): readonly string[] {
  return reasonSentences(module, language).map((sentence) => sentence.text);
}

/**
 * Whose problem this row's reasons are, and whether the owner must act — one
 * short sentence per distinct answer, in the order the reasons are read.
 *
 * Distinct, because a partial AI run names several causes and most of them are
 * ours: repeating "this is on our side" four times under one card says less
 * than saying it once. Empty for a row whose reasons this build cannot place,
 * which is the honest answer rather than a guess.
 */
export function moduleResponsibilities(module: ScanModule, language: Language): readonly string[] {
  const t = copy[language].report.moduleResponsibility;
  const blames = reasonSentences(module, language).flatMap((sentence) =>
    sentence.key === null ? [] : (REASON_BLAME[sentence.key] ?? []),
  );
  return [...new Set(blames)].map((blame) => t[blame]);
}

/** Every sentence this row owes its reader, each with the reason it came from. */
function reasonSentences(module: ScanModule, language: Language): readonly ReasonSentence[] {
  const whole = module.statusReason?.trim() ?? '';
  if (whole === '') return [];

  // Taken off first and said last: it is the final clause, and the one before
  // it ends in free text that would otherwise absorb it.
  const evaluation = ANSWER_EVALUATION_CLAUSE.exec(whole);
  const reason = evaluation === null ? whole : whole.slice(0, evaluation.index).trim();
  const evaluated = evaluation === null ? [] : answerEvaluationSentences(evaluation, language);
  if (reason === '') return evaluated;

  const generation = QUERY_GENERATION_CLAUSE.exec(reason);
  if (generation === null) {
    return [...runSentences(reason, language), ...evaluated];
  }
  const [, kind = '', detail = ''] = generation;
  const run = reason.slice(0, generation.index).trim();
  return [
    ...(run === '' ? [] : runSentences(run, language)),
    ...queryGenerationSentences(kind, detail, language),
    ...evaluated,
  ];
}

/**
 * How many answers never reached a verdict, and why — never the raw token.
 *
 * The count first, then one sentence per distinct cause: the same shape the
 * partial-run reason uses, because a count with no explanation is not a reason
 * and folding the causes into one label is the defect this exists to fix.
 */
function answerEvaluationSentences(
  match: RegExpExecArray,
  language: Language,
): readonly ReasonSentence[] {
  const t = copy[language].report.moduleReason;
  const [, unavailable = '', total = '', causes = ''] = match;
  return [
    {
      key: 'aiEvaluationUnavailable',
      text: fillCopy(t.aiEvaluationUnavailable, { unavailable, total }),
    },
    ...distinctCauses(causes).map((cause) => sentenceFor(cause, language)),
  ];
}

/** The sentences for the run's own reason: the counted forms, or a token. */
function runSentences(reason: string, language: Language): readonly ReasonSentence[] {
  const t = copy[language].report.moduleReason;

  const counted = GEO_PARTIAL.exec(reason);
  if (counted !== null) {
    const [, unavailable = '', total = '', causes = ''] = counted;
    return [
      { key: 'aiPartial', text: fillCopy(t.aiPartial, { unavailable, total }) },
      ...distinctCauses(causes).map((cause) => sentenceFor(cause, language)),
    ];
  }
  const cancelled = GEO_CANCELLED.exec(reason);
  if (cancelled !== null) {
    const [, answered = '', total = ''] = cancelled;
    return [{ key: 'aiCancelled', text: fillCopy(t.aiCancelled, { answered, total }) }];
  }
  return [sentenceFor(reason, language)];
}

/**
 * The sentences for the question-generation clause.
 *
 * `Unavailable` carries the refusal token of the request that never left, and
 * that token has a sentence of its own. `InvalidResponse` carries a schema
 * validation message written for developers: it is deliberately not quoted —
 * the reader is told the generation failed, and the detail stays in the row.
 */
function queryGenerationSentences(
  kind: string,
  detail: string,
  language: Language,
): readonly ReasonSentence[] {
  const t = copy[language].report.moduleReason;
  if (kind === 'InvalidResponse') {
    return [
      {
        key: 'aiQueryGenerationInvalidResponse',
        text: t.aiQueryGenerationInvalidResponse,
      },
    ];
  }
  return [
    { key: 'aiQueryGenerationUnavailable', text: t.aiQueryGenerationUnavailable },
    sentenceFor(detail, language),
  ];
}

/** The causes inside a counted GEO reason, in the order they were first seen. */
function distinctCauses(causes: string): readonly string[] {
  const named = causes
    .split(',')
    .map((cause) => cause.trim())
    .filter((cause) => cause !== '');
  return [...new Set(named)];
}

function sentenceFor(reason: string, language: Language): ReasonSentence {
  const t = copy[language].report.moduleReason;
  const key = REASON_KEYS[reason];
  // A reason this build has no sentence for is still a fact about the scan:
  // quoting it beats both silence and a paraphrase the reader cannot check.
  if (key === undefined) return { key: 'unknown', text: fillCopy(t.unknown, { reason }) };
  return { key, text: t[key] };
}
