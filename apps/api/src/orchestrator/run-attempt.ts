// Одна попытка прогона скана: crawl → последовательные модули тарифа →
// GEO provider → запись ScanModule/Issue/AiResponseRecord. Попытка идемпотентно
// перезаписывает результат предыдущей (module retry / external retry, D-024).
// Терминализацию выполняет process-scan через resolveScanOutcome.

import type { CrawlSummary, Plan, ScanScopeInput } from '@fluxradar/contracts';
import {
  CRAWL_LIMITS,
  TARIFFS,
  isSiteRead,
  scanScopeSchema,
  severityRank,
} from '@fluxradar/contracts';
import { crawl, crawlerUserAgent } from '@fluxradar/crawler';
import type { CrawlResult, CrawlScope } from '@fluxradar/crawler';
import { analyticsPageFacts, createSiteContext } from '@fluxradar/rules';
import type { AnalyticsPageFact, SiteContext } from '@fluxradar/rules';
import type { Prisma, PrismaClient } from '@prisma/client';

import { readCrawlEgressLocations } from '../integrations/crawl-egress-config.ts';
import {
  isEgressUsable,
  logEgressHealth,
  probeEgressProxy,
  readEgressProbeOptions,
} from '../integrations/crawl-egress-health.ts';
import { logEgressUsage, recordEgressUsage } from '../integrations/crawl-egress-usage.ts';
import { buildCrawlSummary } from './crawl-summary.ts';
import { executionProfile, storedExecutionConfig } from '../profiles/execution-config.ts';
import { resetActionPlans } from '../action-plan/run-state.ts';
import {
  markEveryModuleUnreadable,
  runModuleSteps,
  setModule,
  type AttemptScan,
  type ScanAttempt,
} from './attempt-modules.ts';
import type { WorkerDeps } from './deps.ts';
import { resolveScanEgress, type ScanEgress } from './egress.ts';
import { initialIssueStatuses } from './issue-sync.ts';
import { includesAnalytics, modulePlanFor, type ModulePlan } from './module-plan.ts';
import type { IssueRowData } from './module-result.ts';

function parseScope(scopeJson: string): ScanScopeInput {
  try {
    const parsed = scanScopeSchema.safeParse(JSON.parse(scopeJson));
    if (parsed.success) {
      return parsed.data;
    }
  } catch {
    // Невалидный JSON в scopeJson — падаем на дефолт ниже.
  }
  return scanScopeSchema.parse({ includeSubdomains: false });
}

function buildCrawlScope(origin: string, scope: ScanScopeInput, plan: Plan): CrawlScope {
  const { urlLimit } = TARIFFS[plan];
  if (plan === 'Free') {
    // §18: Free — ровно одна homepage-проверка, ссылки не обходим.
    return { origin, includeSubdomains: false, maxPages: 1, maxDepth: 0 };
  }
  return {
    origin,
    includeSubdomains: scope.includeSubdomains,
    maxPages: Math.min(scope.maxPages ?? urlLimit, urlLimit),
    ...(scope.maxDepth !== undefined ? { maxDepth: scope.maxDepth } : {}),
    ...(scope.urlPatterns !== undefined ? { includePatterns: scope.urlPatterns } : {}),
    ...(scope.excludePatterns !== undefined ? { excludePatterns: scope.excludePatterns } : {}),
    queryPolicy: scope.queryPolicy,
    respectRobots: scope.respectRobots,
    robotsOverrideConfirmed: scope.robotsOverrideConfirmed,
  };
}

/**
 * Bytes of page and media bodies this crawl pulled.
 *
 * A floor for the proxy's traffic, not a bill: headers, TLS and retries are not
 * in it. It is what we can attribute to a scan, and the warning threshold is
 * set low enough that the gap is covered.
 */
function bytesRead(crawlResult: CrawlResult): number {
  return [...crawlResult.pages, ...crawlResult.mediaChecks].reduce(
    (total, page) => total + (page.html === null ? 0 : Buffer.byteLength(page.html, 'utf8')),
    0,
  );
}

/** An attempt, and where its crawl starts. */
interface LoadedAttempt extends ScanAttempt {
  readonly origin: string;
}

/** The modules an attempt runs: every one the plan has, or the one a retry names. */
function attemptTargets(
  modulePlan: ModulePlan,
  plan: Plan,
  retryModule: string | undefined,
): readonly string[] {
  const plannedModules = [
    ...modulePlan.runnable,
    ...(modulePlan.geo ? ['AI SEO / GEO'] : []),
    ...modulePlan.external,
    ...(modulePlan.ux ? ['UX/Conversion'] : []),
  ];
  if (retryModule === undefined) return plannedModules;
  if (!plannedModules.includes(retryModule as (typeof plannedModules)[number])) {
    throw new Error(`runScanAttempt: module ${retryModule} is not runnable for ${plan}`);
  }
  return [retryModule];
}

