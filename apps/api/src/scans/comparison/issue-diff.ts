// New, resolved, reopened and still-open findings between two scans — counted by
// the database, never by loading two scans' worth of rows.
//
// WHY RAW SQL. The question is a set difference over fingerprints
// ("present now, absent before"), and Prisma cannot express a correlated
// subquery. The alternative is to fetch both fingerprint lists into the process
// and diff them there, which is what the older "since last scan" read does — fine
// for a 15-page crawl, and a 50 000-page Complete scan is sold with a URL limit
// three orders of magnitude above that. So the diff, the grouping and the samples
// are all one index scan over `Issue(scanId, fingerprint)` each, and nothing but
// counts and at most twenty sample rows crosses the boundary.
//
// WHAT EACH NUMBER MEANS, precisely:
//
//   new        the fingerprint is in this scan and not in the previous one. Not
//              `status = 'New'`: that status means "not seen in ANY earlier scan
//              of this plan", which is a different and wider claim.
//   resolved   a finding of the PREVIOUS scan that this run closed. The row lives
//              on the previous scan and its status was set to Resolved by the
//              §14 policy when this scan finished (orchestrator/issue-sync.ts) —
//              which only happens where this run actually re-checked the same
//              target, so absence alone never lands here. Findings whose
//              fingerprint is back in this scan are excluded belt-and-braces.
//   reopened   a finding of this scan that an earlier scan of the plan had
//              closed. A subset of `new`, reported beside it rather than inside
//              it, because "back again" is not the same news as "first seen".
//   stillOpen  the fingerprint is in both scans.

import { Prisma, type PrismaClient } from '@prisma/client';
import {
  COMPARISON_SAMPLE_LIMIT,
  MODULE_NAMES,
  SEVERITIES,
  type IssueComparison,
  type IssueSample,
} from '@fluxradar/contracts';

/** Both scans of the comparison, in the only terms this file needs. */
export interface IssueDiffScans {
  readonly currentScanId: string;
  readonly previousScanId: string;
}

interface CountsRow {
  readonly module: string;
  readonly severity: string;
  readonly count: number;
}

interface SplitCountsRow {
  readonly module: string;
  readonly severity: string;
  readonly newCount: number;
  readonly keptCount: number;
}

interface Counts {
  new: number;
  resolved: number;
  reopened: number;
  stillOpen: number;
}

function emptyCounts(): Counts {
  return { new: 0, resolved: 0, reopened: 0, stillOpen: 0 };
}

/** Accumulates one grouped row into the module and severity tallies. */
function add(tallies: Map<string, Counts>, key: string, apply: (counts: Counts) => void): void {
  const counts = tallies.get(key) ?? emptyCounts();
  apply(counts);
  tallies.set(key, counts);
}

/**
 * Findings of this scan, split by whether the previous scan had the same
 * fingerprint. One pass over the current scan's rows; the membership test is an
 * index lookup per row, and the boolean is computed once rather than twice.
 */
function splitByPresence(
  prisma: PrismaClient,
  scans: IssueDiffScans,
): Promise<readonly SplitCountsRow[]> {
  return prisma.$queryRaw<SplitCountsRow[]>`
    SELECT "module",
           "severity",
           COUNT(*) FILTER (WHERE NOT "seen")::int AS "newCount",
           COUNT(*) FILTER (WHERE "seen")::int AS "keptCount"
      FROM (
            SELECT current."module",
                   current."severity",
                   EXISTS (
                     SELECT 1
                       FROM "Issue" AS earlier
                      WHERE earlier."scanId" = ${scans.previousScanId}
                        AND earlier."fingerprint" = current."fingerprint"
                   ) AS "seen"
              FROM "Issue" AS current
             WHERE current."scanId" = ${scans.currentScanId}
           ) AS flagged
     GROUP BY "module", "severity"`;
}

/** Findings the previous scan carries as Resolved and this scan does not have. */
function resolvedCounts(
  prisma: PrismaClient,
  scans: IssueDiffScans,
): Promise<readonly CountsRow[]> {
  return prisma.$queryRaw<CountsRow[]>`
    SELECT earlier."module", earlier."severity", COUNT(*)::int AS "count"
      FROM "Issue" AS earlier
     WHERE earlier."scanId" = ${scans.previousScanId}
       AND earlier."status" = 'Resolved'
       AND NOT EXISTS (
             SELECT 1
               FROM "Issue" AS current
              WHERE current."scanId" = ${scans.currentScanId}
                AND current."fingerprint" = earlier."fingerprint"
           )
     GROUP BY earlier."module", earlier."severity"`;
}

