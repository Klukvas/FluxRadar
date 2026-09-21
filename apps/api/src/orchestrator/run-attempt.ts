// Одна попытка прогона скана: crawl → последовательные модули тарифа →
// GEO provider → запись ScanModule/Issue/AiResponseRecord. Попытка идемпотентно
// перезаписывает результат предыдущей (module retry / external retry, D-024).
// Терминализацию выполняет process-scan через resolveScanOutcome.

import type { ModuleName, Plan, ScanScopeInput } from '@fluxradar/contracts';
import { TARIFFS, scanScopeSchema, severityRank } from '@fluxradar/contracts';
import {
  AI_PROVIDER_NAMES,
  AiQuotaTracker,
  CURRENT_AI_PROCESSING_NOTICE_VERSION,
  runGeoModule,
} from '@fluxradar/ai';
import type { AiConsent, GeoModuleResult } from '@fluxradar/ai';
import { crawl } from '@fluxradar/crawler';
import type { CrawlScope } from '@fluxradar/crawler';
import {
  analyticsPageFacts,
  analyzeUxStatic,
  assessAiCrawlerReadiness,
  createSiteContext,
  runModuleRules,
} from '@fluxradar/rules';
import type { AnalyticsPageFact, ModuleRunResult, SiteContext } from '@fluxradar/rules';
import { computeCoverage } from '@fluxradar/scoring';
import type { Prisma, PrismaClient, Scan, SiteProfile } from '@prisma/client';
import { z } from 'zod';

import { readCrawlEgressProxy } from '../integrations/crawl-egress-config.ts';
import { executionProfile, storedExecutionConfig } from '../profiles/execution-config.ts';
import { persistAiResponse, redactEvidence } from './ai-evidence.ts';
import type { WorkerDeps } from './deps.ts';
import { freeCheckMetadata, runFreeCheck } from './free-check.ts';
import {
  buildGeoRequests,
  generateGeoDiscoveryQuestions,
  type GeoQuestionGenerationResult,
} from './geo.ts';
import { resolveEgressProxy } from './egress.ts';
import { initialIssueStatuses } from './issue-sync.ts';
import { includesAnalytics, modulePlanFor } from './module-plan.ts';
import { finalizeRuleModule, issueRowsForModule } from './module-result.ts';
import type { IssueRowData } from './module-result.ts';
import { ruleCheckSummaries, uxRuleCheckSummaries } from './rule-checks.ts';
import { runUxConversion } from './ux.ts';

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

