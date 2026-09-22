// The modules of one scan attempt, in the tariff's order — the rule modules,
// AI SEO / GEO, UX/Conversion, then external data — and the row each records.
// run-attempt.ts crawls the site and hands the result here.

import type { CrawlSummary, ModuleName, Plan, ScanScopeInput } from '@fluxradar/contracts';
import { siteReachStatusReason } from '@fluxradar/contracts';
import {
  AI_PROVIDER_NAMES,
  AiQuotaTracker,
  CURRENT_AI_PROCESSING_NOTICE_VERSION,
  runGeoModule,
} from '@fluxradar/ai';
import type { AiConsent, GeoMentionSignals, GeoModuleResult } from '@fluxradar/ai';
import type { CrawlResult } from '@fluxradar/crawler';
import { analyzeUxStatic, assessAiCrawlerReadiness, runModuleRules } from '@fluxradar/rules';
import type { ModuleRunResult, SiteContext } from '@fluxradar/rules';
import { computeCoverage } from '@fluxradar/scoring';
import type { PrismaClient, Scan, SiteProfile } from '@prisma/client';
import { z } from 'zod';

import type { PerformanceSnapshot } from '../integrations/performance.ts';
import { persistAiResponse, redactEvidence } from './ai-evidence.ts';
import type { WorkerDeps } from './deps.ts';
import { freeCheckMetadata, runFreeCheck } from './free-check.ts';
import {
  buildGeoRequests,
  generateGeoDiscoveryQuestions,
  type GeoQuestionGenerationResult,
} from './geo.ts';
import type { ModulePlan } from './module-plan.ts';
import { finalizeRuleModule, issueRowsForModule } from './module-result.ts';
import type { IssueRowData } from './module-result.ts';
import { ruleCheckSummaries, uxRuleCheckSummaries } from './rule-checks.ts';
import { runUxConversion } from './ux.ts';

const providersJsonSchema = z.array(z.enum(AI_PROVIDER_NAMES));

/** The scan an attempt runs, with its site profile and the consent it was bought under. */
export type AttemptScan = Scan & {
  readonly siteProfile: SiteProfile;
  aiConsent: { providersJson: string; noticeVersion: string } | null;
};

/** What one attempt is: the scan, the plan and scope it runs under, and its modules. */
export interface ScanAttempt {
  readonly scan: AttemptScan;
  readonly profile: SiteProfile;
  readonly plan: Plan;
  readonly scope: ScanScopeInput;
  readonly modulePlan: ModulePlan;
  readonly targetModules: readonly string[];
}

/** What every module step works from: the attempt, the worker, one observation time. */
export interface ModuleStep extends ScanAttempt {
  readonly deps: WorkerDeps;
  /** When the attempt's findings were observed: one time for all of them. */
  readonly observedAt: Date;
}

export type ModuleRowData = {
  readonly runtimeStatus: string;
  readonly statusReason?: string | null;
  readonly coverage?: number | null;
  readonly score?: number | null;
  readonly applicableChecks?: number | null;
  readonly completedApplicableChecks?: number | null;
  readonly usableOutput?: boolean;
  readonly metadataJson?: string;
};

/** How much of a site's media the crawl actually asked about. */
export interface MediaCoverage {
  readonly checked: number;
  readonly broken: number;
  readonly notChecked: number;
}

function mediaCoverageOf(crawlResult: CrawlResult): MediaCoverage {
  return {
    checked: crawlResult.mediaChecks.length,
    broken: crawlResult.mediaChecks.filter(
      (media) => media.fetchError !== undefined || media.status >= 400,
    ).length,
    notChecked: crawlResult.mediaOverBudget.length,
  };
}

/**
 * What each rule module states about its standard and how far automation
 * reaches. Content Quality adds what the crawl did with the site's media.
 */
