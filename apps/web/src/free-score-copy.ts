// How a Free report states its score (D-237).
//
// A Free check is a quick check of a few light homepage checks, so the API
// shows its score on its own scale, out of 40 (`scoreMax: 40`); a paid report
// reads the whole site and is shown out of 100. The caption says plainly that
// this is a quick check and that not everything was checked — never that points
// were lost — and the only "100" in it is the full audit's scale.
//
// The web app has no dependency on `packages/contracts`, so the numbers the
// static copy needs before any scan exists are mirrored here and held to the
// contract by `free-score-copy.test.ts`, which reads the contract source.

import { ruleCheckResult, ruleChecksOf } from './module-metadata';
import type { ScanModule } from './api';
import { ukCountForm, type Language } from './i18n';
import { ruCountForm } from './i18n.ru.grammar';
import type { PaidPlan } from './plan-modules';
import { COMPLETE_PRICE } from './tariff-prices';

/** Mirrors `FULL_SCORE_MAX` in packages/contracts/src/free-score.ts: the full audit's scale. */
export const FULL_SCORE_MAX = 100;

/** Mirrors `FREE_SCORE_MAX` in packages/contracts/src/free-score.ts: the Free scale. */
export const FREE_SCORE_MAX = 40;

/** Mirrors `FREE_CHECK_RULE_IDS.length` in packages/contracts/src/tariffs.ts. */
export const FREE_CHECK_COUNT = 6;

/** Where the call to action beside a Free score leads: the whole-site audit. */
export const FREE_SCORE_UPGRADE_PLAN: PaidPlan = 'Complete';

/** Whether the API showed this score on the Free scale (out of 40). */
export function isFreeScale(scoreMax: number | undefined): boolean {
  return scoreMax === FREE_SCORE_MAX;
}

/**
 * Whether a finding may print its stored 0–100 penalty ("lowers this section's
 * score by 6.25"). On a Free report the score is shown out of 40, so the stored
 * penalty would not add up to anything the reader can see.
 */
export function showsRulePenalty(plan: string | undefined): boolean {
  return plan !== 'Free';
}

/**
 * How many checks this Free report's own SEO row says it ran — what the stored
 * scan actually did — or the current count when the row does not list them.
 */
export function freeCheckCountOf(modules: readonly ScanModule[]): number {
  const metadata = modules.find((module) => module.module === 'SEO')?.metadata;
  const recorded = ruleChecksOf(metadata);
  if (recorded.length > 0) return recorded.length;
  const checks = metadata?.checks;
  return Array.isArray(checks) && checks.length > 0 ? checks.length : FREE_CHECK_COUNT;
}

/** Only saved per-check outcomes can say how many checks found issues. */
export function freeIssueCheckCountOf(modules: readonly ScanModule[]): number | null {
  const seo = modules.find((module) => module.module === 'SEO');
  const checks = ruleChecksOf(seo?.metadata);
  const recorded = seo?.metadata?.ruleChecks;
  if (
    seo?.status !== 'Completed' ||
    !seo.usableOutput ||
    checks.length === 0 ||
    !Array.isArray(recorded) ||
    recorded.length !== checks.length ||
    (seo.completedApplicableChecks !== null && checks.length < seo.completedApplicableChecks)
  )
    return null;
  return checks.filter((check) => ruleCheckResult(check) === 'issues').length;
}

/** Counted after a colon: «1 легка перевірка», «2 легкі перевірки», «6 легких перевірок». */
const ukLightChecks = (count: number): string =>
  ukCountForm(count, 'легка перевірка', 'легкі перевірки', 'легких перевірок');

/** Counted after a colon: «1 лёгкая проверка», «2 лёгкие проверки», «6 лёгких проверок». */
const ruLightChecks = (count: number): string =>
  ruCountForm(count, 'лёгкая проверка', 'лёгкие проверки', 'лёгких проверок');

/** «з 40», but «зі 100» — the preposition the number is read with. */
const ukOutOf = (max: number): string => (max === 100 ? 'зі' : 'з');

export interface FreeScoreCopy {
  /** What the number is a score of: the homepage, never the whole site. */
  readonly homepageScore: string;
  /** "39 / 40" — how the number is printed. */
  readonly valueOverMax: (value: number, max: number) => string;
  /** "39 of 40" — how the number is announced. */
  readonly valueOfMax: (value: number, max: number) => string;
  /**
   * The full quick-check statement — scored out of 40, the full audit out of
   * 100 — for the report help only ("How to read this report").
   */
  readonly capRule: (checks: number, max: number, fullMax: number) => string;
  /**
   * The one short line inside the dial. The owner found the full statement too
   * long there; the button under the dial carries the full-audit promise.
   */
  readonly capDisclosure: (checks: number) => string;
  /** The primary call to action under the dial; `fullMax` is the full audit's scale. */
  readonly upgrade: (fullMax: number) => string;
  /** Help text for a homepage score not on the Free scale (an older API). */
  readonly homepageOnly: string;
}

