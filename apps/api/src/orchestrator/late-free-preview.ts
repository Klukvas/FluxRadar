// Runs the late Free AI preview (D-236): the one question, and the check of its
// answer, that a finished Free report adds when its owner presses "Add the AI
// answer". The claim (scans/late-free-preview.ts) has already written the
// consent record and queued the GEO row; this file does the rest.
//
// Only the GEO row and its AI ledger are written. The scan's status, its SEO
// row, score, issues and crawl summary stay exactly as the finished check left
// them, and nothing here runs the scan state machine — so no outcome is
// resolved again and nothing reads this as a new scan.
//
// The two-request cap holds because the row is the gate. The attempt reads the
// homepage again while the row is still Pending (no request can have left),
// then moves it Pending → Running in one compare-and-set immediately before the
// provider step. Any later attempt — a lease recovery after a crash, a
// duplicate job — finds Running and asks nothing (`lateRunDecision`). A failure
// while the row is still Pending hands the claim back instead, because nothing
// was sent (late-free-preview-state.ts `releaseLatePreview`).

import { isSiteRead, siteReachStatusReason } from '@fluxradar/contracts';
import type { Plan } from '@fluxradar/contracts';
import { AiQuotaTracker } from '@fluxradar/ai';
import { crawl } from '@fluxradar/crawler';
import type { CrawlResult } from '@fluxradar/crawler';
import { assessAiCrawlerReadiness, createSiteContext } from '@fluxradar/rules';
import type { Scan, SiteProfile } from '@prisma/client';

import { readFreeCheckAllowlist } from '../billing/free-check-allowlist.ts';
import { logEgressUsage, recordEgressUsage } from '../integrations/crawl-egress-usage.ts';
import { competitorsFromJson } from '../profiles/competitors.ts';
import { executionProfile, storedExecutionConfig } from '../profiles/execution-config.ts';
import { uncountedCrawlBytes } from './crawl-egress-bytes.ts';
import { buildCrawlSummary } from './crawl-summary.ts';
import type { WorkerDeps } from './deps.ts';
import { freePreviewFacts, runFreeGeoPreview } from './free-geo.ts';
import { buildScanEvidence } from './geo-evidence.ts';
import { freePreviewSkippedRow } from './geo-module-row.ts';
import { LATE_PREVIEW_MODULE, lateRunDecision } from './late-free-preview-job.ts';
import {
  type LateOutcome,
  lateGeoRow,
  outcomeWhenNotPending,
  refuseRepeatedAttempt,
  releaseLatePreview,
  settleStartedFailure,
  startProviderStep,
} from './late-free-preview-state.ts';
import { setModule } from './module-persistence.ts';
import { scanScopeOf } from './run-context.ts';
import {
  CRAWLER_USER_AGENT,
  buildCrawlScope,
  loadConsent,
  persistGeoModule,
  usableEgress,
} from './run-attempt.ts';

const FREE: Plan = 'Free';

type LateScan = Scan & {
  readonly siteProfile: SiteProfile;
  readonly aiConsent: { providersJson: string; noticeVersion: string } | null;
};

/** The homepage as the scan read it: same origin, scope, robots rule and egress. */
interface HomepageRead {
  readonly origin: string;
  readonly crawl: CrawlResult;
  readonly isRead: boolean;
  /** Why it could not be read, in the scan's own reason vocabulary. */
  readonly unreadReason: string;
}

/**
 * Re-reads the homepage through the crawler the check used. A finished scan
 * keeps no crawl pages (crawl-store.ts `clearCrawlEvidence`), and the answer's
 * evaluation needs the homepage as it is now, not a stale or invented copy.
 */
async function readHomepage(deps: WorkerDeps, scan: LateScan): Promise<HomepageRead> {
  const profile = executionProfile(scan, scan.siteProfile);
  const scope = scanScopeOf(scan);
  const origin = deps.crawl?.originOverride?.(scan) ?? profile.domain;
  const egress = await usableEgress(deps, scope);
  const crawlScope = buildCrawlScope(origin, scope, FREE);
  const result = await crawl(crawlScope, {
    ...(deps.crawl?.fetcher !== undefined ? { fetcher: deps.crawl.fetcher } : {}),
    ...(egress.proxy === null ? {} : { egressProxy: egress.proxy }),
    ...(deps.crawl?.dangerouslyAllowLoopback === true ? { dangerouslyAllowLoopback: true } : {}),
    ...(deps.crawl?.limiter !== undefined ? { limiter: deps.crawl.limiter } : {}),
    probeMedia: false,
    logger: { warn: (message, context) => deps.logger.warn(message, context) },
    userAgent: scope.userAgent === 'mobile' ? `${CRAWLER_USER_AGENT} Mobile` : CRAWLER_USER_AGENT,
  });
  if (egress.location !== null) {
    // The bytes crossed the location's proxy whatever happens next.
    logEgressUsage(
      deps.logger,
      await recordEgressUsage(
        deps.prisma,
        egress.location.location,
        uncountedCrawlBytes(result, []),
        deps.now?.() ?? new Date(),
      ),
    );
  }
  const summary = buildCrawlSummary(result, origin, scope, FREE, crawlScope.maxPages);
  return {
    origin,
    crawl: result,
    isRead: isSiteRead(summary),
    unreadReason: siteReachStatusReason(summary) ?? 'SiteUnreachable',
  };
}

