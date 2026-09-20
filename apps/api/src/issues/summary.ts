// What a report's findings add up to, and what changed since the last report.
//
// The Issue Center listed findings one target at a time, so a rule broken on
// 400 pages was 400 rows and nothing said which problem to start with. The
// summary folds findings by rule — the unit an owner actually fixes — in
// urgency order, which is what the report's "fix these first" block and the
// Issue Center's rule view read.
//
// The changes read compares a scan with the previous finished scan of the same
// profile and plan by fingerprint (fingerprint-v1 is stable across scans by
// construction), so a re-scan can say what was fixed and what is new instead of
// handing back a second list to diff by eye.

import { SEVERITIES, severityRank, type Severity } from '@fluxradar/contracts';
import type { PrismaClient, Scan } from '@prisma/client';

import {
  PAID_ACCESS_INCLUDE,
  isPaidAccessActive,
  type PaidAccessScan,
} from '../billing/report-access.ts';

/** Statuses that still ask the owner for work. The rest are settled. */
export const OPEN_ISSUE_STATUSES = ['New', 'Acknowledged', 'Reopened'] as const;

export interface RuleGroup {
  readonly ruleId: string;
  readonly module: string;
  readonly severity: string;
  readonly issues: number;
  readonly openIssues: number;
}

export interface IssueSummary {
  readonly total: number;
  readonly open: number;
  readonly bySeverity: Readonly<Record<Severity, number>>;
  readonly groups: readonly RuleGroup[];
}

interface GroupKey {
  readonly ruleId: string;
  readonly module: string;
  readonly severity: string;
}

function groupKey(group: GroupKey): string {
  return `${group.ruleId}\u0000${group.module}\u0000${group.severity}`;
}

/** Most urgent first; within a severity, the rule touching the most targets first. */
export function compareGroups(left: RuleGroup, right: RuleGroup): number {
  return (
    severityRank(left.severity) - severityRank(right.severity) ||
    right.openIssues - left.openIssues ||
    right.issues - left.issues ||
    left.ruleId.localeCompare(right.ruleId)
  );
}

export async function summarizeIssues(prisma: PrismaClient, scanId: string): Promise<IssueSummary> {
  const [all, open] = await Promise.all([
    prisma.issue.groupBy({
      by: ['ruleId', 'module', 'severity'],
      where: { scanId },
      _count: { _all: true },
    }),
    prisma.issue.groupBy({
      by: ['ruleId', 'module', 'severity'],
      where: { scanId, status: { in: [...OPEN_ISSUE_STATUSES] } },
      _count: { _all: true },
    }),
  ]);
  const openByKey = new Map(open.map((row) => [groupKey(row), row._count._all]));
  const groups = all
    .map((row): RuleGroup => ({
      ruleId: row.ruleId,
      module: row.module,
      severity: row.severity,
      issues: row._count._all,
      openIssues: openByKey.get(groupKey(row)) ?? 0,
    }))
    .sort(compareGroups);
  const bySeverity = Object.fromEntries(
    SEVERITIES.map((severity) => [
      severity,
      groups
        .filter((group) => group.severity === severity)
        .reduce((sum, group) => sum + group.openIssues, 0),
    ]),
  ) as Record<Severity, number>;
  return {
    total: groups.reduce((sum, group) => sum + group.issues, 0),
    open: groups.reduce((sum, group) => sum + group.openIssues, 0),
    bySeverity,
    groups,
  };
}

export interface ChangedRule {
  readonly ruleId: string;
  readonly module: string;
  readonly severity: string;
  readonly count: number;
}

export interface ScanChanges {
  readonly previous: {
    readonly id: string;
    readonly plan: string;
    readonly completedAt: string | null;
  } | null;
  readonly introduced: number;
  readonly fixed: number;
  readonly persisting: number;
  readonly introducedByRule: readonly ChangedRule[];
  readonly fixedByRule: readonly ChangedRule[];
}

const NO_CHANGES: ScanChanges = {
  previous: null,
  introduced: 0,
  fixed: 0,
  persisting: 0,
  introducedByRule: [],
  fixedByRule: [],
};

interface FingerprintedIssue {
  readonly fingerprint: string;
  readonly ruleId: string;
  readonly module: string;
  readonly severity: string;
}

function byRule(issues: readonly FingerprintedIssue[]): readonly ChangedRule[] {
  const counts = new Map<string, ChangedRule>();
  for (const issue of issues) {
    const key = groupKey(issue);
    const current = counts.get(key);
    counts.set(key, {
      ruleId: issue.ruleId,
      module: issue.module,
      severity: issue.severity,
      count: (current?.count ?? 0) + 1,
    });
  }
  return [...counts.values()].sort(
    (left, right) =>
      severityRank(left.severity) - severityRank(right.severity) ||
      right.count - left.count ||
      left.ruleId.localeCompare(right.ruleId),
  );
}

/**
 * How many earlier scans are looked through for one whose report is still
 * readable. A reversed payment can hide the latest one or two; a profile with
 * more returned reports than this in a row has no comparison worth drawing.
 */
const PREVIOUS_SCAN_CANDIDATES = 5;

/**
 * The scan this one is compared with: the latest earlier finished scan of the
 * same profile and plan. Same plan, because a Basic report never looked at
 * security — comparing Complete with Basic would call every security finding
 * "new". A previous report whose payment was reversed is skipped: its findings
 * are no longer the owner's to read, and a count derived from them is still a
 * read of them.
 */
async function previousComparableScan(prisma: PrismaClient, scan: Scan): Promise<Scan | null> {
  const candidates = (await prisma.scan.findMany({
    where: {
      siteProfileId: scan.siteProfileId,
      accountId: scan.accountId,
      plan: scan.plan,
      status: 'Completed',
      id: { not: scan.id },
      createdAt: { lt: scan.createdAt },
    },
    orderBy: { createdAt: 'desc' },
    take: PREVIOUS_SCAN_CANDIDATES,
    include: { ...PAID_ACCESS_INCLUDE },
  })) as (Scan & PaidAccessScan)[];
  return candidates.find((candidate) => isPaidAccessActive(candidate)) ?? null;
}

export async function scanChanges(prisma: PrismaClient, scan: Scan): Promise<ScanChanges> {
  if (scan.plan === 'Free') return NO_CHANGES;
  const previous = await previousComparableScan(prisma, scan);
  if (previous === null) return NO_CHANGES;
  const select = { fingerprint: true, ruleId: true, module: true, severity: true } as const;
  const [current, earlier] = await Promise.all([
    prisma.issue.findMany({ where: { scanId: scan.id }, select }),
    prisma.issue.findMany({ where: { scanId: previous.id }, select }),
  ]);
  const currentFingerprints = new Set(current.map((issue) => issue.fingerprint));
  const earlierFingerprints = new Set(earlier.map((issue) => issue.fingerprint));
  const introduced = current.filter((issue) => !earlierFingerprints.has(issue.fingerprint));
  const fixed = earlier.filter((issue) => !currentFingerprints.has(issue.fingerprint));
  return {
    previous: {
      id: previous.id,
      plan: previous.plan,
      completedAt: previous.completedAt?.toISOString() ?? null,
    },
    introduced: introduced.length,
    fixed: fixed.length,
    persisting: current.length - introduced.length,
    introducedByRule: byRule(introduced),
    fixedByRule: byRule(fixed),
  };
}