function metadataForRuleModule(
  module: ModuleName,
  plan: Plan,
  evaluations: ModuleRunResult['evaluations'],
): string {
  // Every rule module records what each of its checks did, so the report can
  // open a section card to that list instead of showing only its totals.
  const ruleChecks = ruleCheckSummaries(evaluations);
  if (plan === 'Free' && module === 'SEO') {
    // Free runs the fixed four-rule homepage check, not the full SEO module:
    // the paid module's structured-data and social-preview metadata would
    // describe checks that never ran (see free-check.ts).
    return JSON.stringify({ ...freeCheckMetadata(), ruleChecks });
  }
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
  return JSON.stringify({ ...metadata, ruleChecks });
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
  if (record === null || record.noticeVersion !== CURRENT_AI_PROCESSING_NOTICE_VERSION) {
    // A historical record cannot establish that the disclosure for the current
    // paid AI processing was shown before purchase.
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
  generation: GeoQuestionGenerationResult,
  aiCrawlerReadiness: ReturnType<typeof assessAiCrawlerReadiness>,
): Promise<void> {
  const mentionSignals = (
    aiRequestKey: string,
  ): { readonly brand: boolean; readonly domain: boolean } | null => {
    const brandEvaluation = geo.evaluations.find(
      (evaluation) => evaluation.ruleId === 'GEO-VIS-003',
    );
    const domainEvaluation = geo.evaluations.find(
      (evaluation) => evaluation.ruleId === 'GEO-VIS-004',
    );
    if (brandEvaluation === undefined || domainEvaluation === undefined) return null;
    return {
      brand: !brandEvaluation.findings.some((finding) => finding.aiRequestKey === aiRequestKey),
      domain: !domainEvaluation.findings.some((finding) => finding.aiRequestKey === aiRequestKey),
    };
  };
  const reasonParts = [
    geo.statusReason,
    generation.status === 'Unavailable' || generation.status === 'InvalidResponse'
      ? `QueryGeneration${generation.status}: ${generation.statusReason ?? 'unknown reason'}`
      : null,
  ].filter((reason): reason is string => reason !== null);
  const coverage = computeCoverage({
    applicableChecks: geo.outcomes.length + generation.applicableChecks,
    completedApplicableChecks: geo.responses.length + generation.completedApplicableChecks,
    ...(reasonParts.length > 0 ? { statusReason: reasonParts.join('; ') } : {}),
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
        status: coverage.status,
        statusReason: coverage.statusReason,
        requiresConsent: true,
        method: 'AI-generated neutral context questions plus direct brand-awareness questions',
        interpretation: 'Prompt-specific observations; mentions do not prove remembered knowledge.',
        queryGeneration: {
          status: generation.status,
          statusReason: generation.statusReason,
          promptVersion: generation.outcome?.request.promptVersion ?? null,
          generatedQuestions: redactEvidence(generation.questions),
          ...(generation.outcome?.kind === 'response'
            ? {
                aiRequestKey: generation.outcome.aiRequestKey,
                usage: generation.outcome.response.usage,
              }
            : generation.outcome?.kind === 'unavailable'
              ? { reason: generation.outcome.reason }
              : {}),
        },
        requests: geo.outcomes.map((outcome) => ({
          purpose: outcome.request.promptVersion.endsWith('-discovery') ? 'discovery' : 'awareness',
          promptVersion: outcome.request.promptVersion,
          sequence: outcome.request.sequence,
          status: outcome.kind,
          question: redactEvidence(outcome.request.question),
          ...(outcome.kind === 'response'
            ? {
                aiRequestKey: outcome.aiRequestKey,
                usage: outcome.response.usage,
                mentions: mentionSignals(outcome.aiRequestKey),
              }
            : { reason: outcome.reason }),
        })),
      },
    }),
  });

  if (generation.outcome?.kind === 'response') {
    await persistAiResponse(prisma, scanId, 'AI SEO / GEO', generation.outcome);
  }
  for (const outcome of geo.responses) {
    await persistAiResponse(prisma, scanId, 'AI SEO / GEO', outcome);
  }
}

