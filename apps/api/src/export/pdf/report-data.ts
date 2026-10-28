// Everything the downloadable report needs, read from the database.
//
// THE POINT OF THIS FILE IS THAT NOTHING IS CAPPED. The browser's printable
// report stops at 1 000 findings (apps/web/src/PrintReport.tsx), because a
// single-page React app that fetched fifty pages of issues would take minutes
// and then run out of memory rendering them. A scan of a large site can have
// many times that, and a report that silently stops at a round number is a
// report that told its reader a site has 1 000 problems when it has 4 000.
//
// So the findings are read in keyset pages and handed to the renderer one page
// at a time: every finding is written, and no more than one page of them is ever
// in memory. The same ordering the Issue Center uses — urgency, then fingerprint
// — is used here, with the row id as the final tiebreak so the cursor is total.

import type { Issue, PrismaClient, Scan, ScanModule } from '@prisma/client';
import type { FindingLanguage } from '@fluxradar/rules';

import { localizedFindingTexts } from '../../issues/localized-text.ts';

/** Findings per database round trip. Bounded memory, unbounded output. */
export const ISSUE_PAGE_SIZE = 250;

export interface ReportFinding {
  readonly id: string;
  readonly ruleId: string;
  readonly module: string;
  readonly severity: string;
  readonly status: string;
  /** `page`, or `site`/`api`/`environment` for a check about the site as a whole. */
  readonly targetKind: string;
  readonly targetUrl: string;
  readonly evidenceExcerpt: string | null;
  readonly recommendation: string;
  readonly applicableTargets: number;
  readonly affectedTargets: number;
  readonly observedAt: Date;
}

export interface ReportSeverityCounts {
  readonly Critical: number;
  readonly High: number;
  readonly Medium: number;
  readonly Low: number;
}

/** How many findings one rule produced, at one severity, in one section. */
export interface ReportRuleGroup {
  readonly ruleId: string;
  readonly severity: string;
  readonly module: string;
  readonly count: number;
}

export interface PdfReportHeader {
  readonly scan: Scan;
  readonly modules: readonly ScanModule[];
  readonly totalFindings: number;
  readonly openFindings: number;
  /** Every finding listed, by severity: what the findings chapter's group headers count. */
  readonly bySeverity: ReportSeverityCounts;
  /**
   * Open findings only (New, Reopened), by severity: the population page one
   * states, so its verdict and severity bar agree with its open count.
   */
  readonly openBySeverity: ReportSeverityCounts;
  readonly ruleGroupCount: number;
  /** Distinct rules among the open findings: the page-one tile's problem count. */
  readonly openRuleCount: number;
  /** One entry per (rule, severity, section): what the findings index lists. */
  readonly ruleGroups: readonly ReportRuleGroup[];
}

/** A keyset cursor over the findings of one scan. */
interface IssueCursor {
  readonly severityRank: number;
  readonly fingerprint: string;
  readonly id: string;
}

function localise(issue: Issue, language: FindingLanguage): ReportFinding {
  const localized = localizedFindingTexts(issue.messagesJson)?.[language];
  return {
    id: issue.id,
    ruleId: issue.ruleId,
    module: issue.module,
    severity: issue.severity,
    status: issue.status,
    targetKind: issue.targetKind,
    targetUrl: issue.targetUrl,
    evidenceExcerpt: localized?.evidenceExcerpt ?? issue.evidenceExcerpt,
    recommendation: localized?.recommendation ?? issue.recommendation,
    applicableTargets: issue.applicableTargets,
    affectedTargets: issue.affectedTargets,
    observedAt: issue.observedAt,
  };
}

/** The statuses a finding is still open in: the same filter the open count uses. */
const OPEN_STATUSES = ['New', 'Reopened'] as const;

