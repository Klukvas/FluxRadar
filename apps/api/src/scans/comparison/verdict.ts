// Whether these two scans are two readings of the same thing — and, when they
// are not, which one thing made them incomparable.
//
// The rule this file exists to enforce is the one the performance comparison
// states first (integrations/performance/comparison.ts): a comparison either
// stands behind its number or says why it has none. Every reason below turns
// "the finding is gone" into something other than "it was fixed", so each of
// them stops the delta instead of decorating it:
//
//   • a crawl that stopped at its page limit never read the rest of the site,
//     and the addresses it did not reach are missing, not removed;
//   • a scan that was paused, cancelled, or left a module unfinished is not a
//     picture of the site, it is a picture of a partial run;
//   • a changed scope is a different question asked of the same site;
//   • a crawl nobody recorded (a scan older than `Scan.crawlSummaryJson`) cannot
//     prove it was complete, and "I do not know" is not a licence to subtract.
//
// The checks are ordered by what a reader can act on: a scope the owner changed
// is named before the truncation it caused, so they are not sent looking for a
// site problem behind their own setting.
//
// ONE REASON IS NOT DECIDED HERE. `previous-not-readable` — the previous report's
// payment was reversed — is answered by the caller (build.ts) before this runs,
// because every input below is a reading OF that report, and the point of that
// reason is that nothing is read from it at all.

import {
  MODULE_NAMES,
  isModuleName,
  parseCrawlSummary,
  type Comparability,
  type ComparisonIncomparableReason,
  type CrawlScopeFacts,
  type CrawlSummary,
  type ModuleComparisonReason,
  type ModuleName,
  type ModuleScoreDelta,
} from '@fluxradar/contracts';
import type { Scan } from '@prisma/client';

import { sameCrawlScope } from './scope-facts.ts';

/** A module row, in the only fields a comparison reads. */
export interface ComparedModule {
  readonly module: string;
  readonly runtimeStatus: string;
  readonly score: number | null;
  readonly usableOutput: boolean;
  readonly coverage: number | null;
}

/** One scan as the verdict reads it: identity, crawl, scope and module rows. */
export interface ComparisonSide {
  readonly scan: Scan;
  readonly modules: readonly ComparedModule[];
  readonly summary: CrawlSummary | null;
  readonly scope: CrawlScopeFacts;
}

export function comparisonSideOf(
  scan: Scan,
  modules: readonly ComparedModule[],
  scope: CrawlScopeFacts,
): ComparisonSide {
  return { scan, modules, summary: parseCrawlSummary(scan.crawlSummaryJson), scope };
}

/**
 * A module that reached its own end: it ran to completion, or it had nothing
 * applicable to run on. Anything else — Unavailable, Partial, still Running —
 * means the scan beside it is a partial read of the site.
 */
function moduleFinished(module: ComparedModule): boolean {
  return module.runtimeStatus === 'Completed' || module.runtimeStatus === 'Not applicable';
}

function stoppedEarly(side: ComparisonSide): boolean {
  return side.scan.status !== 'Completed' || !side.modules.every(moduleFinished);
}

function hasUsableOutput(side: ComparisonSide): boolean {
  return side.modules.some((module) => module.usableOutput);
}

/** In-scope addresses the page limit left unread; a truncated crawl. */
function truncated(summary: CrawlSummary): boolean {
  return summary.urlsOverLimit > 0;
}

export interface VerdictInput {
  readonly current: ComparisonSide;
  readonly previous: ComparisonSide | null;
  /** Whether an earlier finished scan of the profile exists on another plan. */
  readonly earlierOtherPlan: boolean;
}

/**
 * The comparison verdict for the whole read.
 *
 * Fails closed: every branch that cannot prove comparability returns a reason,
 * and `{ ok: true }` is reached only once every question this function asks has
 * been answered. `previous-not-readable` is not among them — the caller settles
 * that one before this runs, because it is the reason the other reading is never
 * taken at all (see the note at the top of this file).
 */
export function comparisonVerdict(
  input: VerdictInput,
): Comparability<ComparisonIncomparableReason> {
  const { current, previous } = input;
  if (previous === null) {
    return {
      ok: false,
      reason: input.earlierOtherPlan ? 'previous-plan-differs' : 'no-previous-scan',
    };
  }
  if (!hasUsableOutput(previous)) {
    return { ok: false, reason: 'previous-not-usable' };
  }
  if (stoppedEarly(current)) {
    return { ok: false, reason: 'current-stopped-early' };
  }
  if (stoppedEarly(previous)) {
    return { ok: false, reason: 'previous-stopped-early' };
  }
  if (!sameCrawlScope(current.scope, previous.scope)) {
    return { ok: false, reason: 'scope-changed' };
  }
  if (current.summary === null || previous.summary === null) {
    return { ok: false, reason: 'crawl-not-recorded' };
  }
  if (truncated(current.summary)) {
    return { ok: false, reason: 'current-crawl-truncated' };
  }
  if (truncated(previous.summary)) {
    return { ok: false, reason: 'previous-crawl-truncated' };
  }
  return { ok: true };
}

/** Two decimals, like every other score this API reports. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function moduleReason(
  current: ComparedModule | undefined,
  previous: ComparedModule | undefined,
): ModuleComparisonReason | null {
  if (previous === undefined) return 'module-absent-previously';
  if (current === undefined) return 'module-absent-now';
  if (previous.score === null) return 'module-not-scored-previously';
  if (current.score === null) return 'module-not-scored-now';
  return null;
}

/**
 * Per-module score deltas, in the tariff table's module order.
 *
 * A module present in one scan and not the other is reported as not comparable
 * rather than as a change: the plan is the same on both sides, so a missing
 * module means the section did not run, and calling that a score movement would
 * invent one. Same for a module that ran without producing a score.
 */
export function moduleScoreDeltas(
  current: readonly ComparedModule[],
  previous: readonly ComparedModule[],
): readonly ModuleScoreDelta[] {
  const byName = (modules: readonly ComparedModule[]): ReadonlyMap<string, ComparedModule> =>
    new Map(modules.map((module) => [module.module, module]));
  const currentByName = byName(current);
  const previousByName = byName(previous);
  const present = MODULE_NAMES.filter(
    (module: ModuleName) => currentByName.has(module) || previousByName.has(module),
  );
  return present.map((module) => {
    const now = currentByName.get(module);
    const before = previousByName.get(module);
    const reason = moduleReason(now, before);
    return {
      module,
      previousScore: before?.score ?? null,
      currentScore: now?.score ?? null,
      delta:
        reason !== null || now?.score == null || before?.score == null
          ? null
          : round2(now.score - before.score),
      comparable: reason === null ? { ok: true } : { ok: false, reason },
    };
  });
}

/** Module rows the score engine may read: named modules of a known plan. */
export function scorableModules(modules: readonly ComparedModule[]): readonly {
  module: ModuleName;
  moduleStatus: 'Completed' | 'Partial' | 'Unavailable' | 'Not applicable';
  coverage: number;
  score: number | null;
  usableOutput: boolean;
}[] {
  return modules.flatMap((module) => {
    if (!isModuleName(module.module)) return [];
    return [
      {
        module: module.module,
        moduleStatus: module.runtimeStatus as
          'Completed' | 'Partial' | 'Unavailable' | 'Not applicable',
        coverage: module.coverage ?? 0,
        score: module.score,
        usableOutput: module.usableOutput,
      },
    ];
  });
}
