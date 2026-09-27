// New, first-checked, resolved, reopened, still-open and settled findings
// between two scans — counted by the database, never by loading two scans'
// worth of rows.
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
//   new          the fingerprint is in this scan and not in the previous one,
//                under a rule BOTH scans ran. Not `status = 'New'`: that status
//                means "not seen in ANY earlier scan of this plan", which is a
//                different and wider claim.
//   firstChecked the fingerprint is absent from the previous scan because the
//                RULE is — it shipped between the two runs. Held apart from
//                `new` because it is news about the product, not about the site:
//                an owner who changed nothing would otherwise be told they had
//                introduced forty problems (checked-rules.ts).
//   resolved     a finding of the PREVIOUS scan that this run closed. The row
//                lives on the previous scan and its status was set to Resolved by
//                the §14 policy when this scan finished (orchestrator/
//                issue-sync.ts) — which only happens where this run actually
//                re-checked the same target, so absence alone never lands here.
//                Findings whose fingerprint is back in this scan are excluded
//                belt-and-braces.
//   reopened     a finding of this scan that an earlier scan of the plan had
//                closed. A subset of what is absent from the previous scan —
//                `new` and `firstChecked` together — reported beside them rather
//                than inside them, because "back again" is not the same news as
//                "first seen".
//   stillOpen    the fingerprint is in both scans and still asks for work:
//                the Issue Center's own open set (issues/summary.ts), so the
//                panel and the Issue Center cannot disagree about what "open"
//                means.
//   settled      the fingerprint is in both scans and does not: Ignored, False
//                Positive, or already Resolved by a later run. Split out rather
//                than folded into `stillOpen`, so the two add up to "present in
//                both" and neither overstates the work left.

import { Prisma, type PrismaClient } from '@prisma/client';
import {
  COMPARISON_SAMPLE_LIMIT,
  MODULE_NAMES,
  SEVERITIES,
  type FirstCheckedFindings,
  type IssueComparison,
  type IssueSample,
} from '@fluxradar/contracts';

import { OPEN_ISSUE_STATUSES } from '../../issues/summary.ts';
import { ruleCoverageDelta, type CheckedRules, type RuleCoverageDelta } from './checked-rules.ts';

/** Both scans of the comparison, in the only terms this file needs. */
export interface IssueDiffScans {
  readonly currentScanId: string;
  readonly previousScanId: string;
}

/** What each side's stored proof says it checked; decides `firstChecked`. */
export interface IssueDiffCoverage {
  readonly current: CheckedRules;
  readonly previous: CheckedRules;
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
  readonly firstCheckedCount: number;
  readonly stillOpenCount: number;
  readonly settledCount: number;
}

interface Counts {
  readonly new: number;
  readonly resolved: number;
  readonly reopened: number;
  readonly stillOpen: number;
  readonly settled: number;
}

const EMPTY_COUNTS: Counts = { new: 0, resolved: 0, reopened: 0, stillOpen: 0, settled: 0 };

/** A new total, never a mutated one: these objects go straight into the response. */
function plus(counts: Counts, delta: Partial<Counts>): Counts {
  return {
    new: counts.new + (delta.new ?? 0),
    resolved: counts.resolved + (delta.resolved ?? 0),
    reopened: counts.reopened + (delta.reopened ?? 0),
    stillOpen: counts.stillOpen + (delta.stillOpen ?? 0),
    settled: counts.settled + (delta.settled ?? 0),
  };
}

/** Accumulates one grouped row into a tally, replacing its entry rather than editing it. */
function addTo(tallies: Map<string, Counts>, key: string, delta: Partial<Counts>): void {
  tallies.set(key, plus(tallies.get(key) ?? EMPTY_COUNTS, delta));
}

/** Adds one to a plain per-key count — the `firstChecked` breakdowns. */
function addOne(tallies: Map<string, number>, key: string, count: number): void {
  tallies.set(key, (tallies.get(key) ?? 0) + count);
}

/** `column IN (…)`, or a constant false when the list is empty. */
function inList(column: Prisma.Sql, values: readonly string[]): Prisma.Sql {
  if (values.length === 0) {
    return Prisma.sql`FALSE`;
  }
  return Prisma.sql`${column} IN (${Prisma.join(values.map((value) => Prisma.sql`${value}`))})`;
}

