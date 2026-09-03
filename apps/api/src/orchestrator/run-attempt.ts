// Одна попытка прогона скана: crawl → последовательные модули тарифа →
// GEO (mock) → запись ScanModule/Issue/AiResponseRecord. Попытка идемпотентно
// перезаписывает результат предыдущей (module retry / external retry, D-024).
// Терминализацию выполняет process-scan через resolveScanOutcome.

import type { ModuleName, Plan, ScanScopeInput } from '@fluxradar/contracts';
import { TARIFFS, scanScopeSchema } from '@fluxradar/contracts';
import { AI_PROVIDER_NAMES, runGeoModule } from '@fluxradar/ai';
import type { AiConsent, GeoModuleResult } from '@fluxradar/ai';
import { crawl } from '@fluxradar/crawler';
import type { CrawlScope } from '@fluxradar/crawler';
import { assessAiCrawlerReadiness, createSiteContext, runModuleRules } from '@fluxradar/rules';
import type { SiteContext } from '@fluxradar/rules';
import { computeCoverage } from '@fluxradar/scoring';
import type { Prisma, PrismaClient, Scan, SiteProfile } from '@prisma/client';
import { z } from 'zod';

import type { WorkerDeps } from './deps.ts';
import { runFreeCheck } from './free-check.ts';
import { buildGeoRequests } from './geo.ts';
import { initialIssueStatuses } from './issue-sync.ts';
import { modulePlanFor } from './module-plan.ts';
import { finalizeRuleModule, issueRowsForModule } from './module-result.ts';
import type { IssueRowData } from './module-result.ts';

const CRAWLER_USER_AGENT = 'FluxRadarBot/0.1';

const providersJsonSchema = z.array(z.enum(AI_PROVIDER_NAMES));

type ScanWithRelations = Scan & { readonly siteProfile: SiteProfile };

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

type ModuleRowData = {
  readonly runtimeStatus: string;
  readonly statusReason?: string | null;
  readonly coverage?: number | null;
  readonly score?: number | null;
  readonly applicableChecks?: number | null;
  readonly completedApplicableChecks?: number | null;
  readonly usableOutput?: boolean;
  readonly metadataJson?: string;
};

function metadataForRuleModule(module: ModuleName): string | undefined {
  const metadata =
    module === 'Accessibility'
      ? {
          standard: 'WCAG 2.2 AA',
          profiles: ['EN 301 549', 'Section 508'],
          automation: 'static-dom-css',
          manualReviewRequired: true,
          legalCertification: false,
        }
      : module === 'Security'
        ? {
            standard: 'OWASP ASVS',
            profile: 'Public Security Profile',
            automation: 'public-http-headers-dom',
            manualReviewRequired: true,
            notVerifiable: ['source code', 'authenticated flows', 'server-side configuration'],
          }
        : module === 'Privacy'
          ? {
              standard: 'Privacy & Consent',
              scope: 'public technical signals',
              automation: 'static-http-dom',
              manualReviewRequired: true,
              legalAdvice: false,
            }
          : module === 'SEO'
            ? {
                structuredData: 'static-html-json-ld',
                socialPreview: 'static-html-meta',
                clientRenderedMarkup: 'not verifiable without browser rendering',
              }
            : undefined;
  return metadata === undefined ? undefined : JSON.stringify(metadata);
}

async function setModule(
  prisma: PrismaClient,
  scanId: string,
  module: string,
  data: ModuleRowData,
): Promise<void> {
  await prisma.scanModule.upsert({
    where: { scanId_module: { scanId, module } },
    create: { scanId, module, runtimeStatus: data.runtimeStatus, ...withoutStatus(data) },
    update: { runtimeStatus: data.runtimeStatus, ...withoutStatus(data) },
  });
}

function withoutStatus(data: ModuleRowData): Omit<ModuleRowData, 'runtimeStatus'> {
  const { runtimeStatus, ...rest } = data;
  void runtimeStatus;
  return rest;
}

function loadConsent(
  scan: Scan & { aiConsent?: { providersJson: string; noticeVersion: string } | null },
): AiConsent | null {
  const record = scan.aiConsent ?? null;
  if (record === null) {
    return null;
  }
  let rawProviders: unknown;
  try {
    rawProviders = JSON.parse(record.providersJson) as unknown;
  } catch {
    return null;
  }
  const providers = providersJsonSchema.safeParse(rawProviders);
  if (!providers.success) {
    // Битая запись consent трактуется как отсутствие согласия (fail-closed §5).
    return null;
  }
  return { scanId: scan.id, providers: providers.data, noticeVersion: record.noticeVersion };
}

