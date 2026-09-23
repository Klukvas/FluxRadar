// Writes the Analytics module row, and its findings, from live Google data.
//
// This runs AFTER resolveScanOutcome, in the same phase the module previously
// occupied as a fixed stub. That ordering is deliberate: Analytics is a
// side-score module (§15) and must never turn a Completed public-site scan into
// a Partial one because Google was unreachable or was never connected. The
// crawl is gone by then, so the scan hands over what the checks need from it.

import {
  SEVERITIES,
  isSiteRead,
  parseCrawlSummary,
  siteReachStatusReason,
  type Severity,
} from '@fluxradar/contracts';
import type { AnalyticsPageFact } from '@fluxradar/rules';
import type { Prisma, PrismaClient, Scan } from '@prisma/client';

import {
  bingNotConnectedResult,
  bingStateResult,
  type BingScanResult,
} from '../integrations/bing/runner.ts';
import { detailFor } from '../integrations/google/errors.ts';
import { connectionStateSnapshot } from '../integrations/google/snapshot.ts';
import type { GoogleScanData } from '../integrations/google/types.ts';
import { analyticsModuleRow } from './analytics/module-row.ts';
import { runAnalyticsChecks } from './analytics/run-checks.ts';
import { scoredAnalyticsIssues } from './analytics/scored-issues.ts';
import { ANALYTICS_MODULE, type ReportIssue } from './analytics/types.ts';
import type { WorkerDeps } from './deps.ts';
import { issueStatusesForModule } from './issue-sync.ts';
import { includesAnalytics } from './module-plan.ts';
import { crawlRequestContext, scanScopeOf, type RunRequestContext } from './run-context.ts';
import { coverageProofWrite, writesCoverageProof } from './run-coverage.ts';

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
  const crawlSummary = parseCrawlSummary(scan.crawlSummaryJson);
  if (crawlSummary !== null && !isSiteRead(crawlSummary)) {
    // Every Analytics check compares a provider's view of the site with our
    // own. With no page of the site read, "no analytics tag found" would be a
    // statement about our failed crawl dressed as a statement about the site.
    await prisma.scanModule.upsert({
      where: { scanId_module: { scanId, module: ANALYTICS_MODULE } },
      create: { scanId, module: ANALYTICS_MODULE, ...unreadableRow(crawlSummary) },
      update: unreadableRow(crawlSummary),
    });
    return;
  }
  // Two independent providers, read in parallel. Bing never feeds the Google
  // checks and never contributes to the module's coverage or score — see
  // analytics/module-row.ts — so neither one failing can degrade the other.
  const [data, bing] = await Promise.all([
    collectGoogleData(deps, scan, now),
    collectBingData(deps, scan, now),
  ]);
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
  const { row, coverage } = analyticsModuleRow(
    data.snapshot,
    run,
    score,
    analyticsRequestContext(scan, data, bing),
    { snapshot: bing.snapshot, findings: bing.findings },
  );
  const statuses = await issueStatusesForModule(
    prisma,
    scan,
    ANALYTICS_MODULE,
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
    // Доказательство повторной проверки — в той же транзакции, что строка и
    // findings: Analytics пишется отдельным путём, но правило одно (§14).
    ...(writesCoverageProof(scan.plan)
      ? [coverageProofWrite(prisma, scanId, ANALYTICS_MODULE, coverage)]
      : []),
  ]);
}

/**
 * Под какой конфигурацией судили Analytics-проверки.
 *
 * Их цель — не страница, а привязанное свойство: ANALYTICS-GA-001 называет
 * property прямо в evidence, а SC-проверки судят набор страниц конкретного
 * Search Console site. Перепривязка к другому property даёт те же origin-цели
 * при совершенно других данных, поэтому она обязана запретить закрытие прошлых
 * находок (§14, run-context.ts).
 */
function analyticsRequestContext(
  scan: Scan,
  data: GoogleScanData,
  bing: BingScanResult,
): RunRequestContext {
  return {
    ...crawlRequestContext(scanScopeOf(scan)),
    ga4PropertyId: data.snapshot.analytics.data?.propertyId ?? null,
    searchConsoleSiteUrl: data.snapshot.searchConsole.data?.siteUrl ?? null,
    bingSiteUrl: bing.snapshot?.webmaster.data?.siteUrl ?? null,
  };
}

/** The Analytics row for a scan whose site was never read (§15 Unavailable). */
function unreadableRow(summary: ReturnType<typeof parseCrawlSummary>) {
  return {
    runtimeStatus: 'Unavailable',
    statusReason: (summary === null ? null : siteReachStatusReason(summary)) ?? 'SiteUnreachable',
    coverage: 0,
    score: null,
    applicableChecks: 1,
    completedApplicableChecks: 0,
    usableOutput: false,
    metadataJson: JSON.stringify({ crawl: summary }),
  };
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

/**
 * The Bing section for this scan, or an explicit "not connected" one.
 *
 * The runner already degrades internally, so reaching the catch means the Bing
 * client itself failed in a way it did not anticipate. Even then the result is a
 * snapshot: a terminal scan is never lost to a search engine that is not the one
 * the report is scored on.
 */
async function collectBingData(
  deps: WorkerDeps,
  scan: Scan,
  now: () => Date,
): Promise<BingScanResult> {
  const runner = deps.createBingDataRunner?.();
  if (runner === undefined) {
    return bingNotConnectedResult(now());
  }
  try {
    return await runner(scan.accountId, scan.siteProfileId);
  } catch (error) {
    deps.logger.warn('bing data collection failed', {
      scanId: scan.id,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    return bingStateResult('request_failed', now());
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
