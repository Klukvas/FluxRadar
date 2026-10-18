// What a running scan is doing right now, read off the fields the scan already
// carries.
//
// The progress window used to say "preparing the audit sections" until the
// first section finished, which on a large crawl was most of the run. The
// worker does its work in a fixed order — the scan waits in the queue, the
// crawl reads the pages while every section sits Pending, then the sections run
// one at a time — so the stage can be told from `status`, the module rows and
// the page counter without asking the API for anything new.

import type { Scan } from './api';
import { isTerminalScanStatus } from './scan-status';

export type ProgressStage =
  | { readonly kind: 'queued' }
  | { readonly kind: 'resuming' }
  | { readonly kind: 'reading' }
  /** `module` is null between two sections, when none is running yet. */
  | { readonly kind: 'checking'; readonly module: string | null }
  | { readonly kind: 'finishing' };

/** Where the scan is, in the order the worker runs it. */
export function progressStage(scan: Scan): ProgressStage {
  // A legacy paused scan, from before the pause feature was removed: the
  // server puts it back in the queue on its own.
  if (scan.status === 'Paused') return { kind: 'resuming' };
  if (scan.status === 'Pending' || scan.status === 'Queued') return { kind: 'queued' };
  if (isTerminalScanStatus(scan.status)) return { kind: 'finishing' };
  return workStage(scan);
}

function workStage(scan: Scan): ProgressStage {
  const running = scan.modules.find((module) => module.status === 'Running');
  if (running !== undefined) return { kind: 'checking', module: running.module };
  const { completedModules, totalModules } = scan.progress;
  // Also the first seconds of a section retry: the API flips Partial→Running
  // and only enqueues, and the rows stay terminal until the worker claims the
  // job and resets them to Pending, so the screen briefly says the report is
  // being put together before the retried section shows up.
  if (totalModules > 0 && completedModules >= totalModules) return { kind: 'finishing' };
  // A resumed attempt that continues its crawl also lands here: some sections
  // settled before, none runs yet, and the headline says we are checking what
  // was read while the crawl still reads. Accepted: it is true of the pages
  // already read, and it never claims a stage the scan has left behind.
  if (completedModules > 0) return { kind: 'checking', module: null };
  return { kind: 'reading' };
}

// The bar's bands, in percent. Reading the site is the part whose length
// nobody can predict, so it gets the first stretch; the sections share the
// middle; the last few percent are the report being put together. Only a
// terminal scan ever shows 100.
const READING_START = 5;
const READING_END = 40;
const CHECKS_END = 95;
const FINISHING = 97;
/**
 * Pages read at which the reading band is half full. The crawl's total is not
 * known while it runs (`discoveredUrls` keeps growing), so the band fills as
 * `read / (read + PAGES_AT_HALF)`: it moves on every page, slows down on a big
 * site, and never reaches the end of its band on its own.
 */
const PAGES_AT_HALF = 25;
/** A running section counts as half done, so the bar moves when one starts. */
const RUNNING_SECTION_SHARE = 0.5;

/**
 * How full the live bar is, 0–99, for a scan that has not finished.
 *
 * queued → 0; reading → 5 + 35 × read/(read + 25), so 1 page ≈ 6%, 25 pages
 * ≈ 22%, 200 pages ≈ 36%; checking → 40 + 55 × (sections done + ½ for the one
 * running) / all sections; finishing → 97. Each input only grows during a run,
 * and `nextLiveProgress` keeps the highest value shown within one attempt.
 */
export function liveProgressPercent(scan: Scan): number {
  const stage = scan.status === 'Paused' ? workStage(scan) : progressStage(scan);
  switch (stage.kind) {
    case 'queued':
    case 'resuming':
      return 0;
    case 'reading': {
      const read = Math.max(0, scan.progress.scannedUrls ?? 0);
      return Math.round(
        READING_START + (READING_END - READING_START) * (read / (read + PAGES_AT_HALF)),
      );
    }
    case 'checking': {
      const { completedModules, totalModules } = scan.progress;
      if (totalModules === 0) return READING_END;
      const running = stage.module === null ? 0 : RUNNING_SECTION_SHARE;
      const done = Math.min(1, (completedModules + running) / totalModules);
      return Math.round(READING_END + (CHECKS_END - READING_END) * done);
    }
    case 'finishing':
      return FINISHING;
  }
}

