// What a scan's status and its `status_reason` say in the document's language.
//
// The API writes both as machine vocabulary — `Partial`,
// `PerformanceSamplesIncomplete`, `AnalyticsPropertyNotSelected` — and the
// document used to print them verbatim, so a Ukrainian report's Sections table
// read "Partial · PerformanceSamplesIncomplete". The browser report has spoken
// these in the reader's language since `apps/web/src/module-status.ts`; this is
// the same idea for the deliverable a customer keeps.
//
// THE CLAUSES HERE ARE SHORT ON PURPOSE. They go in a table cell next to the
// status, not in a paragraph: they state the same fact as the browser report's
// sentence in the fewest words that stay true, rather than being a second copy
// of that sentence which would drift from it line by line. The vocabulary of
// keys is the producing side's own — `orchestrator/module-result.ts`,
// `orchestrator/performance-module.ts`, `orchestrator/analytics/module-row.ts`,
// `orchestrator/geo.ts`, `billing/constants.ts` and the AI refusals in
// `packages/ai/src/run-request.ts` — and `status-text.test.ts` reads those
// producers' own constants to prove every token they can write has copy here.
//
// A reason this build has no clause for is quoted rather than paraphrased: an
// unknown token is still a fact about the scan, and guessing at its meaning
// would be worse than naming it.

import type { FindingLanguage } from '@fluxradar/rules';

interface StatusCopy {
  /** The scan's own outcome, on the cover page. */
  readonly scanStatus: Readonly<Record<string, string>>;
  /** One audit section's outcome, in the Sections table. */
  readonly moduleStatus: Readonly<Record<string, string>>;
  /**
   * Where one finding stands. The same words the Issue Center uses
   * (`apps/web/src/findings-copy.ts`), so a finding a reader marked there is not
   * described differently in the file they downloaded.
   */
  readonly issueStatus: Readonly<Record<string, string>>;
  readonly reason: {
    // Crawl coverage, shared by every rules module.
    readonly noApplicableTargets: string;
    readonly targetsUnreachable: string;
    readonly targetsPartiallyUnreachable: string;
    readonly noDeterministicOracle: string;
    readonly platformFailure: string;
    readonly platformFailureBeforeCompletion: string;
    // Performance, measured by an external service.
    readonly performanceNotConfigured: string;
    readonly performanceScoreUnavailable: string;
    readonly performanceSamplesIncomplete: string;
    readonly performanceProviderUnavailable: string;
    // AI SEO / GEO refusals: the request never left FluxRadar.
    readonly aiConsentMissing: string;
    readonly aiRedactionBlocked: string;
    readonly aiQuotaExceeded: string;
    readonly aiProviderUnavailable: string;
    readonly aiProviderContract: string;
    readonly aiEmptyQuestionLibrary: string;
    readonly aiProfileContextMissing: string;
    // Analytics, written from the live Google connection state.
    readonly analyticsNotConnected: string;
    readonly analyticsPropertyNotSelected: string;
    readonly analyticsNeedsReconnect: string;
    readonly analyticsAccessDenied: string;
    readonly analyticsNoData: string;
    readonly analyticsProviderUnavailable: string;
    // Scan-level outcomes written by the billing state machine.
    readonly cancelledBeforeQueue: string;
    readonly cancelledAfterQueue: string;
    readonly cancelledAfterStart: string;
    readonly pausedBeforeQueue: string;
    readonly pausedAfterQueue: string;
    readonly pausedAfterStart: string;
    readonly scanCancelled: string;
    readonly noUsableOutput: string;
    readonly externalModuleFailure: string;
    readonly incompleteChecks: string;
  };
  /** The AI-assisted UX review, which reuses the AI refusal clauses. */
  readonly uxAiReason: (clause: string) => string;
  /** A GEO run where only some of the questions could be asked. */
  readonly aiPartial: (unavailable: string, total: string) => string;
  /** A GEO run stopped by the owner after some questions had been answered. */
  readonly geoCancelledPartial: (answered: string, asked: string) => string;
  readonly unknownReason: (reason: string) => string;
}