async function loadAttempt(
  deps: WorkerDeps,
  scanId: string,
  retryModule: string | undefined,
): Promise<LoadedAttempt> {
  const scan = (await deps.prisma.scan.findUnique({
    where: { id: scanId },
    include: { siteProfile: true, aiConsent: true },
  })) as AttemptScan | null;
  if (scan === null) {
    throw new Error(`runScanAttempt: scan ${scanId} not found`);
  }
  const plan = scan.plan as Plan;
  const profile = executionProfile(scan, scan.siteProfile);
  const modulePlan = modulePlanFor(plan);
  const scope =
    storedExecutionConfig(scan.executionConfigJson)?.scope ?? parseScope(scan.scopeJson);
  return {
    scan,
    profile,
    plan,
    scope,
    modulePlan,
    origin: deps.crawl?.originOverride?.(scan) ?? profile.domain,
    targetModules: attemptTargets(modulePlan, plan, retryModule),
  };
}

/**
 * Full attempts replace the snapshot. A module retry replaces only its own
 * rows, preserving usable output and evidence from the other modules.
 */
async function clearEarlierResults(
  prisma: PrismaClient,
  scanId: string,
  retryModule: string | undefined,
  targetModules: readonly string[],
): Promise<void> {
  await prisma.issue.deleteMany({
    where: { scanId, ...(retryModule === undefined ? {} : { module: retryModule }) },
  });
  if (retryModule === undefined) {
    await prisma.aiResponseRecord.deleteMany({ where: { scanId } });
  } else if (retryModule === 'AI SEO / GEO' || retryModule === 'UX/Conversion') {
    await prisma.aiResponseRecord.deleteMany({ where: { scanId, module: retryModule } });
  }
  await prisma.scanModule.deleteMany({
    where: { scanId, ...(retryModule === undefined ? {} : { module: retryModule }) },
  });
  // Either way the Action Plans were written from issues deleted above, so
  // they go, and the scan's plan budget starts over with the new snapshot. A
  // generation still in flight loses its token here and cannot write (D-232).
  await resetActionPlans(prisma, scanId);
  for (const module of targetModules) {
    await setModule(prisma, scanId, module, { runtimeStatus: 'Pending' });
  }
}

async function usableEgress(deps: WorkerDeps, scope: ScanScopeInput): Promise<ScanEgress> {
  // The location recorded at launch (D-228). A location that has since been
  // unconfigured throws here, before a request: crawling it from somewhere
  // else would put a country on the report that the crawl never left from.
  const egress = resolveScanEgress(
    deps.crawl,
    scope.egressLocation,
    deps.egressLocations ?? readCrawlEgressLocations(),
  );
  const egressLocationId = egress.location?.location.id ?? null;
  // Before a single request. Each proxy is one VPS, and when it is down every
  // fetch fails — which the crawl would otherwise read as "the customer's site
  // is unreachable", spending their paid scan on our outage and telling them
  // their site is broken. Going direct instead is not an option either: that
  // is the Hetzner block the proxy exists to avoid (D-220), and another
  // location is a different country from the one the owner chose. So the
  // attempt stops, loudly, and the worker treats it as the platform failure it is.
  const egressHealth = await (deps.probeEgress ?? probeEgressProxy)(egress.proxy, {
    ...readEgressProbeOptions(),
    expectedIp: egress.location?.expectedIp ?? null,
  });
  logEgressHealth(deps.logger, egressHealth, egressLocationId);
  if (!isEgressUsable(egressHealth)) {
    throw new Error(
      `runScanAttempt: crawl egress proxy${egressLocationId === null ? '' : ` for ${egressLocationId}`}` +
        ` is ${egressHealth.state}` +
        `${egressHealth.detail === null ? '' : ` (${egressHealth.detail})`}`,
    );
  }
  return egress;
}

function crawlSite(
  deps: WorkerDeps,
  attempt: LoadedAttempt,
  crawlScope: CrawlScope,
  egressProxy: ScanEgress['proxy'],
): Promise<CrawlResult> {
  return crawl(crawlScope, {
    ...(deps.crawl?.fetcher !== undefined ? { fetcher: deps.crawl.fetcher } : {}),
    ...(egressProxy === null ? {} : { egressProxy }),
    ...(deps.crawl?.dangerouslyAllowLoopback === true ? { dangerouslyAllowLoopback: true } : {}),
    ...(deps.crawl?.limiter !== undefined ? { limiter: deps.crawl.limiter } : {}),
    logger: { warn: (message, context) => deps.logger.warn(message, context) },
    userAgent: crawlerUserAgent(attempt.scope.userAgent),
    // Ask whether the site's own images and media exist, within a budget.
    // CONTENT-004 reports only what this verified; before it, the rule
    // penalised "media not confirmed by the crawl" on a crawl that requested
    // no media at all. A Free check is the homepage and nothing else.
    maxMediaChecks: attempt.plan === 'Free' ? 0 : CRAWL_LIMITS.maxMediaChecks,
  });
}