const RULE_MODULE_STANDARDS: Partial<Record<ModuleName, Readonly<Record<string, unknown>>>> = {
  Accessibility: {
    standard: 'WCAG 2.2 AA',
    profiles: ['EN 301 549', 'Section 508'],
    automation: 'static-dom-css',
    manualReviewRequired: true,
    legalCertification: false,
  },
  Security: {
    standard: 'OWASP ASVS',
    profile: 'Public Security Profile',
    automation: 'public-http-headers-dom',
    manualReviewRequired: true,
    notVerifiable: ['source code', 'authenticated flows', 'server-side configuration'],
  },
  Privacy: {
    standard: 'Privacy & Consent',
    scope: 'public technical signals',
    automation: 'static-http-dom',
    manualReviewRequired: true,
    legalAdvice: false,
  },
  SEO: {
    structuredData: 'static-html-json-ld',
    socialPreview: 'static-html-meta',
    clientRenderedMarkup: 'not verifiable without browser rendering',
  },
};

function metadataForRuleModule(
  module: ModuleName,
  plan: Plan,
  evaluations: ModuleRunResult['evaluations'],
  mediaCoverage: MediaCoverage,
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
    module === 'Content Quality'
      ? {
          standard: 'Content Quality',
          automation: 'static-html + media HEAD checks',
          // What CONTENT-004 is allowed to have an opinion about. `notChecked`
          // is the honest name for media the budget did not reach: the rule
          // says nothing about those, and this is where the report can.
          media: mediaCoverage,
        }
      : RULE_MODULE_STANDARDS[module];
  return JSON.stringify({ ...metadata, ruleChecks });
}

export async function setModule(
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

type GeoCoverage = ReturnType<typeof computeCoverage>;

/** How the discovery questions were written: by the provider, from the profile. */
function geoQueryGeneration(generation: GeoQuestionGenerationResult): Record<string, unknown> {
  return {
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
  };
}

/**
 * Every question the provider was asked and what each answer said. Both badges
 * used to be "no finding for this answer means yes". A question that named the
 * brand and spelled out the domain produces no finding for either, so "brand
 * mentioned" and "official domain cited" were green on every scan — we were
 * reading back our own question. The signals now come from the same function
 * the rules use, and carry why a signal was skipped.
 */
function geoProviderVisibility(
  geo: GeoModuleResult,
  generation: GeoQuestionGenerationResult,
  coverage: GeoCoverage,
): Record<string, unknown> {
  const mentionSignals = (aiRequestKey: string): GeoMentionSignals | null =>
    geo.mentions.get(aiRequestKey) ?? null;
  return {
    status: coverage.status,
    statusReason: coverage.statusReason,
    requiresConsent: true,
    method: 'AI-generated neutral context questions plus direct brand-awareness questions',
    interpretation: 'Prompt-specific observations; mentions do not prove remembered knowledge.',
    queryGeneration: geoQueryGeneration(generation),
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
  };
}

async function persistGeoModule(
  prisma: PrismaClient,
  scanId: string,
  geo: GeoModuleResult,
  generation: GeoQuestionGenerationResult,
  aiCrawlerReadiness: ReturnType<typeof assessAiCrawlerReadiness>,
): Promise<void> {
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
      providerVisibility: geoProviderVisibility(geo, generation, coverage),
    }),
  });

  if (generation.outcome?.kind === 'response') {
    await persistAiResponse(prisma, scanId, 'AI SEO / GEO', generation.outcome);
  }
  for (const outcome of geo.responses) {
    await persistAiResponse(prisma, scanId, 'AI SEO / GEO', outcome);
  }
}

type UxRun = Awaited<ReturnType<typeof runUxConversion>>;

/** What UX/Conversion records about its static signals and its one AI review. */
function uxModuleMetadata(ux: UxRun, uxReason: string | null): Record<string, unknown> {
  const aiResponse = ux.ai.outcome.kind === 'response' ? ux.ai.outcome.response : null;
  const aiRequestKey = ux.ai.outcome.kind === 'response' ? ux.ai.outcome.aiRequestKey : undefined;
  return {
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
  };
}