const EN: StatusCopy = {
  scanStatus: {
    Pending: 'Waiting',
    Queued: 'Queued',
    Running: 'Running',
    Partial: 'Partly complete',
    Completed: 'Completed',
    Failed: 'Failed',
    Cancelled: 'Cancelled',
    Paused: 'Paused',
  },
  moduleStatus: {
    Pending: 'Waiting',
    Running: 'Checking',
    Completed: 'Completed',
    Partial: 'Checked with limits',
    Unavailable: 'Unavailable',
    'Not applicable': 'Not applicable',
  },
  issueStatus: {
    New: 'New',
    Acknowledged: 'Acknowledged',
    Ignored: 'Ignored',
    'False Positive': 'False positive',
    Resolved: 'Resolved',
    Reopened: 'Reopened',
  },
  reason: {
    noApplicableTargets: 'nothing on the pages read matched the checks in this section',
    targetsUnreachable: 'none of the pages FluxRadar tried to read responded',
    targetsPartiallyUnreachable: 'some of the pages FluxRadar tried to read did not respond',
    noDeterministicOracle: 'FluxRadar has no evidence-based check for this area yet',
    platformFailure: 'the audit itself failed while this section was running',
    platformFailureBeforeCompletion: 'the audit stopped before this section finished',
    performanceNotConfigured: 'no performance measurement service is configured here',
    performanceScoreUnavailable: 'the performance service returned no overall score',
    // The coverage column beside this one already states the shortfall, so the
    // clause spends its words on the part a reader cannot see there: what is
    // shown was measured, not estimated.
    performanceSamplesIncomplete:
      'some measurement runs did not finish; everything shown was measured for real',
    performanceProviderUnavailable: 'the performance measurement service did not answer',
    aiConsentMissing: 'this scan has no recorded AI-processing notice',
    aiRedactionBlocked: 'the request was stopped before anything was sent to the AI provider',
    aiQuotaExceeded: 'this plan’s allowance of AI questions was already used',
    aiProviderUnavailable: 'the AI provider is not configured here, or did not answer',
    aiProviderContract: 'the AI answer failed FluxRadar’s evidence contract and was discarded',
    aiEmptyQuestionLibrary: 'no AI questions were prepared for this scan',
    aiProfileContextMissing: 'the profile carries no context to build the AI questions from',
    analyticsNotConnected: 'Google is not connected for this workspace',
    analyticsPropertyNotSelected: 'no Search Console or Analytics 4 property is linked yet',
    analyticsNeedsReconnect: 'Google access has expired or was revoked',
    analyticsAccessDenied: 'the connected Google account cannot read the linked property',
    analyticsNoData: 'Google reports no data for this site in the period covered',
    analyticsProviderUnavailable: 'Google did not answer while this report was built',
    cancelledBeforeQueue: 'cancelled before the scan was queued',
    cancelledAfterQueue: 'cancelled after the scan was queued',
    cancelledAfterStart: 'cancelled after the scan had started',
    scanCancelled:
      'you stopped this audit before the section finished, so it was stopped where it stood',
    pausedBeforeQueue: 'paused by you before the scan was queued; it can be resumed',
    pausedAfterQueue: 'paused by you after the scan was queued; it can be resumed',
    pausedAfterStart: 'paused by you after the scan had started; it continues where it stopped',
    noUsableOutput: 'no section produced a usable result',
    externalModuleFailure: 'an external service cost this scan at least one section',
    incompleteChecks: 'not every applicable check could be closed',
  },
  uxAiReason: (clause) => `the AI-assisted UX review did not run — ${clause}`,
  aiPartial: (unavailable, total) => `${unavailable} of ${total} AI requests could not be made`,
  geoCancelledPartial: (answered, asked) =>
    `stopped by you after ${answered} of ${asked} questions had been answered`,
  unknownReason: (reason) => `reason recorded by the audit: ${reason}`,
};

