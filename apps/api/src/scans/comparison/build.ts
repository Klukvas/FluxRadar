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
// Resolved/Reopened pass and the report's "since last scan" read
// (scans/previous-scan.ts).

import { computeOverallScore } from '@fluxradar/scoring';
import {
  COMPARISON_SAMPLE_LIMIT,
  parsePlan,
  type ComparedScan,
  type PageComparison,
  type ScanComparison,
} from '@fluxradar/contracts';
import type { PrismaClient, Scan } from '@prisma/client';

import type { ApiLogger } from '../../http/logger.ts';
import { findPreviousReadableScan, hasEarlierScanOfAnotherPlan } from '../previous-scan.ts';
import { compareIssues, NO_ISSUE_COMPARISON } from './issue-diff.ts';
import { diffPages, pageSetsFor, readPageCensus, type PageCensus } from './page-census.ts';
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

function identityOf(side: ComparisonSide): ComparedScan {
  return {
    id: side.scan.id,
    plan: parsePlan(side.scan.plan),
    status: side.scan.status,
    completedAt: side.scan.completedAt?.toISOString() ?? null,
    pagesRead: side.summary?.pagesRead ?? null,
    urlsDiscovered: side.summary?.urlsDiscovered ?? null,
    urlsOverLimit: side.summary?.urlsOverLimit ?? null,
    scope: side.scope,
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
  const sets = pageSetsFor(current, previous);
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

export async function buildScanComparison(
  deps: ComparisonDeps,
  scan: Scan,
): Promise<ScanComparison> {
  const { prisma } = deps;
  const current = await sideOf(prisma, scan);
  const previousScan = await findPreviousReadableScan(prisma, scan);
  const previous = previousScan === null ? null : await sideOf(prisma, previousScan);
  const verdict = comparisonVerdict({
    current,
    previous,
    earlierOtherPlan:
      previousScan !== null ? false : await hasEarlierScanOfAnotherPlan(prisma, scan),
  });
  const currentScore = overallScoreOf(current);
  const previousScore = previous === null ? null : overallScoreOf(previous);
  const identity = {
    current: identityOf(current),
    previous: previous === null ? null : identityOf(previous),
  };
  if (!verdict.ok || previous === null) {
    return {
      ...identity,
      comparable: verdict,
      overall: { previousScore, currentScore, delta: null },
      modules: [],
      pages: NO_PAGE_COMPARISON,
      issues: NO_ISSUE_COMPARISON,
    };
  }
  const onProblem = (detail: { scanId: string; module: string; problem: string }): void => {
    deps.logger?.warn('scan comparison could not read a re-check proof', detail);
  };
  const [currentPages, previousPages, issues] = await Promise.all([
    readPageCensus(prisma, current.scan.id, onProblem),
    readPageCensus(prisma, previous.scan.id, onProblem),
    compareIssues(prisma, {
      currentScanId: current.scan.id,
      previousScanId: previous.scan.id,
    }),
  ]);
  return {
    ...identity,
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
    pages: comparePages(currentPages, previousPages),
    issues,
  };
}