async function persistUxModule(prisma: PrismaClient, scanId: string, ux: UxRun): Promise<void> {
  const deterministicChecks = 3;
  const aiResponse = ux.ai.outcome.kind === 'response' ? ux.ai.outcome.response : null;
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
    metadataJson: JSON.stringify(uxModuleMetadata(ux, uxReason)),
  });
  if (ux.ai.outcome.kind === 'response') {
    await persistAiResponse(prisma, scanId, 'UX/Conversion', ux.ai.outcome);
  }
}

/**
 * Every module of the attempt reports the same thing: there was no site to read.
 *
 * `Unavailable` rather than `Not applicable` is the honest status — the checks
 * are applicable to this site, they simply had nothing to run on — and §15
 * requires `applicable > 0, completed = 0` for it, which is what the single
 * "could the site be read" check stands for. No score, because scoring a site
 * we never saw is the whole failure being fixed here.
 */
export async function markEveryModuleUnreadable(
  prisma: PrismaClient,
  scanId: string,
  modules: readonly string[],
  summary: CrawlSummary,
): Promise<void> {
  const statusReason = siteReachStatusReason(summary) ?? 'SiteUnreachable';
  for (const module of modules) {
    await setModule(prisma, scanId, module, {
      runtimeStatus: 'Unavailable',
      statusReason,
      coverage: 0,
      score: null,
      applicableChecks: 1,
      completedApplicableChecks: 0,
      usableOutput: false,
      metadataJson: JSON.stringify({ crawl: summary }),
    });
  }
}

async function runRuleModules(
  step: ModuleStep,
  ctx: SiteContext,
  crawlResult: CrawlResult,
): Promise<readonly IssueRowData[]> {
  const { prisma } = step.deps;
  const scanId = step.scan.id;
  const mediaCoverage = mediaCoverageOf(crawlResult);
  const issueRows: IssueRowData[] = [];
  for (const module of step.modulePlan.runnable.filter((candidate) =>
    step.targetModules.includes(candidate),
  )) {
    await setModule(prisma, scanId, module, { runtimeStatus: 'Running' });
    const result = step.plan === 'Free' ? runFreeCheck(ctx) : runModuleRules(module, ctx);
    const finalized = finalizeRuleModule(result, step.plan);
    await setModule(prisma, scanId, module, {
      runtimeStatus: finalized.runtimeStatus,
      statusReason: finalized.statusReason,
      coverage: finalized.coverage,
      score: finalized.score,
      applicableChecks: finalized.applicableChecks,
      completedApplicableChecks: finalized.completedApplicableChecks,
      usableOutput: finalized.usableOutput,
      metadataJson: metadataForRuleModule(module, step.plan, result.evaluations, mediaCoverage),
    });
    issueRows.push(
      ...issueRowsForModule(scanId, module, result.findings, finalized, step.observedAt),
    );
  }
  return issueRows;
}

/** AI SEO / GEO, when the plan has it and the attempt runs it; the AI quota it leaves. */
async function runGeoStep(
  step: ModuleStep,
  ctx: SiteContext,
  crawlResult: CrawlResult,
  quota: AiQuotaTracker,
): Promise<AiQuotaTracker> {
  if (!step.modulePlan.geo || !step.targetModules.includes('AI SEO / GEO')) return quota;
  const { prisma } = step.deps;
  const { scan, profile } = step;
  await setModule(prisma, scan.id, 'AI SEO / GEO', { runtimeStatus: 'Running' });
  const siteHostname = new URL(ctx.domain).hostname;
  const consent = loadConsent(scan);
  const provider = step.deps.createAiProvider(scan, profile);
  const generation = await generateGeoDiscoveryQuestions({
    scanId: scan.id,
    brand: profile.name,
    siteHostname,
    context: profile,
    consent,
    provider,
    quota,
  });
  const geo = await runGeoModule(
    {
      scanId: scan.id,
      plan: step.plan,
      brand: profile.name,
      siteOrigin: ctx.domain,
      siteDomain: siteHostname,
      consent,
      requests: buildGeoRequests(scan.id, profile.name, generation.questions),
    },
    { provider, quota: generation.quota },
  );
  await persistGeoModule(prisma, scan.id, geo, generation, assessAiCrawlerReadiness(crawlResult));
  return geo.quota;
}