export const freeScoreCopy: Readonly<Record<Language, FreeScoreCopy>> = {
  en: {
    homepageScore: 'Homepage score',
    valueOverMax: (value, max) => `${value} / ${max}`,
    valueOfMax: (value, max) => `${value} of ${max}`,
    // Stands alone (report help, a dial with no number), so it names its subject.
    capRule: (checks, max, fullMax) =>
      `The free check is a quick check: ${checks} light checks on the homepage only, scored out of ${max}. Not everything is checked. The full audit checks the whole site and scores it out of ${fullMax}.`,
    capDisclosure: (checks) =>
      `Quick check: ${checks} light checks on the homepage only. Not everything is checked.`,
    upgrade: (fullMax) =>
      `Complete · ${COMPLETE_PRICE} one-time: whole-site audit (scored out of ${fullMax})`,
    homepageOnly: 'A rating of your homepage only, not of the whole site.',
  },
  uk: {
    homepageScore: 'Оцінка головної сторінки',
    valueOverMax: (value, max) => `${value} / ${max}`,
    valueOfMax: (value, max) => `${value} ${ukOutOf(max)} ${max}`,
    capRule: (checks, max, fullMax) =>
      `Безкоштовна перевірка — це швидка перевірка: ${checks} ${ukLightChecks(checks)} лише головної сторінки з оцінкою ${ukOutOf(max)} ${max}. Перевірено не все. Повний аудит перевіряє весь сайт і оцінює його за шкалою ${ukOutOf(fullMax)} ${fullMax}.`,
    capDisclosure: (checks) =>
      `Швидка перевірка: ${checks} ${ukLightChecks(checks)} лише головної сторінки. Перевірено не все.`,
    upgrade: (fullMax) =>
      `Complete · ${COMPLETE_PRICE} разово: перевірити весь сайт (оцінка ${ukOutOf(fullMax)} ${fullMax})`,
    homepageOnly: 'Оцінка лише головної сторінки, а не всього сайту.',
  },
  ru: {
    homepageScore: 'Оценка главной страницы',
    valueOverMax: (value, max) => `${value} / ${max}`,
    valueOfMax: (value, max) => `${value} из ${max}`,
    capRule: (checks, max, fullMax) =>
      `Проверка Free быстрая: ${checks} ${ruLightChecks(checks)} только главной страницы с оценкой из ${max}. Проверено не всё. Полный аудит проверяет весь сайт и оценивает его по шкале из ${fullMax}.`,
    capDisclosure: (checks) =>
      `Быстрая проверка: ${checks} ${ruLightChecks(checks)} только главной страницы. Проверено не всё.`,
    upgrade: (fullMax) =>
      `Complete · ${COMPLETE_PRICE} разово: проверить весь сайт (оценка из ${fullMax})`,
    homepageOnly: 'Оценка только главной страницы, а не всего сайта.',
  },
};

/** What the score dial needs to print a number out of a stated maximum. */
export interface ScoreScale {
  readonly max: number;
  /** Printed after the number: "/ 40" on a Free report. */
  readonly suffix: string;
  /** Announced as the meter's value: "39 of 40". */
  readonly valueText: string;
  /** Decimals printed in the number; a Free score is whole, a full audit keeps its two. */
  readonly digits?: number;
}

export interface FreeDialProps {
  readonly label: string;
  readonly scale?: ScoreScale;
  readonly note?: string;
}

interface ShownOverall {
  readonly score: number | null;
  readonly scoreMax?: number;
}

/**
 * What a Free report's dial says around its number. A response from an API
 * that predates the Free scale carries no `scoreMax: 40`; its number is printed
 * as it came, under the homepage label, with no claim about a scale.
 */
export function freeDialProps(
  overall: ShownOverall,
  modules: readonly ScanModule[],
  language: Language,
): FreeDialProps {
  const t = freeScoreCopy[language];
  if (!isFreeScale(overall.scoreMax)) {
    return { label: t.homepageScore };
  }
  const max = FREE_SCORE_MAX;
  const checks = freeCheckCountOf(modules);
  if (overall.score === null) {
    return { label: t.homepageScore, note: t.capDisclosure(checks) };
  }
  const value = Math.round(overall.score);
  return {
    label: t.homepageScore,
    scale: { max, suffix: `/ ${max}`, valueText: t.valueOfMax(value, max) },
    note: t.capDisclosure(checks),
  };
}

/** The report help's line for a Free score: the quick-check statement, on the Free scale. */
export function freeScoreHelp(overall: ShownOverall, checks: number, language: Language): string {
  const t = freeScoreCopy[language];
  return isFreeScale(overall.scoreMax)
    ? t.capRule(checks, FREE_SCORE_MAX, FULL_SCORE_MAX)
    : t.homepageOnly;
}

/**
 * The full audit's score stated on its own scale, "79.00 / 100", so a paid
 * report names its maximum the way a Free one does. The precision stays: the
 * full audit's score is reported to two decimals everywhere else.
 */
export function fullScoreScale(score: number): ScoreScale {
  const digits = 2;
  return {
    max: FULL_SCORE_MAX,
    suffix: `/ ${FULL_SCORE_MAX}`,
    // The meter's maximum is announced by `max`; the text stays the number the
    // report has always read out.
    valueText: score.toFixed(digits),
    digits,
  };
}