const UK: StatusCopy = {
  scanStatus: {
    Pending: 'Очікує',
    Queued: 'У черзі',
    Running: 'Виконується',
    Partial: 'Завершено частково',
    Completed: 'Завершено',
    Failed: 'Не вдалося',
    Cancelled: 'Скасовано',
    Paused: 'Призупинено',
  },
  moduleStatus: {
    Pending: 'Очікує',
    Running: 'Перевіряємо',
    Completed: 'Завершено',
    Partial: 'Перевірено з обмеженнями',
    Unavailable: 'Недоступно',
    'Not applicable': 'Не застосовується',
  },
  issueStatus: {
    New: 'Нова',
    Acknowledged: 'Прийнята',
    Ignored: 'Ігнорується',
    'False Positive': 'Хибна',
    Resolved: 'Виправлена',
    Reopened: 'Повернулася',
  },
  reason: {
    noApplicableTargets:
      'на прочитаних сторінках немає нічого, що підпадає під перевірки цього розділу',
    targetsUnreachable: 'жодна зі сторінок, які FluxRadar намагався прочитати, не відповіла',
    targetsPartiallyUnreachable:
      'частина сторінок, які FluxRadar намагався прочитати, не відповіла',
    noDeterministicOracle: 'у FluxRadar поки немає перевірки з доказами для цієї області',
    platformFailure: 'сам аудит зупинився з помилкою, поки виконувався цей розділ',
    platformFailureBeforeCompletion: 'аудит зупинився, перш ніж цей розділ завершився',
    performanceNotConfigured: 'у цьому розгортанні не налаштовано сервіс вимірювання швидкодії',
    performanceScoreUnavailable: 'сервіс швидкодії не повернув загальної оцінки',
    performanceSamplesIncomplete:
      'частина вимірювальних запусків не завершилася; усе показане виміряно насправді',
    performanceProviderUnavailable: 'сервіс вимірювання швидкодії не відповів',
    aiConsentMissing: 'для цієї перевірки немає запису про повідомлення щодо AI-обробки',
    aiRedactionBlocked: 'запит зупинено до того, як щось було надіслано постачальнику AI',
    aiQuotaExceeded: 'ліміт AI-запитів цього тарифу вже вичерпано',
    aiProviderUnavailable: 'постачальника AI не налаштовано тут або він не відповів',
    aiProviderContract: 'відповідь AI не пройшла контракт доказів FluxRadar і її відхилено',
    aiEmptyQuestionLibrary: 'для цієї перевірки не підготовлено жодного AI-питання',
    aiProfileContextMissing: 'у профілі немає контексту, з якого будувати AI-питання',
    analyticsNotConnected: 'Google не підключено для цього робочого простору',
    analyticsPropertyNotSelected: 'ще не вибрано ресурс Search Console або Analytics 4',
    analyticsNeedsReconnect: 'доступ до Google завершився або його відкликано',
    analyticsAccessDenied: 'підключений акаунт Google не може читати вибраний ресурс',
    analyticsNoData: 'Google не повідомляє даних про цей сайт за охоплений період',
    analyticsProviderUnavailable: 'Google не відповів, поки формувався цей звіт',
    cancelledBeforeQueue: 'скасовано до постановки перевірки в чергу',
    cancelledAfterQueue: 'скасовано після постановки перевірки в чергу',
    cancelledAfterStart: 'скасовано після початку перевірки',
    scanCancelled:
      'ви зупинили цю перевірку до завершення розділу, тож її спинено там, де вона була',
    pausedBeforeQueue: 'ви призупинили її до постановки в чергу; перевірку можна продовжити',
    pausedAfterQueue: 'ви призупинили її після постановки в чергу; перевірку можна продовжити',
    pausedAfterStart: 'ви призупинили її після початку; перевірка продовжиться з того ж місця',
    noUsableOutput: 'жоден розділ не дав придатного результату',
    externalModuleFailure: 'через зовнішній сервіс ця перевірка втратила щонайменше один розділ',
    incompleteChecks: 'вдалося закрити не всі застосовні перевірки',
  },
  uxAiReason: (clause) => `AI-огляд UX не виконано — ${clause}`,
  aiPartial: (unavailable, total) => `${unavailable} з ${total} AI-запитів не вдалося виконати`,
  geoCancelledPartial: (answered, asked) =>
    `ви зупинили перевірку після ${answered} із ${asked} відповідей на запитання`,
  unknownReason: (reason) => `причина, записана аудитом: ${reason}`,
};

const STATUS_COPY: Readonly<Record<FindingLanguage, StatusCopy>> = { en: EN, uk: UK };

type ReasonKey = keyof StatusCopy['reason'];

/** Wire reason → the clause that explains it. */
const REASON_KEYS: Readonly<Record<string, ReasonKey | undefined>> = {
  NoApplicableTargets: 'noApplicableTargets',
  TargetsUnreachable: 'targetsUnreachable',
  TargetsPartiallyUnreachable: 'targetsPartiallyUnreachable',
  NoDeterministicOracle: 'noDeterministicOracle',
  PlatformFailure: 'platformFailure',
  PlatformFailureBeforeCompletion: 'platformFailureBeforeCompletion',
  PerformanceIntegrationNotConfigured: 'performanceNotConfigured',
  PerformanceScoreUnavailable: 'performanceScoreUnavailable',
  PerformanceSamplesIncomplete: 'performanceSamplesIncomplete',
  PerformanceProviderUnavailable: 'performanceProviderUnavailable',
  ConsentMissing: 'aiConsentMissing',
  RedactionBlocked: 'aiRedactionBlocked',
  QuotaExceeded: 'aiQuotaExceeded',
  ProviderUnavailable: 'aiProviderUnavailable',
  ProviderContract: 'aiProviderContract',
  EmptyQuestionLibrary: 'aiEmptyQuestionLibrary',
  ProfileContextMissing: 'aiProfileContextMissing',
  AnalyticsIntegrationNotConnected: 'analyticsNotConnected',
  AnalyticsPropertyNotSelected: 'analyticsPropertyNotSelected',
  AnalyticsIntegrationNeedsReconnect: 'analyticsNeedsReconnect',
  AnalyticsPropertyAccessDenied: 'analyticsAccessDenied',
  AnalyticsNoDataForPeriod: 'analyticsNoData',
  AnalyticsProviderUnavailable: 'analyticsProviderUnavailable',
  UserCancelledPreQueue: 'cancelledBeforeQueue',
  UserCancelledAfterQueue: 'cancelledAfterQueue',
  UserCancelledAfterStart: 'cancelledAfterStart',
  ScanCancelled: 'scanCancelled',
  UserPausedBeforeQueue: 'pausedBeforeQueue',
  UserPausedAfterQueue: 'pausedAfterQueue',
  UserPausedAfterStart: 'pausedAfterStart',
  NoUsableOutput: 'noUsableOutput',
  ExternalModuleFailure: 'externalModuleFailure',
  IncompleteChecks: 'incompleteChecks',
};