/** What UX/Conversion records when no page gave it anything to read. */
const UX_WITHOUT_PAGES: ModuleRowData = {
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
};

/** UX/Conversion, when the plan has it and the attempt runs it; the issues it found. */
async function runUxStep(
  step: ModuleStep,
  ctx: SiteContext,
  quota: AiQuotaTracker,
): Promise<readonly IssueRowData[]> {
  if (!step.modulePlan.ux || !step.targetModules.includes('UX/Conversion')) return [];
  const { prisma } = step.deps;
  const { scan, profile } = step;
  await setModule(prisma, scan.id, 'UX/Conversion', { runtimeStatus: 'Running' });
  if (analyzeUxStatic(ctx).pages.length === 0) {
    await setModule(prisma, scan.id, 'UX/Conversion', UX_WITHOUT_PAGES);
    return [];
  }
  const ux = await runUxConversion(
    scan.id,
    'Complete',
    profile.name,
    ctx.domain,
    ctx,
    profile,
    loadConsent(scan),
    step.deps.createAiProvider(scan, profile),
    quota,
    step.observedAt,
  );
  await persistUxModule(prisma, scan.id, ux);
  return ux.issueRows;
}

/** What an external module records when its data could not be had. */
function externalUnavailable(statusReason: string): ModuleRowData {
  return {
    runtimeStatus: 'Unavailable',
    statusReason,
    coverage: 0,
    score: null,
    applicableChecks: 1,
    completedApplicableChecks: 0,
    usableOutput: false,
  };
}

function performanceRow(snapshot: PerformanceSnapshot): ModuleRowData {
  const unscored = snapshot.performanceScore === null;
  return {
    runtimeStatus: unscored ? 'Partial' : 'Completed',
    ...(unscored ? { statusReason: 'PerformanceScoreUnavailable' } : {}),
    coverage: unscored ? 0.5 : 1,
    score: snapshot.performanceScore,
    applicableChecks: 1,
    completedApplicableChecks: 1,
    usableOutput: true,
    metadataJson: JSON.stringify(snapshot),
  };
}

async function runPerformance(step: ModuleStep, module: string, ctx: SiteContext): Promise<void> {
  const { prisma } = step.deps;
  const runner = step.deps.createPerformanceRunner?.();
  if (runner === undefined) {
    await setModule(
      prisma,
      step.scan.id,
      module,
      externalUnavailable('PerformanceIntegrationNotConfigured'),
    );
    return;
  }
  try {
    const snapshot = await runner(ctx.domain, step.scope.userAgent ?? 'desktop');
    await setModule(prisma, step.scan.id, module, performanceRow(snapshot));
  } catch {
    // External performance data is optional: a provider outage must be shown
    // as unavailable and must not fail an otherwise valid website scan.
    await setModule(
      prisma,
      step.scan.id,
      module,
      externalUnavailable('PerformanceProviderUnavailable'),
    );
  }
}

async function runExternalModules(step: ModuleStep, ctx: SiteContext): Promise<void> {
  for (const module of step.modulePlan.external.filter((candidate) =>
    step.targetModules.includes(candidate),
  )) {
    await setModule(step.deps.prisma, step.scan.id, module, { runtimeStatus: 'Running' });
    if (module === 'Performance') await runPerformance(step, module, ctx);
  }
}

/** The attempt's modules in the tariff's order; the issues they found, rules first. */
export async function runModuleSteps(
  step: ModuleStep,
  ctx: SiteContext,
  crawlResult: CrawlResult,
): Promise<readonly IssueRowData[]> {
  const ruleRows = await runRuleModules(step, ctx, crawlResult);
  const quota = await runGeoStep(step, ctx, crawlResult, AiQuotaTracker.forPlan(step.plan));
  const uxRows = await runUxStep(step, ctx, quota);
  await runExternalModules(step, ctx);
  return [...ruleRows, ...uxRows];
}