function severityCounts(
  rows: readonly { readonly severity: string; readonly _count: { readonly _all: number } }[],
): ReportSeverityCounts {
  const counted = new Map(rows.map((row) => [row.severity, row._count._all]));
  return {
    Critical: counted.get('Critical') ?? 0,
    High: counted.get('High') ?? 0,
    Medium: counted.get('Medium') ?? 0,
    Low: counted.get('Low') ?? 0,
  };
}

/**
 * The scan, its modules and the counts the summary states — but not the
 * findings, which are streamed separately.
 */
export async function loadReportHeader(
  prisma: PrismaClient,
  scan: Scan & { readonly modules: ScanModule[] },
): Promise<PdfReportHeader> {
  const [total, open, severities, openSeverities, groups, openRules] = await Promise.all([
    prisma.issue.count({ where: { scanId: scan.id } }),
    prisma.issue.count({ where: { scanId: scan.id, status: { in: [...OPEN_STATUSES] } } }),
    prisma.issue.groupBy({
      by: ['severity'],
      where: { scanId: scan.id },
      _count: { _all: true },
    }),
    prisma.issue.groupBy({
      by: ['severity'],
      where: { scanId: scan.id, status: { in: [...OPEN_STATUSES] } },
      _count: { _all: true },
    }),
    prisma.issue.groupBy({
      by: ['ruleId', 'severity', 'module'],
      where: { scanId: scan.id },
      _count: { _all: true },
    }),
    prisma.issue.groupBy({
      by: ['ruleId'],
      where: { scanId: scan.id, status: { in: [...OPEN_STATUSES] } },
      _count: { _all: true },
    }),
  ]);
  const counted = severityCounts(severities);
  const ruleGroups = groups.map((row) => ({
    ruleId: row.ruleId,
    severity: row.severity,
    module: row.module,
    count: row._count._all,
  }));
  return {
    scan,
    modules: scan.modules,
    totalFindings: total,
    openFindings: open,
    bySeverity: counted,
    openBySeverity: severityCounts(openSeverities),
    ruleGroupCount: new Set(ruleGroups.map((group) => group.ruleId)).size,
    ruleGroups,
    openRuleCount: openRules.length,
  };
}

/**
 * Hands every finding of the scan to `onPage`, one database page at a time, in
 * urgency order.
 *
 * Keyset rather than offset: a report of a large scan issues dozens of these
 * queries, and OFFSET makes each one scan and discard everything before it. The
 * cursor is (severityRank, fingerprint, id), which matches the ordering exactly
 * and is unique, so no row is skipped or repeated.
 */
export async function forEachFindingPage(
  prisma: PrismaClient,
  scanId: string,
  language: FindingLanguage,
  onPage: (findings: readonly ReportFinding[]) => void | Promise<void>,
  pageSize: number = ISSUE_PAGE_SIZE,
): Promise<number> {
  let cursor: IssueCursor | null = null;
  let written = 0;
  for (;;) {
    const page: Issue[] = await prisma.issue.findMany({
      where: { scanId, ...(cursor === null ? {} : { ...afterCursor(cursor) }) },
      orderBy: [{ severityRank: 'asc' }, { fingerprint: 'asc' }, { id: 'asc' }],
      take: pageSize,
    });
    if (page.length === 0) return written;
    await onPage(page.map((issue) => localise(issue, language)));
    written += page.length;
    const last = page[page.length - 1];
    if (last === undefined || page.length < pageSize) return written;
    cursor = { severityRank: last.severityRank, fingerprint: last.fingerprint, id: last.id };
  }
}

/**
 * "Strictly after this cursor" in the composite ordering, as the nested OR
 * Prisma needs. Written out rather than approximated with a single `gt` on the
 * rank, which would drop every row sharing the last page's severity.
 */
function afterCursor(cursor: IssueCursor) {
  return {
    OR: [
      { severityRank: { gt: cursor.severityRank } },
      {
        severityRank: cursor.severityRank,
        OR: [
          { fingerprint: { gt: cursor.fingerprint } },
          { fingerprint: cursor.fingerprint, id: { gt: cursor.id } },
        ],
      },
    ],
  };
}
