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
  // Analytics, written from the live Google connection state.
  AnalyticsIntegrationNotConnected: 'analyticsNotConnected',
  AnalyticsPropertyNotSelected: 'analyticsPropertyNotSelected',
  AnalyticsIntegrationNeedsReconnect: 'analyticsNeedsReconnect',
  AnalyticsPropertyAccessDenied: 'analyticsAccessDenied',
  AnalyticsNoDataForPeriod: 'analyticsNoData',
  AnalyticsProviderUnavailable: 'analyticsProviderUnavailable',
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
  const reason = module.statusReason?.trim() ?? '';
  if (reason === '') return [];

  const generation = QUERY_GENERATION_CLAUSE.exec(reason);
  if (generation === null) {
    return runSentences(reason, language);
  }
  const [, kind = '', detail = ''] = generation;
  const run = reason.slice(0, generation.index).trim();
  return [
    ...(run === '' ? [] : runSentences(run, language)),
    ...queryGenerationSentences(kind, detail, language),
  ];
}

/** The sentences for the run's own reason: the two counted forms, or a token. */
function runSentences(reason: string, language: Language): readonly string[] {
  const t = copy[language].report.moduleReason;

  const counted = GEO_PARTIAL.exec(reason);
  if (counted !== null) {
    const [, unavailable = '', total = '', causes = ''] = counted;
    return [
      fillCopy(t.aiPartial, { unavailable, total }),
      ...distinctCauses(causes).map((cause) => sentenceFor(cause, language)),
    ];
  }
  const cancelled = GEO_CANCELLED.exec(reason);
  if (cancelled !== null) {
    const [, answered = '', total = ''] = cancelled;
    return [fillCopy(t.aiCancelled, { answered, total })];
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
): readonly string[] {
  const t = copy[language].report.moduleReason;
  if (kind === 'InvalidResponse') {
    return [t.aiQueryGenerationInvalidResponse];
  }
  return [t.aiQueryGenerationUnavailable, sentenceFor(detail, language)];
}

/** The causes inside a counted GEO reason, in the order they were first seen. */
function distinctCauses(causes: string): readonly string[] {
  const named = causes
    .split(',')
    .map((cause) => cause.trim())
    .filter((cause) => cause !== '');
  return [...new Set(named)];
}

function sentenceFor(reason: string, language: Language): string {
  const t = copy[language].report.moduleReason;
  const key = REASON_KEYS[reason];
  // A reason this build has no sentence for is still a fact about the scan:
  // quoting it beats both silence and a paraphrase the reader cannot check.
  return key === undefined ? fillCopy(t.unknown, { reason }) : t[key];
}
