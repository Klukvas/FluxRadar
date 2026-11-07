// How a scan's machine status is spoken to the owner.
//
// The API's statuses (Pending/Queued/Running/Completed/Partial/Failed/Cancelled
// and the per-module Unavailable) are queue vocabulary, not product vocabulary.
// Every screen that shows one goes through here so a scan reads the same way in
// the progress window, in the reports list and on the report itself — and so a
// new locale is a translation, not another switch statement.

import { FREE_SCORE_MAX, freeScoreCopy, isFreeScale } from './free-score-copy';
import { copy, type Language } from './i18n';
import { isNotApplicable } from './module-status';
import type { ScanModule } from './api';

/** Statuses a scan never moves out of; the report is whatever it produced. */
export const TERMINAL_SCAN_STATUSES = ['Completed', 'Partial', 'Failed', 'Cancelled'] as const;

export function isTerminalScanStatus(status: string): boolean {
  return (TERMINAL_SCAN_STATUSES as readonly string[]).includes(status);
}

/** Whether a terminal scan produced a report worth opening. */
export function hasReadableReport(status: string): boolean {
  return status === 'Completed' || status === 'Partial';
}

/** One sentence about where a finished scan ended up. */
export function scanOutcomeLabel(status: string, language: Language): string {
  const t = copy[language].scanProgress;
  if (/partial/i.test(status)) return t.statusPartial;
  if (/failed/i.test(status)) return t.statusFailed;
  if (/cancelled/i.test(status)) return t.statusCancelled;
  if (/completed/i.test(status)) return t.ready;
  return t.statusFinished;
}

/** A short chip label for a scan in a list, where a sentence would not fit. */
export function scanStateLabel(status: string, language: Language): string {
  const t = copy[language].scanProgress;
  if (/partial/i.test(status)) return t.sectionPartial;
  if (/failed|cancelled/i.test(status)) return t.sectionUnavailable;
  if (/completed/i.test(status)) return t.moduleCompleted;
  if (/running/i.test(status)) return t.sectionChecking;
  return t.sectionWaiting;
}

/** What is happening to one audit section while the scan is still running. */
export function sectionStatusLabel(status: string, language: Language): string {
  const t = copy[language].scanProgress;
  // First, because it is the one status that is neither a step nor a result: a
  // section the plan lists but the product does not measure. It matched no rung
  // below and fell through to "Waiting", which read as a queue position for
  // work that was never going to start.
  if (isNotApplicable(status)) return t.sectionNotApplicable;
  if (/running/i.test(status)) return t.sectionChecking;
  if (/partial/i.test(status)) return t.sectionPartial;
  if (/completed|pass|ok|done/i.test(status)) return t.sectionChecked;
  if (/unavailable|failed|error/i.test(status)) return t.sectionUnavailable;
  return t.sectionWaiting;
}

/**
 * What one audit section produced, on a finished report.
 *
 * A section that ran to completion but could not read enough of the site is
 * reported as insufficient data rather than as a success — the difference is the
 * whole point of the coverage number next to it.
 */
export function moduleResultLabel(module: ScanModule, language: Language): string {
  const t = copy[language].scanProgress;
  // Ahead of the usable-output rung: nothing was attempted here, so there is no
  // shortfall of data to report and "Insufficient data" would be a complaint
  // about a site that was never asked anything.
  if (isNotApplicable(module.status)) return t.sectionNotApplicable;
  if (/unavailable|failed|error/i.test(module.status)) return t.moduleUnavailable;
  if (!module.usableOutput) return t.moduleInsufficient;
  if (/partial/i.test(module.status)) return t.sectionPartial;
  if (/completed|pass|ok|done/i.test(module.status)) return t.moduleCompleted;
  return sectionStatusLabel(module.status, language);
}