async function askAndPersist(deps: WorkerDeps, scan: LateScan, read: HomepageRead): Promise<void> {
  const profile = executionProfile(scan, scan.siteProfile);
  const ctx = createSiteContext({ origin: read.origin, crawl: read.crawl, plan: FREE });
  const siteHostname = new URL(ctx.domain).hostname;
  const readiness = assessAiCrawlerReadiness(read.crawl);
  const config = storedExecutionConfig(scan.executionConfigJson);
  const preview = await runFreeGeoPreview({
    scanId: scan.id,
    brand: profile.name,
    siteOrigin: ctx.domain,
    siteHostname,
    language: config?.aiLanguage ?? config?.language ?? 'en',
    explicitLanguage: config?.aiLanguage !== undefined,
    facts: freePreviewFacts({
      consent: loadConsent(scan),
      profileDomain: profile.domain,
      allowedOrigins: deps.freeCheckAllowedOrigins ?? readFreeCheckAllowlist().origins,
      // The row was Pending a moment ago: no attempt has sent anything.
      alreadyRequested: false,
    }),
    buildEvidence: () => buildScanEvidence(ctx, profile, siteHostname),
    provider: deps.createAiProvider(scan, profile),
    quota: AiQuotaTracker.forPlan(FREE),
  });
  if (preview.kind === 'skipped') {
    await setModule(
      deps.prisma,
      scan.id,
      LATE_PREVIEW_MODULE,
      freePreviewSkippedRow(preview.reason, readiness),
    );
    return;
  }
  await persistGeoModule(
    deps.prisma,
    scan.id,
    preview.geo,
    preview.generation,
    readiness,
    preview.geo.evaluatedEvidence,
    siteHostname,
    profile.name,
    competitorsFromJson(profile.competitorsJson) ?? [],
    'free-preview',
  );
}

/**
 * One late attempt:
 *  - `released` it handed the claim back (and closed its job);
 *  - `held`     another attempt holds the provider step: row and job are left
 *               to it;
 *  - `settled`  otherwise. An attempt that won the provider step settles its
 *               own failure here (`askAsWinner`), so it never throws.
 * Throws only on a platform failure before the provider step, which the worker
 * turns into a release or `held` (`recordLatePreviewFailure`).
 */
export async function runLateFreePreview(
  deps: WorkerDeps,
  scanId: string,
  jobId: string,
): Promise<LateOutcome> {
  const { prisma } = deps;
  const row = await lateGeoRow(prisma, scanId);
  const decision = lateRunDecision(row);
  if (row === null || decision === 'nothing') return 'settled';
  if (decision === 'refuse') {
    // A crash after the provider step began: record it without reading the
    // site, and never ask again.
    await refuseRepeatedAttempt(prisma, scanId, row);
    return 'settled';
  }
  const scan = (await prisma.scan.findUnique({
    where: { id: scanId },
    include: { siteProfile: true, aiConsent: true },
  })) as LateScan | null;
  // Deleted by retention or with its profile while queued: nothing to ask about.
  if (scan === null) return 'settled';
  const read = await readHomepage(deps, scan);
  if (!read.isRead) {
    const released = await releaseLatePreview(prisma, {
      scanId,
      jobId,
      reason: read.unreadReason,
      now: deps.now?.() ?? new Date(),
    });
    return released ? 'released' : outcomeWhenNotPending(prisma, scanId);
  }
  // Loses when the scan was deleted during the read, or another attempt
  // already took the step: either way, this one sends nothing and leaves the
  // row and the job to whoever holds them.
  if (!(await startProviderStep(prisma, scanId, row.metadataJson))) {
    return outcomeWhenNotPending(prisma, scanId);
  }
  return askAsWinner(deps, scan, read);
}

/**
 * The provider step, by the one attempt that won it. Its failures are this
 * attempt's to record, so they are recorded here, where it is known that the
 * Running row is this attempt's own and not another's live work.
 */
async function askAsWinner(
  deps: WorkerDeps,
  scan: LateScan,
  read: HomepageRead,
): Promise<LateOutcome> {
  try {
    await askAndPersist(deps, scan, read);
  } catch (error) {
    deps.logger.error(
      'late free AI preview failed after its provider step began',
      {
        scanId: scan.id,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      },
      error,
    );
    await settleStartedFailure(deps.prisma, scan.id);
  }
  return 'settled';
}