interface CrawledSite {
  readonly ctx: SiteContext;
  readonly crawlResult: CrawlResult;
  readonly crawlSummary: CrawlSummary;
}

/** Crawls the site through a checked egress, and records what the crawl saw on the scan. */
async function crawlAndRecord(
  deps: WorkerDeps,
  attempt: LoadedAttempt,
  now: () => Date,
): Promise<CrawledSite> {
  const { origin, scope, plan } = attempt;
  const egress = await usableEgress(deps, scope);
  const crawlScope = buildCrawlScope(origin, scope, plan);
  const crawlResult = await crawlSite(deps, attempt, crawlScope, egress.proxy);
  const ctx: SiteContext = createSiteContext({ origin, crawl: crawlResult, plan });
  const crawlSummary = buildCrawlSummary(crawlResult, origin, scope, plan, crawlScope.maxPages);
  if (egress.location !== null) {
    // Counted only when it actually crossed a configured location's proxy, and
    // against that location's plan, so a local fixture run and a direct crawl
    // never inflate a hosting plan's usage.
    logEgressUsage(
      deps.logger,
      await recordEgressUsage(deps.prisma, egress.location.location, bytesRead(crawlResult), now()),
    );
  }
  // Эффективный normalized origin — поле domain fingerprint-ов и export context
  // (в тестах обходится fixture-origin, а не https-домен профиля).
  await deps.prisma.scan.update({
    where: { id: attempt.scan.id },
    data: { domain: ctx.domain, crawlSummaryJson: JSON.stringify(crawlSummary) },
  });
  return { ctx, crawlResult, crawlSummary };
}

/** Начальные статусы (Reopened/перенос пользовательских, §14/D-110) и вставка. */
async function insertIssues(
  prisma: PrismaClient,
  scan: AttemptScan,
  issueRows: readonly IssueRowData[],
): Promise<void> {
  const statuses = await initialIssueStatuses(
    prisma,
    scan,
    issueRows.map((row) => row.fingerprint),
  );
  if (issueRows.length > 0) {
    await prisma.issue.createMany({
      data: issueRows.map((row): Prisma.IssueCreateManyInput => ({
        ...row,
        severityRank: severityRank(row.severity),
        status: statuses.get(row.fingerprint) ?? 'New',
      })),
    });
  }
}

/**
 * What an attempt hands to the post-outcome phase. Analytics runs after the
 * scan outcome is settled (analytics-module.ts), when the crawl is gone, so the
 * attempt passes on the per-page facts its checks compare with Google data.
 */
export interface ScanAttemptFacts {
  readonly analyticsPages: readonly AnalyticsPageFact[];
}

/** Полная попытка прогона; бросает только при platform-сбое (обрабатывает вызывающий). */
export async function runScanAttempt(
  deps: WorkerDeps,
  scanId: string,
  retryModule?: string,
): Promise<ScanAttemptFacts> {
  const now = deps.now ?? ((): Date => new Date());
  const attempt = await loadAttempt(deps, scanId, retryModule);
  await clearEarlierResults(deps.prisma, scanId, retryModule, attempt.targetModules);
  const site = await crawlAndRecord(deps, attempt, now);
  // A site is read when at least one page of it was read — a 2xx response that
  // carried a document. It used to be "at least one request did not throw",
  // which a WAF challenge page satisfies: the 403 arrives over a perfectly
  // healthy connection, so a site that had blocked us entirely was audited as
  // a site with no robots.txt and no 200 responses, and scored 96.95.
  if (!isSiteRead(site.crawlSummary)) {
    // Nothing downstream has a site to work on, so nothing downstream runs: no
    // rules over a challenge page, no AI quota spent on a scan that is about to
    // be refunded, and no PSI number that would make this Partial instead of
    // Failed. Every planned module says the same thing, and says why.
    await markEveryModuleUnreadable(deps.prisma, scanId, attempt.targetModules, site.crawlSummary);
    return { analyticsPages: [] };
  }
  const step = { ...attempt, deps, observedAt: now() };
  const issueRows = await runModuleSteps(step, site.ctx, site.crawlResult);
  await insertIssues(deps.prisma, attempt.scan, issueRows);
  return {
    analyticsPages: includesAnalytics(attempt.plan) ? analyticsPageFacts(site.ctx) : [],
  };
}