async function persistGeoModule(
  prisma: PrismaClient,
  scanId: string,
  geo: GeoModuleResult,
  aiCrawlerReadiness: ReturnType<typeof assessAiCrawlerReadiness>,
): Promise<void> {
  const coverage = computeCoverage({
    applicableChecks: geo.outcomes.length,
    completedApplicableChecks: geo.responses.length,
    ...(geo.statusReason !== null ? { statusReason: geo.statusReason } : {}),
  });
  // Informational-only модуль (D-109): штрафующих правил нет, поэтому score
  // Completed/Partial-ветки всегда 100 − 0; сами находки идут в ai_response
  // records и findings GEO-правил, а не в Issue Center (§16: issue.severity
  // не бывает null).
  const score = coverage.status === 'Completed' || coverage.status === 'Partial' ? 100 : null;
  await setModule(prisma, scanId, geo.module, {
    runtimeStatus: coverage.status,
    statusReason: coverage.statusReason,
    coverage: coverage.coverage,
    score,
    applicableChecks: coverage.applicableChecks,
    completedApplicableChecks: coverage.completedApplicableChecks,
    usableOutput: geo.responses.length > 0,
    metadataJson: JSON.stringify({
      standard: 'AI crawler readiness',
      automation: aiCrawlerReadiness.automation,
      providerTokenRequired: aiCrawlerReadiness.providerTokenRequired,
      robots: aiCrawlerReadiness.robots,
      pages: aiCrawlerReadiness.pages,
      limitations: aiCrawlerReadiness.limitations,
      providerVisibility: {
        status: geo.status,
        statusReason: geo.statusReason,
        requiresConsent: true,
      },
    }),
  });

  for (const outcome of geo.responses) {
    const { response, request } = outcome;
    await prisma.aiResponseRecord.upsert({
      where: { aiRequestKey: outcome.aiRequestKey },
      create: {
        scanId,
        provider: response.provider,
        apiVersion: response.apiVersion,
        modelId: response.modelId,
        promptVersion: request.promptVersion,
        requestId: response.requestId,
        requestIdSource: response.requestIdSource,
        aiRequestKey: outcome.aiRequestKey,
        usageJson: JSON.stringify(response.usage),
        usageSource: response.usageSource,
        rawText: response.rawText,
        citationsJson: JSON.stringify(response.citations),
        finishReason: response.finishReason,
        // §16/AI-001: непустая ссылка на deletion-control record создаётся
        // одновременно с ai_response; сам контроль может быть Pending.
        deletionEvidenceRef: `ai-001/deletion/${outcome.aiRequestKey}`,
        createdAt: new Date(response.createdAt),
      },
      // Повтор с тем же ai_request_key — тот же ответ; ничего не перезаписываем.
      update: {},
    });
  }
}