/**
 * The wire value a Free module row stored before D-236 used to say its plan
 * carried no score.
 *
 * Free now scores its homepage check (the row carries a number and
 * `scoreScope: 'homepage'`), so nothing writes this any more. Rows written
 * before that change are still within their retention window and still say it,
 * so it is read — and only read — here and by `isLegacyUnscoredReport`. The API
 * pins the literal as `LEGACY_FREE_CHECK_SCORING_REASON` (free-check.ts); the
 * web app does not depend on the contracts package, so it is matched as one.
 */
const NOT_SCORED_ON_PLAN = 'NotScoredOnFreePlan';

/** Whether a report predates the Free score: a row says its plan carried none. */
export function isLegacyUnscoredReport(modules: readonly ScanModule[]): boolean {
  return modules.some((module) => module.metadata?.scoring === NOT_SCORED_ON_PLAN);
}

/**
 * The wire value a module row uses to say its checks are informational.
 *
 * AI SEO / GEO asks a model questions and records what came back. None of its
 * rules penalize anything, so there is no measurement a 0–100 number could
 * report — the row used to carry a hardcoded 100 for every run the provider
 * answered at all, which told a Basic customer that 40% of their overall score
 * was earned by a successful HTTP response. This is the API's
 * `GEO_SCORING_REASON`, matched as a literal for the same reason as above.
 */
const INFORMATIONAL_ONLY = 'InformationalOnly';

/**
 * What one audit section puts where its score would go.
 *
 * Two unrelated facts produce a null score — the plan carries no score weight,
 * or the section produced nothing to score — and the card used to spell both of
 * them "No score". That is how a Free SEO section came to read "Completed ·
 * 100% · No score", leaving the owner to work out which of the three was the
 * lie.
 *
 * The plan is named as the reason only for a section that did produce a usable
 * result, because that is the only case where the plan is what deprived it of a
 * number: a section that could not be measured would carry no score on a paid
 * plan either, and its own status already says so. Everything else reports the
 * absence and nothing more — inventing the reason would be the same mistake as
 * inventing the score.
 */
export function moduleScoreLabel(module: ScanModule, language: Language): string {
  if (module.score !== null) {
    // A Free SEO score is shown out of 40 by the API (D-237): "39 / 40". A paid
    // one keeps its stored two decimals.
    return isFreeScale(module.scoreMax)
      ? freeScoreCopy[language].valueOverMax(Math.round(module.score), FREE_SCORE_MAX)
      : module.score.toFixed(2);
  }
  const t = copy[language].report;
  if (!module.usableOutput) {
    return t.noScore;
  }
  if (module.metadata?.scoring === NOT_SCORED_ON_PLAN) {
    return t.unscoredLabel;
  }
  // A section that did produce results and has nothing to score is saying so
  // about itself, not about the plan or about the site being unreadable.
  return module.metadata?.scoring === INFORMATIONAL_ONLY ? t.informationalLabel : t.noScore;
}

/**
 * The status string handed to `StatusChip` for its colour.
 *
 * The chip picks its colour by matching English keywords, so it is given the
 * API's own status and the localized text separately — a translated label must
 * change what the owner reads, never what the colour means.
 */
export function chipStatusFor(module: ScanModule): string {
  // Kept as itself so the chip and the card edge stay neutral: the design
  // system has no colour for "we did not look", and both the failure red and
  // the insufficient-data grey would claim something about the site.
  if (isNotApplicable(module.status)) return module.status;
  if (/unavailable|failed|error/i.test(module.status)) return 'Failed';
  if (!module.usableOutput) return 'Insufficient';
  return module.status;
}

/** A date the owner can read, or null when the API has no timestamp yet. */
export function formatTimestamp(value: string | null, language: Language): string | null {
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString(language === 'uk' ? 'uk-UA' : 'en-GB');
}

/** The hostname of a scanned origin; the raw value if it is not a URL. */
export function displayDomain(domain: string): string {
  try {
    return new URL(domain).hostname;
  } catch {
    return domain;
  }
}
