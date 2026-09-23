// The languages an Action Plan (D-232) can be written in.
//
// `apps/web` deliberately has no workspace dependency, so the same list is
// declared twice: the picker's ISO 639-1 codes in `apps/web/src/target-languages.ts`
// and this server-side copy, which the API validates `language` against. An
// API-side contract test reads the web file and fails when the two drift.

export const ACTION_PLAN_LANGUAGES = [
  'uk',
  'en',
  'ru',
  'pl',
  'de',
  'fr',
  'es',
  'it',
  'pt',
  'nl',
  'cs',
  'sk',
  'ro',
  'hu',
  'bg',
  'lt',
  'lv',
  'et',
  'fi',
  'sv',
  'no',
  'da',
  'el',
  'tr',
  'he',
  'ar',
  'hi',
  'zh',
  'ja',
  'ko',
] as const;

export type ActionPlanLanguage = (typeof ACTION_PLAN_LANGUAGES)[number];

export function isActionPlanLanguage(value: string): value is ActionPlanLanguage {
  return (ACTION_PLAN_LANGUAGES as readonly string[]).includes(value);
}

/** At most this many Actions in one plan (D-232); the model is told the same. */
export const ACTION_PLAN_MAX_ACTIONS = 7;

/** Per-scan-snapshot and per-account/product spend limits (D-232). */
export const ACTION_PLAN_LIMITS = {
  maxSuccessesPerScan: 3,
  maxAttemptsPerScan: 6,
  /** A claimed run older than this is stale and may be taken over. */
  staleRunMs: 5 * 60 * 1000,
  /** Plan Window: generation is allowed this long after the latest run finished. */
  windowMs: 3 * 24 * 60 * 60 * 1000,
  maxStartsPerAccountPerHour: 10,
  maxGenerationsPerProductPerDay: 100,
  /**
   * How far back the two row-counting caps look. Named rather than spelled out
   * where they are counted, because retention reads them too: a spend-log row
   * that outlived its scan is kept exactly as long as it can still refuse a
   * generation (`apps/api/src/data-retention.ts`).
   */
  accountStartWindowMs: 60 * 60 * 1000,
  productGenerationWindowMs: 24 * 60 * 60 * 1000,
} as const;
