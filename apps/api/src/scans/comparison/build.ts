// The comparison of one report with the previous scan of its site.
//
// Assembles the three reads that carry the answer — module scores, the page
// census and the finding diff — behind one verdict that decides whether any of
// them may be presented as a difference at all (verdict.ts). Nothing here
// computes a number the verdict has refused: when the two scans do not compare,
// the sections come back empty with their own reasons, so a client cannot render
// a delta that the server declined to stand behind.
//
// The previous scan is NOT chosen here: it is the §14 selection shared with the
// Resolved/Reopened pass (scans/previous-scan.ts), taken exactly as that pass
// takes it — including a previous report whose payment was reversed. Skipping
// such a scan here would compare against a DIFFERENT run from the one the
// Resolved statuses were written against, and the panel would then show
// "resolved" counts drawn from one baseline beside a page diff drawn from
// another.
//
// What a reversed payment does change is what may be SAID about that run. Its
// report is no longer the account's to read, and every number a comparison
// states — a score, a page total, a resolved finding, a sample of fingerprints —
// is derived from its rows; a count derived from them is still a read of them
// (D-216). So the answer then names the scan and stops: the verdict is
// `previous-not-readable`, `previous` carries its identity alone, and the
// previous side is never even loaded.

import { computeOverallScore } from '@fluxradar/scoring';
import {
  COMPARISON_SAMPLE_LIMIT,
  parsePlan,
  type Comparability,
  type ComparedScan,
  type ComparisonIncomparableReason,
  type PageComparison,
  type ReadableComparedScan,
  type ScanComparison,
  type UnreadableComparedScan,
} from '@fluxradar/contracts';
import type { PrismaClient, Scan } from '@prisma/client';

import type { ApiLogger } from '../../http/logger.ts';
import { findPreviousScanRead, hasEarlierScanOfAnotherPlan } from '../previous-scan.ts';
import { readCoverageEvidence } from './coverage-evidence.ts';
import { compareIssues, NO_ISSUE_COMPARISON } from './issue-diff.ts';
import { diffPages, pageSetsFor, type PageCensus } from './page-census.ts';
import { crawlScopeFactsOf } from './scope-facts.ts';
import {
  comparisonSideOf,
  comparisonVerdict,
  moduleScoreDeltas,
  scorableModules,
  type ComparedModule,
  type ComparisonSide,
} from './verdict.ts';

/** Module fields a comparison reads; metadata is deliberately not among them. */
const MODULE_SELECT = {
  module: true,
  runtimeStatus: true,
  score: true,
  usableOutput: true,
  coverage: true,
} as const;

async function sideOf(prisma: PrismaClient, scan: Scan): Promise<ComparisonSide> {
  const modules: readonly ComparedModule[] = await prisma.scanModule.findMany({
    where: { scanId: scan.id },
    select: MODULE_SELECT,
  });
  return comparisonSideOf(scan, modules, crawlScopeFactsOf(scan));
}

function identityOf(side: ComparisonSide): ReadableComparedScan {
  return {
    id: side.scan.id,
    plan: parsePlan(side.scan.plan),
    status: side.scan.status,
    completedAt: side.scan.completedAt?.toISOString() ?? null,
    pagesRead: side.summary?.pagesRead ?? null,
    urlsDiscovered: side.summary?.urlsDiscovered ?? null,
    urlsOverLimit: side.summary?.urlsOverLimit ?? null,
    scope: side.scope,
    readable: true,
  };
}

/**
 * The previous scan of a report this account may no longer read: which scan it
 * was, and nothing that scan found.
 *
 * Built from the `Scan` row alone — no module rows, no crawl summary, no scope —
 * because there is no field here for any of them to reach. That is the whole
 * guarantee: `UnreadableComparedScan` has three fields and the flag, so a future
 * edit that tries to keep "just the page count" does not compile.
 */
function unreadableIdentityOf(scan: Scan): UnreadableComparedScan {
  return {
    id: scan.id,
    plan: parsePlan(scan.plan),
    completedAt: scan.completedAt?.toISOString() ?? null,
    readable: false,
  };
}