const SAMPLE_COLUMNS = Prisma.sql`"fingerprint", "ruleId", "module", "severity", "normalizedUrl"`;

/** Most urgent first, then by fingerprint: a stable sample, not an arbitrary one. */
function newSample(prisma: PrismaClient, scans: IssueDiffScans): Promise<readonly IssueSample[]> {
  return prisma.$queryRaw<IssueSample[]>`
    SELECT ${SAMPLE_COLUMNS}
      FROM "Issue" AS current
     WHERE current."scanId" = ${scans.currentScanId}
       AND NOT EXISTS (
             SELECT 1
               FROM "Issue" AS earlier
              WHERE earlier."scanId" = ${scans.previousScanId}
                AND earlier."fingerprint" = current."fingerprint"
           )
     ORDER BY current."severityRank" ASC, current."fingerprint" ASC
     LIMIT ${COMPARISON_SAMPLE_LIMIT}`;
}

function resolvedSample(
  prisma: PrismaClient,
  scans: IssueDiffScans,
): Promise<readonly IssueSample[]> {
  return prisma.$queryRaw<IssueSample[]>`
    SELECT ${SAMPLE_COLUMNS}
      FROM "Issue" AS earlier
     WHERE earlier."scanId" = ${scans.previousScanId}
       AND earlier."status" = 'Resolved'
       AND NOT EXISTS (
             SELECT 1
               FROM "Issue" AS current
              WHERE current."scanId" = ${scans.currentScanId}
                AND current."fingerprint" = earlier."fingerprint"
           )
     ORDER BY earlier."severityRank" ASC, earlier."fingerprint" ASC
     LIMIT ${COMPARISON_SAMPLE_LIMIT}`;
}

/** Positional order in a declared list, with anything unknown last. */
function declaredOrder(names: readonly string[]): (left: string, right: string) => number {
  const rank = (name: string): number => {
    const index = names.indexOf(name);
    return index === -1 ? names.length : index;
  };
  return (left, right) => rank(left) - rank(right) || left.localeCompare(right);
}

/** Severity by urgency, section in the tariff table's order — not alphabetically. */
const bySeverityOrder = declaredOrder(SEVERITIES);
const byModuleOrder = declaredOrder(MODULE_NAMES);

export const NO_ISSUE_COMPARISON: IssueComparison = {
  new: 0,
  resolved: 0,
  reopened: 0,
  stillOpen: 0,
  byModule: [],
  bySeverity: [],
  newSample: [],
  resolvedSample: [],
};

export async function compareIssues(
  prisma: PrismaClient,
  scans: IssueDiffScans,
): Promise<IssueComparison> {
  const [split, resolved, reopened, newest, closed] = await Promise.all([
    splitByPresence(prisma, scans),
    resolvedCounts(prisma, scans),
    prisma.issue.groupBy({
      by: ['module', 'severity'],
      where: { scanId: scans.currentScanId, status: 'Reopened' },
      _count: { _all: true },
    }),
    newSample(prisma, scans),
    resolvedSample(prisma, scans),
  ]);
  const byModule = new Map<string, Counts>();
  const bySeverity = new Map<string, Counts>();
  for (const row of split) {
    add(byModule, row.module, (counts) => {
      counts.new += row.newCount;
      counts.stillOpen += row.keptCount;
    });
    add(bySeverity, row.severity, (counts) => {
      counts.new += row.newCount;
      counts.stillOpen += row.keptCount;
    });
  }
  for (const row of resolved) {
    add(byModule, row.module, (counts) => void (counts.resolved += row.count));
    add(bySeverity, row.severity, (counts) => void (counts.resolved += row.count));
  }
  for (const row of reopened) {
    const count = row._count._all;
    add(byModule, row.module, (counts) => void (counts.reopened += count));
    add(bySeverity, row.severity, (counts) => void (counts.reopened += count));
  }
  const totals = [...byModule.values()].reduce<Counts>(
    (sum, counts) => ({
      new: sum.new + counts.new,
      resolved: sum.resolved + counts.resolved,
      reopened: sum.reopened + counts.reopened,
      stillOpen: sum.stillOpen + counts.stillOpen,
    }),
    emptyCounts(),
  );
  return {
    ...totals,
    byModule: [...byModule.entries()]
      .map(([module, counts]) => ({ module, ...counts }))
      .toSorted((left, right) => byModuleOrder(left.module, right.module)),
    bySeverity: [...bySeverity.entries()]
      .map(([severity, counts]) => ({ severity, ...counts }))
      .toSorted((left, right) => bySeverityOrder(left.severity, right.severity)),
    newSample: [...newest],
    resolvedSample: [...closed],
  };
}