async function persistUxModule(
  prisma: PrismaClient,
  scanId: string,
  ux: Awaited<ReturnType<typeof runUxConversion>>,
): Promise<void> {
  const deterministicChecks = 3;
  const aiResponse = ux.ai.outcome.kind === 'response' ? ux.ai.outcome.response : null;
  const aiRequestKey = ux.ai.outcome.kind === 'response' ? ux.ai.outcome.aiRequestKey : undefined;
  // Coverage counts the three declared deterministic rules plus the one AI
  // review, not the number of pages. Page count made a 12-page scan look 92%
  // complete when its entire AI quarter had not run.
  const completedApplicableChecks = deterministicChecks + (aiResponse === null ? 0 : 1);
  const applicableChecks = deterministicChecks + 1;
  const uxReason = ux.ai.statusReason === null ? null : `UxAi${ux.ai.statusReason}`;
  await setModule(prisma, scanId, 'UX/Conversion', {
    runtimeStatus: aiResponse === null ? 'Partial' : 'Completed',
    statusReason: aiResponse === null ? uxReason : null,
    coverage: completedApplicableChecks / applicableChecks,
    // A Partial run scores only the checks that ran (§15): without the AI review
    // that is the three static rules, and the coverage above says so.
    score: ux.score,
    applicableChecks,
    completedApplicableChecks,
    usableOutput: ux.staticEvidence.pages.length > 0,
    metadataJson: JSON.stringify({
      standard: 'UX/Conversion',
      automation: 'static-html + AI-assisted',
      providerTokenRequired: true,
      limitation: ux.staticEvidence.limitation,
      staticSignals: ux.staticEvidence.summary,
      staticFindings: ux.staticEvidence.findings.length,
      ruleChecks: uxRuleCheckSummaries(ux.staticEvidence, ux.ai),
      pages: redactEvidence(ux.staticEvidence.pages),
      ai: {
        status: ux.ai.status,
        statusReason: uxReason,
        findings: ux.ai.findings.length,
        ...(aiResponse === null
          ? {}
          : {
              provider: aiResponse.provider,
              modelId: aiResponse.modelId,
              promptVersion: ux.ai.outcome.request.promptVersion,
              requestId: aiResponse.requestId,
              aiRequestKey,
              usage: aiResponse.usage,
            }),
      },
    }),
  });
  if (ux.ai.outcome.kind === 'response') {
    await persistAiResponse(prisma, scanId, 'UX/Conversion', ux.ai.outcome);
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
  const profile = executionProfile(scan, scan.siteProfile);
  const modulePlan = modulePlanFor(plan);
  const scope =
    storedExecutionConfig(scan.executionConfigJson)?.scope ?? parseScope(scan.scopeJson);
  const origin = deps.crawl?.originOverride?.(scan) ?? profile.domain;

  const plannedModules = [
    ...modulePlan.runnable,
    ...(modulePlan.geo ? ['AI SEO / GEO'] : []),
    ...modulePlan.external,
    ...(modulePlan.ux ? ['UX/Conversion'] : []),
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
  if (retryModule === undefined) {
    await prisma.aiResponseRecord.deleteMany({ where: { scanId } });
  } else if (retryModule === 'AI SEO / GEO' || retryModule === 'UX/Conversion') {
    await prisma.aiResponseRecord.deleteMany({ where: { scanId, module: retryModule } });
  }
  await prisma.scanModule.deleteMany({
    where: { scanId, ...(retryModule === undefined ? {} : { module: retryModule }) },
  });
  for (const module of targetModules) {
    await setModule(prisma, scanId, module, { runtimeStatus: 'Pending' });
  }

  const egressProxy = resolveEgressProxy(deps.crawl, readCrawlEgressProxy());
  const crawlResult = await crawl(buildCrawlScope(origin, scope, plan), {
    ...(deps.crawl?.fetcher !== undefined ? { fetcher: deps.crawl.fetcher } : {}),
    ...(egressProxy === null ? {} : { egressProxy }),
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
  let aiQuota = AiQuotaTracker.forPlan(plan);
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
      metadataJson: metadataForRuleModule(module, plan, result.evaluations),
    });
    issueRows.push(...issueRowsForModule(scanId, module, result.findings, finalized, observedAt));
  }

  if (modulePlan.geo && targetModules.includes('AI SEO / GEO')) {
    await setModule(prisma, scanId, 'AI SEO / GEO', { runtimeStatus: 'Running' });
    const siteHostname = new URL(ctx.domain).hostname;
    const consent = loadConsent(scan);
    const provider = deps.createAiProvider(scan, profile);
    const generation = await generateGeoDiscoveryQuestions({
      scanId,
      brand: profile.name,
      siteHostname,
      context: profile,
      consent,
      provider,
      quota: aiQuota,
    });
    const geo = await runGeoModule(
      {
        scanId,
        plan,
        brand: profile.name,
        siteOrigin: ctx.domain,
        siteDomain: siteHostname,
        consent,
        requests: buildGeoRequests(scanId, profile.name, siteHostname, generation.questions),
      },
      { provider, quota: generation.quota },
    );
    await persistGeoModule(prisma, scanId, geo, generation, assessAiCrawlerReadiness(crawlResult));
    aiQuota = geo.quota;
  }

  if (modulePlan.ux && targetModules.includes('UX/Conversion')) {
    await setModule(prisma, scanId, 'UX/Conversion', { runtimeStatus: 'Running' });
    const uxEvidence = analyzeUxStatic(ctx);
    if (uxEvidence.pages.length === 0) {
      await setModule(prisma, scanId, 'UX/Conversion', {
        runtimeStatus: 'Unavailable',
        statusReason: 'TargetsUnreachable',
        coverage: 0,
        score: null,
        applicableChecks: 1,
        completedApplicableChecks: 0,
        usableOutput: false,
        metadataJson: JSON.stringify({
          standard: 'UX/Conversion',
          automation: 'static-html + AI-assisted',
          providerTokenRequired: true,
          limitation: 'static-html-only',
        }),
      });
    } else {
      const ux = await runUxConversion(
        scanId,
        'Complete',
        profile.name,
        ctx.domain,
        ctx,
        profile,
        loadConsent(scan),
        deps.createAiProvider(scan, profile),
        aiQuota,
        observedAt,
      );
      await persistUxModule(prisma, scanId, ux);
      issueRows.push(...ux.issueRows);
    }
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
        severityRank: severityRank(row.severity),
        status: statuses.get(row.fingerprint) ?? 'New',
      })),
    });
  }
  return {
    analyticsPages: includesAnalytics(plan) ? analyticsPageFacts(ctx) : [],
  };
}