/** A finished scan's bar: the share of its sections that settled. */
export function finishedProgressPercent(scan: Scan): number {
  const { completedModules, totalModules } = scan.progress;
  return totalModules === 0 ? 0 : (completedModules / totalModules) * 100;
}

/** Rows the API counts as settled (`TERMINAL_MODULE_STATUSES` in scan-dto.ts). */
const SETTLED_MODULE_STATUSES: ReadonlySet<string> = new Set([
  'Completed',
  'Partial',
  'Unavailable',
  'Not applicable',
]);

/** What the screen remembers between polls to keep the bar moving forward. */
export interface LiveProgressMark {
  readonly scanId: string;
  /** Highest reading/checking value shown in this attempt; never the 97. */
  readonly highest: number;
  readonly completedModules: number;
  readonly allRowsSettled: boolean;
}

function allRowsSettled(scan: Scan): boolean {
  return (
    scan.modules.length > 0 && scan.modules.every((row) => SETTLED_MODULE_STATUSES.has(row.status))
  );
}

/**
 * Whether this poll belongs to a new attempt of the same scan.
 *
 * A section retry or a platform retry resets the rows: the settled count
 * drops, or a Pending/Running row appears where every row had settled. The
 * bar then starts again from what the new attempt has done, instead of
 * sitting at the old attempt's high point.
 */
function startedNewAttempt(previous: LiveProgressMark, scan: Scan): boolean {
  return (
    scan.progress.completedModules < previous.completedModules ||
    (previous.allRowsSettled && !allRowsSettled(scan))
  );
}

/**
 * The live bar's value for this poll, and what to remember for the next one.
 *
 * Within one attempt the bar keeps its highest reading/checking value, so a
 * late poll cannot pull it back. The finishing value is shown but never
 * remembered: a retry starts with every row still settled, and remembering
 * 97 there would pin the bar at 97 for the whole retried section.
 */
export function nextLiveProgress(
  previous: LiveProgressMark | null,
  scan: Scan,
): { readonly shown: number; readonly mark: LiveProgressMark } {
  const live = liveProgressPercent(scan);
  const sameAttempt =
    previous !== null && previous.scanId === scan.id && !startedNewAttempt(previous, scan);
  const carried = sameAttempt ? previous.highest : 0;
  const finishing = live === FINISHING;
  const highest = finishing ? carried : Math.max(carried, live);
  return {
    shown: finishing ? FINISHING : highest,
    mark: {
      scanId: scan.id,
      highest,
      completedModules: scan.progress.completedModules,
      allRowsSettled: allRowsSettled(scan),
    },
  };
}

/**
 * When a scan has run long enough to say so.
 *
 * There is no overall time limit on a scan to quote. A Basic scan of a small
 * site finishes in about two minutes, and the slowest single steps are bounded
 * in the API: a PageSpeed call at 60 s, an AI search at 60 s, a job lease at
 * 5 min before a dead worker's scan is picked up again (`JOB_LEASE_MS`). Twenty
 * minutes is four leases — past any one stall the worker recovers from — and
 * well past a normal run, so the note appears only when something is unusual.
 */
export const LONG_RUNNING_MS = 20 * 60 * 1000;

/**
 * Whether to say an unfinished scan has been going for longer than usual.
 *
 * Not while it waits in the queue or while the report is put together, and
 * not for a retried attempt: a retry keeps the scan's original `startedAt`
 * and the API exposes no start time for the attempt itself, so a retry of an
 * old scan would read as "running long" from its first second.
 */
export function isRunningLong(scan: Scan, now: number): boolean {
  const stage = progressStage(scan).kind;
  if (stage === 'queued' || stage === 'finishing') return false;
  if ((scan.retry?.module ?? 0) > 0 || (scan.retry?.platform ?? 0) > 0) return false;
  const since = Date.parse(scan.startedAt ?? scan.createdAt);
  return Number.isFinite(since) && now - since > LONG_RUNNING_MS;
}
