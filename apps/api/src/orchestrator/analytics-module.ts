// Writes the Analytics module row, and its findings, from live Google data.
//
// This runs AFTER resolveScanOutcome, in the same phase the module previously
// occupied as a fixed stub. That ordering is deliberate: Analytics is a
// side-score module (§15) and must never turn a Completed public-site scan into
// a Partial one because Google was unreachable or was never connected. The
// crawl is gone by then, so the scan hands over what the checks need from it.

import { SEVERITIES, type Severity } from '@fluxradar/contracts';
import type { AnalyticsPageFact } from '@fluxradar/rules';
import type { Prisma, PrismaClient, Scan } from '@prisma/client';

import { detailFor } from '../integrations/google/errors.ts';
import { connectionStateSnapshot } from '../integrations/google/snapshot.ts';
import type { GoogleScanData } from '../integrations/google/types.ts';
import { analyticsModuleRow } from './analytics/module-row.ts';
import { runAnalyticsChecks } from './analytics/run-checks.ts';
import { scoredAnalyticsIssues } from './analytics/scored-issues.ts';
import { ANALYTICS_MODULE, type ReportIssue } from './analytics/types.ts';
import type { WorkerDeps } from './deps.ts';
import { initialIssueStatuses } from './issue-sync.ts';
import { includesAnalytics } from './module-plan.ts';

export async function persistAnalyticsModule(
  deps: WorkerDeps,
  scanId: string,
  pages: readonly AnalyticsPageFact[],
): Promise<void> {
  const now = deps.now ?? ((): Date => new Date());
  const { prisma } = deps;
  const scan = await prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
  if (!includesAnalytics(scan.plan)) {
    return;
  }
  const data = await collectGoogleData(deps, scan, now);
  const run = runAnalyticsChecks({
    origin: scan.domain,
    snapshot: data.snapshot,
    searchConsoleDetail: data.searchConsoleDetail,
    pages,
    reportIssues: await otherSectionsPageIssues(prisma, scanId),
  });
  // The outcome — and with it completed_at — is settled before this runs, so a
  // finding stamped "now" would fall outside its own scan (EXPORT-001/2). It is
  // part of that scan: it is stamped with the scan's completion.
  const observedAt = scan.completedAt ?? now();
  const { score, issueRows } = scoredAnalyticsIssues(scanId, scan.domain, run.checks, observedAt);
  const row = analyticsModuleRow(data.snapshot, run, score);
  const statuses = await initialIssueStatuses(
    prisma,
    scan,
    issueRows.map((issue) => issue.fingerprint),
  );
  await prisma.$transaction([
    prisma.scanModule.upsert({
      where: { scanId_module: { scanId, module: ANALYTICS_MODULE } },
      create: { scanId, module: ANALYTICS_MODULE, ...row },
      update: row,
    }),
    prisma.issue.deleteMany({ where: { scanId, module: ANALYTICS_MODULE } }),
    prisma.issue.createMany({
      data: issueRows.map((issue): Prisma.IssueCreateManyInput => ({
        ...issue,
        status: statuses.get(issue.fingerprint) ?? 'New',
      })),
    }),
  ]);
}

async function collectGoogleData(
  deps: WorkerDeps,
  scan: Scan,
  now: () => Date,
): Promise<GoogleScanData> {
  const runner = deps.createGoogleDataRunner?.();
  if (runner === undefined) {
    return {
      snapshot: connectionStateSnapshot('not_connected', detailFor('not_connected'), now()),
      searchConsoleDetail: null,
    };
  }
  try {
    return await runner(scan.accountId, scan.siteProfileId);
  } catch (error) {
    // The runner already degrades internally; this is the last guard so a
    // terminal scan is never lost to an unexpected Google client failure.
    deps.logger.warn('google data collection failed', {
      scanId: scan.id,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    return {
      snapshot: connectionStateSnapshot('request_failed', detailFor('request_failed'), now()),
      searchConsoleDetail: null,
    };
  }
}

/** The page-level findings the rest of this report raised, for the top-pages list. */
async function otherSectionsPageIssues(
  prisma: PrismaClient,
  scanId: string,
): Promise<readonly ReportIssue[]> {
  const issues = await prisma.issue.findMany({
    where: { scanId, module: { not: ANALYTICS_MODULE }, targetKind: 'page' },
    select: { ruleId: true, normalizedUrl: true, severity: true },
  });
  return issues.flatMap((issue) =>
    isSeverity(issue.severity)
      ? [{ ruleId: issue.ruleId, normalizedUrl: issue.normalizedUrl, severity: issue.severity }]
      : [],
  );
}

function isSeverity(value: string): value is Severity {
  return (SEVERITIES as readonly string[]).includes(value);
}
