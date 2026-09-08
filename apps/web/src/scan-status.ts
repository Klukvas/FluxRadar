// How a scan's machine status is spoken to the owner.
//
// The API's statuses (Pending/Queued/Running/Completed/Partial/Failed/Cancelled
// and the per-module Unavailable) are queue vocabulary, not product vocabulary.
// Every screen that shows one goes through here so a scan reads the same way in
// the progress window, in the reports list and on the report itself — and so a
// new locale is a translation, not another switch statement.

import { copy, type Language } from './i18n';
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
  if (/unavailable|failed|error/i.test(module.status)) return t.moduleUnavailable;
  if (!module.usableOutput) return t.moduleInsufficient;
  if (/partial/i.test(module.status)) return t.sectionPartial;
  if (/completed|pass|ok|done/i.test(module.status)) return t.moduleCompleted;
  return sectionStatusLabel(module.status, language);
}

/**
 * The wire value a module row uses to say its plan carries no score.
 *
 * §15/§16 forbid an ordinary `Completed` module from carrying a status_reason,
 * so the reason a Free row has no number travels in the row's own metadata
 * instead. This is the API's `FREE_CHECK_SCORING_REASON`, matched as a literal
 * because the web app does not depend on the contracts package; the producing
 * side pins the same string in free-check-metadata.test.ts.
 */
const NOT_SCORED_ON_PLAN = 'NotScoredOnFreePlan';

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
    return module.score.toFixed(2);
  }
  const t = copy[language].report;
  return module.usableOutput && module.metadata?.scoring === NOT_SCORED_ON_PLAN
    ? t.unscoredLabel
    : t.noScore;
}

/**
 * The status string handed to `StatusChip` for its colour.
 *
 * The chip picks its colour by matching English keywords, so it is given the
 * API's own status and the localized text separately — a translated label must
 * change what the owner reads, never what the colour means.
 */
export function chipStatusFor(module: ScanModule): string {
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