const CURRENT_RULE = Prisma.sql`current."ruleId"`;
const CURRENT_STATUS = Prisma.sql`current."status"`;

/**
 * Findings of this scan, split four ways in one pass.
 *
 * The membership test is an index lookup per row, and each flag is computed once
 * rather than once per bucket: four `COUNT(*) FILTER` aggregates over one scan of
 * `Issue(scanId, …)` instead of four queries.
 */
function splitByPresence(
  prisma: PrismaClient,
  scans: IssueDiffScans,
  firstCheckedRules: readonly string[],
): Promise<readonly SplitCountsRow[]> {
  return prisma.$queryRaw<SplitCountsRow[]>`
    SELECT "module",
           "severity",
           COUNT(*) FILTER (WHERE NOT "seen" AND NOT "firstChecked")::int AS "newCount",
           COUNT(*) FILTER (WHERE NOT "seen" AND "firstChecked")::int AS "firstCheckedCount",
           COUNT(*) FILTER (WHERE "seen" AND "open")::int AS "stillOpenCount",
           COUNT(*) FILTER (WHERE "seen" AND NOT "open")::int AS "settledCount"
      FROM (
            SELECT current."module",
                   current."severity",
                   EXISTS (
                     SELECT 1
                       FROM "Issue" AS earlier
                      WHERE earlier."scanId" = ${scans.previousScanId}
                        AND earlier."fingerprint" = current."fingerprint"
                   ) AS "seen",
                   ${inList(CURRENT_RULE, firstCheckedRules)} AS "firstChecked",
                   ${inList(CURRENT_STATUS, OPEN_ISSUE_STATUSES)} AS "open"
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

/**
 * Most urgent first, then by fingerprint: a stable sample, not an arbitrary one.
 *
 * `underFirstChecked` picks which of the two absent-from-the-previous-scan
 * buckets is sampled, so the panel can list the new findings and the
 * first-checked ones without the reader having to tell them apart by rule id.
 */
function absentSample(
  prisma: PrismaClient,
  scans: IssueDiffScans,
  firstCheckedRules: readonly string[],
  underFirstChecked: boolean,
): Promise<readonly IssueSample[]> {
  const inFirstChecked = inList(CURRENT_RULE, firstCheckedRules);
  const bucket = underFirstChecked ? inFirstChecked : Prisma.sql`NOT ${inFirstChecked}`;
  return prisma.$queryRaw<IssueSample[]>`
    SELECT ${SAMPLE_COLUMNS}
      FROM "Issue" AS current
     WHERE current."scanId" = ${scans.currentScanId}
       AND ${bucket}
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

/**
 * No first-checked findings, and no claim that there are none.
 *
 * `known: false` because this constant is used where nothing was read at all —
 * the two scans do not compare — and "no rule shipped between them" would be a
 * statement about the ruleset that nobody checked.
 */
export const NO_FIRST_CHECKED: FirstCheckedFindings = {
  known: false,
  count: 0,
  byModule: [],
  bySeverity: [],
  ruleIds: [],
  sample: [],
};

export const NO_ISSUE_COMPARISON: IssueComparison = {
  ...EMPTY_COUNTS,
  byModule: [],
  bySeverity: [],
  newSample: [],
  resolvedSample: [],
  firstChecked: NO_FIRST_CHECKED,
  noLongerChecked: [],
};

/** The four tallies every row of the response is drawn from. */
interface Tallies {
  readonly byModule: ReadonlyMap<string, Counts>;
  readonly bySeverity: ReadonlyMap<string, Counts>;
  readonly firstCheckedByModule: ReadonlyMap<string, number>;
  readonly firstCheckedBySeverity: ReadonlyMap<string, number>;
}

/** One grouped row per (module, severity), as the three queries return them. */
interface GroupedRows {
  readonly split: readonly SplitCountsRow[];
  readonly resolved: readonly CountsRow[];
  readonly reopened: readonly {
    readonly module: string;
    readonly severity: string;
    readonly _count: { readonly _all: number };
  }[];
}

/** Every grouped row folded into the tallies, each bucket kept apart. */
function tallyRows(rows: GroupedRows): Tallies {
  const byModule = new Map<string, Counts>();
  const bySeverity = new Map<string, Counts>();
  const firstCheckedByModule = new Map<string, number>();
  const firstCheckedBySeverity = new Map<string, number>();
  for (const row of rows.split) {
    const delta = { new: row.newCount, stillOpen: row.stillOpenCount, settled: row.settledCount };
    addTo(byModule, row.module, delta);
    addTo(bySeverity, row.severity, delta);
    if (row.firstCheckedCount > 0) {
      addOne(firstCheckedByModule, row.module, row.firstCheckedCount);
      addOne(firstCheckedBySeverity, row.severity, row.firstCheckedCount);
    }
  }
  for (const row of rows.resolved) {
    addTo(byModule, row.module, { resolved: row.count });
    addTo(bySeverity, row.severity, { resolved: row.count });
  }
  for (const row of rows.reopened) {
    addTo(byModule, row.module, { reopened: row._count._all });
    addTo(bySeverity, row.severity, { reopened: row._count._all });
  }
  return { byModule, bySeverity, firstCheckedByModule, firstCheckedBySeverity };
}

/** Every read this comparison makes of the two scans' findings, in one round trip. */
function readIssueGroups(
  prisma: PrismaClient,
  scans: IssueDiffScans,
  firstCheckedRules: readonly string[],
) {
  return Promise.all([
    splitByPresence(prisma, scans, firstCheckedRules),
    resolvedCounts(prisma, scans),
    prisma.issue.groupBy({
      by: ['module', 'severity'],
      where: { scanId: scans.currentScanId, status: 'Reopened' },
      _count: { _all: true },
    }),
    absentSample(prisma, scans, firstCheckedRules, false),
    firstCheckedRules.length === 0
      ? Promise.resolve<readonly IssueSample[]>([])
      : absentSample(prisma, scans, firstCheckedRules, true),
    resolvedSample(prisma, scans),
  ]);
}

/**
 * The first-checked block, `known` included.
 *
 * `known` is not derived from the count: zero findings under new rules and "no
 * proof survives to say which rules ran" are the same zero and opposite claims,
 * and the report has to be able to state the second one.
 */
function firstCheckedOf(
  tallies: Tallies,
  delta: RuleCoverageDelta,
  sample: readonly IssueSample[],
): FirstCheckedFindings {
  return {
    known: delta.known,
    count: [...tallies.firstCheckedByModule.values()].reduce((sum, count) => sum + count, 0),
    byModule: [...tallies.firstCheckedByModule.entries()]
      .map(([module, count]) => ({ module, count }))
      .toSorted((left, right) => byModuleOrder(left.module, right.module)),
    bySeverity: [...tallies.firstCheckedBySeverity.entries()]
      .map(([severity, count]) => ({ severity, count }))
      .toSorted((left, right) => bySeverityOrder(left.severity, right.severity)),
    ruleIds: [...delta.firstChecked],
    sample: [...sample],
  };
}

export async function compareIssues(
  prisma: PrismaClient,
  scans: IssueDiffScans,
  coverage: IssueDiffCoverage,
): Promise<IssueComparison> {
  const delta = ruleCoverageDelta(coverage.current, coverage.previous);
  const [split, resolved, reopened, newest, firstCheckedSample, closed] = await readIssueGroups(
    prisma,
    scans,
    delta.firstChecked,
  );
  const tallies = tallyRows({ split, resolved, reopened });
  // The totals are the per-module tally summed, not a query of their own: two
  // reads of the same rows could disagree, and a table whose rows do not add up
  // to its own header is worse than no table.
  const totals = [...tallies.byModule.values()].reduce<Counts>(
    (sum, counts) => plus(sum, counts),
    EMPTY_COUNTS,
  );
  return {
    ...totals,
    byModule: [...tallies.byModule.entries()]
      .map(([module, counts]) => ({ module, ...counts }))
      .toSorted((left, right) => byModuleOrder(left.module, right.module)),
    bySeverity: [...tallies.bySeverity.entries()]
      .map(([severity, counts]) => ({ severity, ...counts }))
      .toSorted((left, right) => bySeverityOrder(left.severity, right.severity)),
    newSample: [...newest],
    resolvedSample: [...closed],
    firstChecked: firstCheckedOf(tallies, delta, firstCheckedSample),
    noLongerChecked: [...delta.noLongerChecked],
  };
}