/**
 * The UX module reports an AI refusal under its own prefix
 * (`orchestrator/run-attempt.ts` writes `UxAi${reason}`), so the refusal keeps
 * one clause and the prefix says which review it stopped.
 */
const UX_AI_PREFIX = 'UxAi';

/**
 * A GEO run where some questions were answered and some were refused, as
 * `packages/ai/src/geo-module.ts` assembles it — a count and the causes in
 * brackets. Matched, not rebuilt: if that lane changes the wording, this stops
 * matching and the reason is quoted instead of being mistranslated.
 */
const AI_PARTIAL = /^(\d+) of (\d+) AI requests unavailable \(([^)]*)\)$/;

/**
 * A GEO run the owner stopped partway, from `geo-module-row.ts`.
 *
 * The count is the point: two of five questions answered is a partial result
 * that was paid for, and the document that drops the numbers reads as if
 * nothing was asked at all.
 */
const GEO_CANCELLED = /^ScanCancelled: (\d+) of (\d+) questions answered$/;

/** The scan's outcome as the cover page states it, reason included. */
export function scanStatusText(
  scan: { readonly status: string; readonly statusReason: string | null },
  language: FindingLanguage,
): string {
  const label = STATUS_COPY[language].scanStatus[scan.status] ?? scan.status;
  return withReason(label, scan.statusReason, language);
}

/** One audit section's result as the Sections table states it. */
export function moduleResultText(
  module: { readonly runtimeStatus: string; readonly statusReason: string | null },
  language: FindingLanguage,
): string {
  const label = STATUS_COPY[language].moduleStatus[module.runtimeStatus] ?? module.runtimeStatus;
  return withReason(label, module.statusReason, language);
}

/** Where one finding stands, as the finding block states it. */
export function issueStatusText(status: string, language: FindingLanguage): string {
  return STATUS_COPY[language].issueStatus[status] ?? status;
}

function withReason(label: string, reason: string | null, language: FindingLanguage): string {
  const stated = statusReasonText(reason, language);
  return stated === null ? label : `${label} · ${stated}`;
}

/**
 * One machine reason in the reader's language, or null when there is none.
 *
 * Exported for the tests that hold this file to the producers' vocabulary; the
 * document itself goes through the two functions above.
 */
export function statusReasonText(reason: string | null, language: FindingLanguage): string | null {
  const token = reason?.trim() ?? '';
  if (token === '') return null;
  const copy = STATUS_COPY[language];

  const cancelled = GEO_CANCELLED.exec(token);
  if (cancelled !== null) {
    const [, answered = '', asked = ''] = cancelled;
    return copy.geoCancelledPartial(answered, asked);
  }

  const counted = AI_PARTIAL.exec(token);
  if (counted !== null) {
    const [, unavailable = '', total = '', causes = ''] = counted;
    const named = distinctCauses(causes).map((cause) => clauseFor(cause, language));
    return [copy.aiPartial(unavailable, total), ...named].join('; ');
  }
  return clauseFor(token, language);
}

/** The causes inside a counted GEO reason, in the order they were first seen. */
function distinctCauses(causes: string): readonly string[] {
  const named = causes
    .split(',')
    .map((cause) => cause.trim())
    .filter((cause) => cause !== '');
  return [...new Set(named)];
}

function clauseFor(token: string, language: FindingLanguage): string {
  const copy = STATUS_COPY[language];
  const key = REASON_KEYS[token];
  if (key !== undefined) return copy.reason[key];

  const uxAiKey = token.startsWith(UX_AI_PREFIX)
    ? REASON_KEYS[token.slice(UX_AI_PREFIX.length)]
    : undefined;
  if (uxAiKey !== undefined) return copy.uxAiReason(copy.reason[uxAiKey]);

  return copy.unknownReason(token);
}