/** The weighted score of one scan, computed exactly as its report computes it. */
function overallScoreOf(side: ComparisonSide): number | null {
  return computeOverallScore(parsePlan(side.scan.plan), scorableModules(side.modules)).score;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const NO_PAGE_COMPARISON: PageComparison = {
  comparable: { ok: false, reason: 'scans-not-comparable' },
  identity: null,
  added: 0,
  removed: 0,
  kept: 0,
  currentTotal: 0,
  previousTotal: 0,
  addedSample: [],
  removedSample: [],
};

function comparePages(current: PageCensus, previous: PageCensus): PageComparison {
  const problem = current.problem ?? previous.problem;
  if (problem !== null) {
    return { ...NO_PAGE_COMPARISON, comparable: { ok: false, reason: problem } };
  }
  const read = pageSetsFor(current, previous);
  if (read.sets === null) {
    return { ...NO_PAGE_COMPARISON, comparable: { ok: false, reason: read.problem } };
  }
  const sets = read.sets;
  const diff = diffPages(sets);
  return {
    comparable: { ok: true },
    identity: sets.identity,
    added: diff.added.length,
    removed: diff.removed.length,
    kept: diff.kept,
    currentTotal: sets.current.size,
    previousTotal: sets.previous.size,
    addedSample: diff.added.slice(0, COMPARISON_SAMPLE_LIMIT),
    removedSample: diff.removed.slice(0, COMPARISON_SAMPLE_LIMIT),
  };
}

export interface ComparisonDeps {
  readonly prisma: PrismaClient;
  /** Records a re-check proof this read could not decode; never user-facing. */
  readonly logger?: ApiLogger;
}

/** Two scans named, a reason, and not one number anywhere below it. */
function noComparison(
  current: ReadableComparedScan,
  previous: ComparedScan | null,
  comparable: Comparability<ComparisonIncomparableReason>,
  overall: { readonly previousScore: number | null; readonly currentScore: number | null },
): ScanComparison {
  return {
    current,
    previous,
    comparable,
    overall: { ...overall, delta: null },
    modules: [],
    pages: NO_PAGE_COMPARISON,
    issues: NO_ISSUE_COMPARISON,
  };
}

export async function buildScanComparison(
  deps: ComparisonDeps,
  scan: Scan,
): Promise<ScanComparison> {
  const { prisma } = deps;
  const current = await sideOf(prisma, scan);
  // The route has already refused a current report this account may not read.
  const currentIdentity = identityOf(current);
  const currentScore = overallScoreOf(current);
  // The §14 scan itself, not the latest one that is still readable: the Resolved
  // statuses this comparison reports were written against THIS run, and drawing
  // the comparison against a different one would make the two halves of the
  // report disagree.
  const previousRead = await findPreviousScanRead(prisma, scan);
  if (previousRead !== null && !previousRead.readable) {
    // Not a branch of comparisonVerdict, and deliberately: that function answers
    // "are these two readings the same thing" FROM the two readings, and this
    // reason exists precisely so the other one is never read. Nothing past this
    // return loads a module row, a crawl summary, a proof or a finding of it.
    return noComparison(
      currentIdentity,
      unreadableIdentityOf(previousRead.scan),
      { ok: false, reason: 'previous-not-readable' },
      { previousScore: null, currentScore },
    );
  }
  const previous = previousRead === null ? null : await sideOf(prisma, previousRead.scan);
  const verdict = comparisonVerdict({
    current,
    previous,
    earlierOtherPlan:
      previousRead !== null ? false : await hasEarlierScanOfAnotherPlan(prisma, scan),
  });
  const previousScore = previous === null ? null : overallScoreOf(previous);
  if (!verdict.ok || previous === null) {
    return noComparison(currentIdentity, previous === null ? null : identityOf(previous), verdict, {
      previousScore,
      currentScore,
    });
  }
  const onProblem = (detail: { scanId: string; module: string; problem: string }): void => {
    deps.logger?.warn('scan comparison could not read a re-check proof', detail);
  };
  const [currentEvidence, previousEvidence] = await Promise.all([
    readCoverageEvidence(prisma, current.scan.id, onProblem),
    readCoverageEvidence(prisma, previous.scan.id, onProblem),
  ]);
  const issues = await compareIssues(
    prisma,
    { currentScanId: current.scan.id, previousScanId: previous.scan.id },
    { current: currentEvidence.checkedRules, previous: previousEvidence.checkedRules },
  );
  return {
    current: currentIdentity,
    previous: identityOf(previous),
    comparable: verdict,
    overall: {
      previousScore,
      currentScore,
      delta:
        previousScore === null || currentScore === null
          ? null
          : round2(currentScore - previousScore),
    },
    modules: [...moduleScoreDeltas(current.modules, previous.modules)],
    pages: comparePages(currentEvidence.census, previousEvidence.census),
    issues,
  };
}