/** Полная попытка прогона; бросает только при platform-сбое (обрабатывает вызывающий). */
export async function runScanAttempt(
  deps: WorkerDeps,
  scanId: string,
  retryModule?: string,
): Promise<void> {
  const { prisma } = deps;
  const now = deps.now ?? ((): Date => new Date());
  const scan = (await prisma.scan.findUnique({
    where: { id: scanId },
    include: { siteProfile: true, aiConsent: true },
  })) as
    | (ScanWithRelations & { aiConsent: { providersJson: string; noticeVersion: string } | null })
    | null;
  if (scan === null) {
    throw new Error(`runScanAttempt: scan ${scanId} not found`);
  }
  const plan = scan.plan as Plan;
  const modulePlan = modulePlanFor(plan);
  const scope = parseScope(scan.scopeJson);
  const origin = deps.crawl?.originOverride?.(scan) ?? scan.domain;

  const plannedModules = [
    ...modulePlan.runnable,
    ...(modulePlan.geo ? ['AI SEO / GEO'] : []),
    ...modulePlan.external,
  ];
  const targetModules = retryModule === undefined ? plannedModules : [retryModule];
  if (
    retryModule !== undefined &&
    !plannedModules.includes(retryModule as (typeof plannedModules)[number])
  ) {
    throw new Error(`runScanAttempt: module ${retryModule} is not runnable for ${plan}`);
  }
  // Full attempts replace the snapshot. A module retry replaces only its own
  // rows, preserving usable output and evidence from the other modules.
  await prisma.issue.deleteMany({
    where: { scanId, ...(retryModule === undefined ? {} : { module: retryModule }) },
  });
  if (retryModule === undefined || retryModule === 'AI SEO / GEO') {
    await prisma.aiResponseRecord.deleteMany({ where: { scanId } });
  }
  await prisma.scanModule.deleteMany({
    where: { scanId, ...(retryModule === undefined ? {} : { module: retryModule }) },
  });
  for (const module of targetModules) {
    await setModule(prisma, scanId, module, { runtimeStatus: 'Pending' });
  }

  const crawlResult = await crawl(buildCrawlScope(origin, scope, plan), {
    ...(deps.crawl?.fetcher !== undefined ? { fetcher: deps.crawl.fetcher } : {}),
    ...(deps.crawl?.dangerouslyAllowLoopback === true ? { dangerouslyAllowLoopback: true } : {}),
    ...(deps.crawl?.limiter !== undefined ? { limiter: deps.crawl.limiter } : {}),
    logger: { warn: (message, context) => deps.logger.warn(message, context) },
    userAgent: scope.userAgent === 'mobile' ? `${CRAWLER_USER_AGENT} Mobile` : CRAWLER_USER_AGENT,
  });
  const ctx: SiteContext = createSiteContext({ origin, crawl: crawlResult, plan });
  const siteReachable = crawlResult.pages.some((page) => page.fetchError === undefined);
  // Эффективный normalized origin — поле domain fingerprint-ов и export context
  // (в тестах обходится fixture-origin, а не https-домен профиля).
  await prisma.scan.update({ where: { id: scanId }, data: { domain: ctx.domain } });

  const observedAt = now();
  const issueRows: IssueRowData[] = [];
  for (const module of modulePlan.runnable.filter((candidate) =>
    targetModules.includes(candidate),
  )) {
    await setModule(prisma, scanId, module, { runtimeStatus: 'Running' });
    const result = plan === 'Free' ? runFreeCheck(ctx) : runModuleRules(module, ctx);
    const finalized = finalizeRuleModule(result, plan, siteReachable);
    await setModule(prisma, scanId, module, {
      runtimeStatus: finalized.runtimeStatus,
      statusReason: finalized.statusReason,
      coverage: finalized.coverage,
      score: finalized.score,
      applicableChecks: finalized.applicableChecks,
      completedApplicableChecks: finalized.completedApplicableChecks,
      usableOutput: finalized.usableOutput,
      ...(metadataForRuleModule(module) !== undefined
        ? { metadataJson: metadataForRuleModule(module) }
        : {}),
    });
    issueRows.push(...issueRowsForModule(scanId, module, result.findings, finalized, observedAt));
  }

  if (modulePlan.geo && targetModules.includes('AI SEO / GEO')) {
    await setModule(prisma, scanId, 'AI SEO / GEO', { runtimeStatus: 'Running' });
    const siteHostname = new URL(ctx.domain).hostname;
    const geo = await runGeoModule(
      {
        scanId,
        plan,
        brand: scan.siteProfile.name,
        siteOrigin: ctx.domain,
        siteDomain: siteHostname,
        consent: loadConsent(scan),
        requests: buildGeoRequests(scanId, scan.siteProfile.name, siteHostname),
      },
      { provider: deps.createAiProvider(scan, scan.siteProfile) },
    );
    await persistGeoModule(prisma, scanId, geo, assessAiCrawlerReadiness(crawlResult));
  }

  for (const module of modulePlan.external.filter((candidate) =>
    targetModules.includes(candidate),
  )) {
    await setModule(prisma, scanId, module, { runtimeStatus: 'Running' });
    if (module !== 'Performance') continue;
    const runner = deps.createPerformanceRunner?.();
    if (runner === undefined) {
      await setModule(prisma, scanId, module, {
        runtimeStatus: 'Unavailable',
        statusReason: 'PerformanceIntegrationNotConfigured',
        coverage: 0,
        score: null,
        applicableChecks: 1,
        completedApplicableChecks: 0,
        usableOutput: false,
      });
      continue;
    }
    try {
      const snapshot = await runner(ctx.domain, scope.userAgent ?? 'desktop');
      await setModule(prisma, scanId, module, {
        runtimeStatus: snapshot.performanceScore === null ? 'Partial' : 'Completed',
        ...(snapshot.performanceScore === null
          ? { statusReason: 'PerformanceScoreUnavailable' }
          : {}),
        coverage: snapshot.performanceScore === null ? 0.5 : 1,
        score: snapshot.performanceScore,
        applicableChecks: 1,
        completedApplicableChecks: 1,
        usableOutput: true,
        metadataJson: JSON.stringify(snapshot),
      });
    } catch {
      // External performance data is optional: a provider outage must be shown
      // as unavailable and must not fail an otherwise valid website scan.
      await setModule(prisma, scanId, module, {
        runtimeStatus: 'Unavailable',
        statusReason: 'PerformanceProviderUnavailable',
        coverage: 0,
        score: null,
        applicableChecks: 1,
        completedApplicableChecks: 0,
        usableOutput: false,
      });
    }
  }

  // Начальные статусы (Reopened/перенос пользовательских, §14/D-110) и вставка.
  const statuses = await initialIssueStatuses(
    prisma,
    scan,
    issueRows.map((row) => row.fingerprint),
  );
  if (issueRows.length > 0) {
    await prisma.issue.createMany({
      data: issueRows.map((row): Prisma.IssueCreateManyInput => ({
        ...row,
        status: statuses.get(row.fingerprint) ?? 'New',
      })),
    });
  }
}
