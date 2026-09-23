// Одна попытка прогона скана: crawl → последовательные модули тарифа →
// GEO provider → запись ScanModule/Issue/AiResponseRecord. Попытка идемпотентно
// перезаписывает результат предыдущей (module retry / external retry, D-024).
// Терминализацию выполняет process-scan через resolveScanOutcome.

import type { ModuleName, Plan, ScanScopeInput } from '@fluxradar/contracts';
import { isSiteRead, TARIFFS } from '@fluxradar/contracts';
import {
  AI_PROVIDER_NAMES,
  AiQuotaTracker,
  isAcceptedNoticeVersion,
  runGeoModule,
} from '@fluxradar/ai';
import type { AiConsent, GeoModuleResult } from '@fluxradar/ai';
import { crawl } from '@fluxradar/crawler';
import type { CrawlResult, CrawlScope } from '@fluxradar/crawler';
import {
  analyticsPageFacts,
  analyzeUxStatic,
  assessAiCrawlerReadiness,
  createSiteContext,
  runModuleRules,
} from '@fluxradar/rules';
import type { AnalyticsPageFact, ModuleRunResult, SiteContext } from '@fluxradar/rules';
import type { PrismaClient, Scan, SiteProfile } from '@prisma/client';
import { z } from 'zod';

import { clearActionPlansForScan } from '../action-plan/service.ts';
import { readCrawlEgressLocations } from '../integrations/crawl-egress-config.ts';
import {
  isEgressUsable,
  logEgressHealth,
  probeEgressProxy,
  readEgressProbeOptions,
} from '../integrations/crawl-egress-health.ts';
import { logEgressUsage, recordEgressUsage } from '../integrations/crawl-egress-usage.ts';
import { executionProfile } from '../profiles/execution-config.ts';
import { persistAiResponse, redactEvidence } from './ai-evidence.ts';
import { runApiChecks } from './api-checks.ts';
import { throwIfCancelled } from './cancellation.ts';
import {
  EMPTY_CRAWL_CHECKPOINT,
  type CrawlCheckpoint,
  type ScanCheckpointState,
} from './checkpoint.ts';
import { uncountedCrawlBytes } from './crawl-egress-bytes.ts';
import { CrawlProgressWriter } from './crawl-progress.ts';
import {
  persistCrawlEvidence,
  releaseResumeState,
  restoreCrawl,
  settledModules,
} from './crawl-resume.ts';
import { buildCrawlSummary } from './crawl-summary.ts';
import type { WorkerDeps } from './deps.ts';
import { resolveScanEgress, type ScanEgress } from './egress.ts';
import { runFreeCheck } from './free-check.ts';
import {
  buildGeoRequests,
  generateGeoDiscoveryQuestions,
  geoProvidersFor,
  type GeoQuestionGenerationResult,
} from './geo.ts';
import { geoModuleRow } from './geo-module-row.ts';
import { includesAnalytics, modulePlanFor } from './module-plan.ts';
import { metadataForRuleModule, type RuleModuleContext } from './module-metadata.ts';
import {
  markEveryModuleUnreadable,
  persistModuleResult,
  setModule,
} from './module-persistence.ts';
import { finalizeRuleModule, issueRowsForModule } from './module-result.ts';
import { devicePreferenceFor, runPerformanceModule } from './performance-module.ts';
import { uxRuleCheckSummaries } from './rule-checks.ts';
import { crawlRequestContext, scanScopeOf, type RunRequestContext } from './run-context.ts';
import type { ModuleCoverage } from './run-coverage.ts';
import { runUxConversion, uxRuleCoverage } from './ux.ts';

const CRAWLER_USER_AGENT = 'FluxRadarBot/0.1';

const providersJsonSchema = z.array(z.enum(AI_PROVIDER_NAMES));

type ScanWithRelations = Scan & { readonly siteProfile: SiteProfile };

function buildCrawlScope(origin: string, scope: ScanScopeInput, plan: Plan): CrawlScope {
  const { urlLimit } = TARIFFS[plan];
  if (plan === 'Free') {
    // §18: Free — ровно одна homepage-проверка, ссылки не обходим.
    // Ни seed-списка, ни рендера: и то и другое расширяет бесплатную проверку.
    return { origin, includeSubdomains: false, maxPages: 1, maxDepth: 0 };
  }
  return {
    origin,
    includeSubdomains: scope.includeSubdomains,
    maxPages: Math.min(scope.maxPages ?? urlLimit, urlLimit),
    ...(scope.maxDepth !== undefined ? { maxDepth: scope.maxDepth } : {}),
    ...(scope.urlPatterns !== undefined ? { includePatterns: scope.urlPatterns } : {}),
    ...(scope.excludePatterns !== undefined ? { excludePatterns: scope.excludePatterns } : {}),
    ...(scope.seedUrls !== undefined ? { seedUrls: scope.seedUrls } : {}),
    renderJs: scope.renderJs,
    queryPolicy: scope.queryPolicy,
    respectRobots: scope.respectRobots,
    robotsOverrideConfirmed: scope.robotsOverrideConfirmed,
  };
}

/**
 * The egress this scan crawls through, once it is known to work.
 *
 * The location recorded at launch (D-228). A location that has since been
 * unconfigured throws here, before a request: crawling it from somewhere else
 * would put a country on the report that the crawl never left from.
 *
 * The proxy is probed before a single request. Each proxy is one VPS, and when
 * it is down every fetch fails — which the crawl would otherwise read as "the
 * customer's site is unreachable", spending their paid scan on our outage and
 * telling them their site is broken. Going direct instead is not an option
 * either: that is the Hetzner block the proxy exists to avoid (D-220), and
 * another location is a different country from the one the owner chose. So the
 * attempt stops, loudly, and the worker treats it as the platform failure it is.
 */
async function usableEgress(deps: WorkerDeps, scope: ScanScopeInput): Promise<ScanEgress> {
  const egress = resolveScanEgress(
    deps.crawl,
    scope.egressLocation,
    deps.egressLocations ?? readCrawlEgressLocations(),
  );
  const egressLocationId = egress.location?.location.id ?? null;
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

/**
 * Доказательство повторной проверки модуля правил (§14, run-coverage.ts).
 *
 * В метадату модуля оно больше не попадает: её читает каждый поллинг статуса, а
 * доказательство — только политика Resolved следующего скана, из собственной
 * таблицы. Вместе с правилами едут зависимости каждой находки: именно они
 * позволяют закрыть починенную ссылку, не требуя повторить весь обход.
 */
function ruleModuleCoverage(result: ModuleRunResult, context: RunRequestContext): ModuleCoverage {
  return {
    rules: result.evaluations.map((evaluation) => ({
      ruleId: evaluation.ruleId,
      checkedTargets: evaluation.checkedTargets,
      inputTargets: evaluation.inputTargets,
      ...(evaluation.requestedInputs !== undefined
        ? { requestedInputs: evaluation.requestedInputs }
        : {}),
    })),
    issueDependencies: new Map(
      result.findings.flatMap((finding) =>
        finding.dependencyTargets === undefined
          ? []
          : [[finding.fingerprint, finding.dependencyTargets] as const],
      ),
    ),
    context,
  };
}

function loadConsent(
  scan: Scan & { aiConsent?: { providersJson: string; noticeVersion: string } | null },
): AiConsent | null {
  const record = scan.aiConsent ?? null;
  if (record === null || !isAcceptedNoticeVersion(record.noticeVersion)) {
    // A historical record cannot establish that the disclosure for the current
    // paid AI processing was shown before purchase. The accepted list keeps a
    // scan bought under the previous notice usable for the 30 days its
    // entitlement covers; its own provider list is what limits the recipients.
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
  // Строку модуля строит чистый билдер (geo-module-row.ts), а пишется она в
  // одной транзакции с ответами провайдера: строка — это то, что следующая
  // попытка читает как «эта платная стадия закончена», и строка без своих
  // ответов закрыла бы стадию, потеряв оплаченный материал (AI-001).
  const moduleRow = geoModuleRow(geo, generation, aiCrawlerReadiness);
  await prisma.$transaction(async (tx) => {
    await setModule(tx, scanId, geo.module, moduleRow);
    if (generation.outcome?.kind === 'response') {
      await persistAiResponse(tx, scanId, 'AI SEO / GEO', generation.outcome);
    }
    for (const outcome of geo.responses) {
      await persistAiResponse(tx, scanId, 'AI SEO / GEO', outcome);
    }
  });
}

async function persistUxModule(
  prisma: PrismaClient,
  scan: Scan,
  ux: Awaited<ReturnType<typeof runUxConversion>>,
  context: RunRequestContext,
): Promise<void> {
  const scanId = scan.id;
  const deterministicChecks = 3;
  const aiOutcome = ux.ai.outcome?.kind === 'response' ? ux.ai.outcome : null;
  const aiResponse = aiOutcome?.response ?? null;
  const aiRequestKey = aiOutcome?.aiRequestKey;
  // Coverage counts the three declared deterministic rules plus the one AI
  // review, not the number of pages. Page count made a 12-page scan look 92%
  // complete when its entire AI quarter had not run.
  const completedApplicableChecks = deterministicChecks + (aiResponse === null ? 0 : 1);
  const applicableChecks = deterministicChecks + 1;
  const uxReason = ux.ai.statusReason === null ? null : `UxAi${ux.ai.statusReason}`;
  await persistModuleResult(prisma, scan, {
    module: 'UX/Conversion',
    row: {
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
          ...(aiOutcome === null
            ? {}
            : {
                provider: aiOutcome.response.provider,
                modelId: aiOutcome.response.modelId,
                promptVersion: aiOutcome.request.promptVersion,
                requestId: aiOutcome.response.requestId,
                aiRequestKey,
                usage: aiOutcome.response.usage,
              }),
        },
      }),
    },
    issueRows: ux.issueRows,
    coverage: { rules: uxRuleCoverage(ux), context },
  });
  if (aiOutcome !== null) {
    await persistAiResponse(prisma, scanId, 'UX/Conversion', aiOutcome);
  }
}

/**
 * What an attempt hands to the post-outcome phase. Analytics runs after the
 * scan outcome is settled (analytics-module.ts), when the crawl is gone, so the
 * attempt passes on the per-page facts its checks compare with Google data.
 */
export interface ScanAttemptFacts {
  readonly analyticsPages: readonly AnalyticsPageFact[];
  /**
   * True when the attempt stopped because the owner asked it to, rather than
   * because it finished. The caller decides what that means for the scan — a
   * pause and a cancellation both stop the work, and only the scan row says
   * which one happened.
   */
  readonly stopped: boolean;
}

/** The checkpoint stage name for the crawl phase; modules use their own names. */
export const CRAWL_STAGE = 'crawl';

/**
 * How an attempt is paused and resumed.
 *
 * `isStopRequested` has to be synchronous and cheap — the crawler asks it
 * before every request — so the caller polls and this only reads the answer.
 */
export interface ScanAttemptControl {
  /** Checkpoint to continue from; null starts the attempt from scratch. */
  readonly resumeFrom: ScanCheckpointState | null;
  /**
   * True when this attempt is a *replacement* of the previous result rather
   * than a continuation of it — the external retry the customer was granted
   * after a Partial run. Everything is re-run and re-written, including the
   * paid stages, because that is what the retry was granted for.
   *
   * Every other attempt continues: it keeps the modules that already settled,
   * whether or not a checkpoint survived to say so.
   */
  readonly replacesPreviousResult?: boolean;
  isStopRequested(): boolean;
  save(state: ScanCheckpointState): Promise<void>;
}

export interface RunScanAttemptOptions {
  readonly retryModule?: string;
  /**
   * Hard cancellation. Unlike `control.isStopRequested` — which a pause reads at
   * stage boundaries — this reaches the transports, so a cancelled scan stops
   * the request already on the wire instead of paying for its answer.
   */
  readonly signal?: AbortSignal;
  readonly control?: ScanAttemptControl;
}

/**
 * Полная попытка прогона.
 *
 * Бросает при platform-сбое и при отмене (ScanCancelledError) — оба случая
 * разбирает вызывающий. Отмена проверяется между фазами и прокидывается в
 * обход и в GEO, чтобы отменённый скан перестал слать запросы наружу.
 */
export async function runScanAttempt(
  deps: WorkerDeps,
  scanId: string,
  options: RunScanAttemptOptions = {},
): Promise<ScanAttemptFacts> {
  const retryModule = options.retryModule;
  const signal = options.signal;
  const control = options.control;
  // Пауза и отмена сходятся в одну проверку на границах шагов: всё, что умеет
  // остановиться между фазами, обязано останавливаться и по отмене.
  const isStopRequested = (): boolean =>
    control?.isStopRequested() === true || signal?.aborted === true;
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
  const scope = scanScopeOf(scan);
  // Конфигурация запроса едет в доказательство покрытия: один и тот же URL под
  // desktop- и mobile-агентом — разные данные (run-context.ts).
  const requestContext = crawlRequestContext(scope);
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
  // Re-running the scan discards its Action Plans and resets their counters:
  // the snapshot the plans were written from no longer exists (D-232). A module
  // retry rewrites issues too, so both kinds of attempt clear them.
  await clearActionPlansForScan(prisma, scanId, now());
  // What this attempt must not run again.
  //
  // The checkpoint is *not* the authority here, and it deliberately was not
  // made one: a process that wrote a module's rows and then failed to write —
  // or to keep — its checkpoint would otherwise run that module, and pay a
  // provider for it, a second time. The persisted `ScanModule` rows say what
  // settled, and they survive a lost checkpoint, a crashed process and a
  // platform retry alike.
  //
  // Two attempts genuinely replace the previous result and so consult nothing:
  // a module retry, which exists to re-run exactly one module, and the external
  // retry granted after a Partial run.
  const continues =
    retryModule === undefined && control !== undefined && control.replacesPreviousResult !== true;
  const completedStages = new Set(continues ? (control.resumeFrom?.completedStages ?? []) : []);
  if (continues) {
    for (const module of await settledModules(prisma, scanId)) completedStages.add(module);
  }
  // Gated on the same flag as the stages, and for the same reason: an attempt
  // that replaces the previous result starts from nothing, so pages read by the
  // run it replaces are not its evidence. The previous attempt clears its
  // resume state before such a retry is granted, which makes this a guard
  // rather than a live path — but it is the one place the flag has to hold for
  // the rest of it to mean anything.
  const resumedCrawl = continues ? (control?.resumeFrom?.crawl ?? null) : null;
  const restoredCrawl =
    resumedCrawl === null ? null : await restoreCrawl(prisma, scanId, resumedCrawl, now());
  const modulesToRun = targetModules.filter((module) => !completedStages.has(module));
  await clearPreviousModuleRows(prisma, scanId, {
    retryModule,
    // A continuing attempt keeps what settled; anything else replaces the
    // whole snapshot exactly as it did before checkpoints existed.
    modules: continues ? modulesToRun : null,
  });
  for (const module of modulesToRun) {
    await setModule(prisma, scanId, module, { runtimeStatus: 'Pending' });
  }

  throwIfCancelled(scanId, signal);
  // Checked before anything is fetched: a dead proxy must not be reported as a
  // dead customer site (D-228/D-220).
  const egress = await usableEgress(deps, scope);
  const crawlScope = buildCrawlScope(origin, scope, plan);
  const renderRuntime =
    crawlScope.renderJs === true ? await (deps.createRenderRuntime?.() ?? undefined) : undefined;
  const progress = new CrawlProgressWriter(
    prisma,
    scanId,
    restoredCrawl?.pages.length ?? 0,
    resumedCrawl?.discoveredUrlCount ?? 0,
  );
  let crawlResult: CrawlResult;
  try {
    crawlResult = await crawl(crawlScope, {
      ...(deps.crawl?.fetcher !== undefined ? { fetcher: deps.crawl.fetcher } : {}),
      ...(egress.proxy === null ? {} : { egressProxy: egress.proxy }),
      ...(deps.crawl?.dangerouslyAllowLoopback === true ? { dangerouslyAllowLoopback: true } : {}),
      ...(deps.crawl?.limiter !== undefined ? { limiter: deps.crawl.limiter } : {}),
      ...(renderRuntime !== undefined ? { renderRuntime } : {}),
      // Two sources feed the frontier of a resumed crawl: what was still
      // queued, and what was read but whose evidence did not fit the store.
      ...(resumedCrawl !== null
        ? { resumeSeeds: [...resumedCrawl.frontier, ...resumedCrawl.unretained] }
        : {}),
      ...(restoredCrawl !== null ? { restored: restoredCrawl } : {}),
      // A Free check is one homepage read; probing its media would turn it into
      // a few hundred requests for a check nobody paid for.
      probeMedia: plan !== 'Free',
      shouldStop: isStopRequested,
      // The signal goes to the transport as well as to the loop: a cancel must
      // stop the request already on the wire, not only the next one.
      ...(signal !== undefined ? { signal } : {}),
      onProgress: (_url, done, total) => progress.record(done, total),
      logger: { warn: (message, context) => deps.logger.warn(message, context) },
      userAgent: scope.userAgent === 'mobile' ? `${CRAWLER_USER_AGENT} Mobile` : CRAWLER_USER_AGENT,
    });
  } finally {
    if (renderRuntime?.kind === 'ready') await renderRuntime.runtime.close();
  }
  await progress.flush();
  // Обход отдаёт частичный результат, а не ошибку: решение о судьбе скана
  // принимается здесь, до того как неполный обход попадёт в правила. Пауза
  // проходит дальше — её результат сохраняется, — а отмена прекращает попытку.
  throwIfCancelled(scanId, signal);
  // Whether the pages a resume restored were already counted against the egress
  // allowance. The crawler hands them back inside this attempt's own result, so
  // they are what the byte count has to exclude — and only when the checkpoint
  // says so, because an attempt paused mid-crawl never got as far as counting.
  const countedBefore = resumedCrawl?.egressRecorded === true;
  // The pages are persisted here, once, rather than when a pause arrives: a
  // pause is not the only way a run stops, and a process that dies mid-module
  // must not cost the customer a second crawl of their site.
  let crawlCheckpoint: CrawlCheckpoint =
    control === undefined
      ? EMPTY_CRAWL_CHECKPOINT
      : {
          ...(await persistCrawlEvidence(
            deps,
            scan.accountId,
            scanId,
            crawlResult,
            progress.counts(),
          )),
          egressRecorded: countedBefore,
        };
  const saveCheckpoint = async (stage: string): Promise<void> => {
    if (control === undefined) return;
    try {
      await control.save({
        schemaVersion: 2,
        stage,
        completedStages: [...completedStages],
        crawl: crawlCheckpoint,
      });
    } catch (error) {
      // The checkpoint saves a re-crawl; it is not what keeps a paid stage from
      // running twice. Failing the attempt over it would escalate a transient
      // database error into a platform retry — the one path that *does* discard
      // the run — so it is recorded and the attempt continues.
      deps.logger.error('scan checkpoint could not be written; the run continues without it', {
        scanId,
        stage,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    }
  };
  if (egress.location !== null) {
    // Counted where the crawl phase ends, before either exit below, because a
    // pause does not give the bytes back: they crossed the proxy and are on the
    // VPS's bill whether or not this attempt goes on to run a module. Counted
    // only when it actually crossed a configured location's proxy, and against
    // that location's plan, so a local fixture run and a direct crawl never
    // inflate a hosting plan's usage.
    logEgressUsage(
      deps.logger,
      await recordEgressUsage(
        prisma,
        egress.location.location,
        uncountedCrawlBytes(crawlResult, countedBefore ? (restoredCrawl?.pages ?? []) : []),
        now(),
      ),
    );
    // Said before the checkpoint is written, so the attempt that resumes from
    // it counts only what it reads itself.
    crawlCheckpoint = { ...crawlCheckpoint, egressRecorded: true };
  }
  if (crawlResult.stoppedEarly) {
    // Stopped before the first module: nothing was charged for, and the pages
    // already read are stored, so resuming continues the same run.
    await saveCheckpoint(CRAWL_STAGE);
    return { analyticsPages: [], stopped: true };
  }
  // A crash between here and the first module boundary is a resume, not a
  // re-crawl: the checkpoint now names the crawl as finished.
  await saveCheckpoint(CRAWL_STAGE);

  const crawlSummary = buildCrawlSummary(crawlResult, origin, scope, plan, crawlScope.maxPages);
  // Written before anything reads it: the refund decision (resolve-outcome.ts),
  // the Analytics module and the report all ask this record what the crawl saw,
  // and a null there would settle the scan on a field nobody filled in.
  await prisma.scan.update({
    where: { id: scanId },
    data: { crawlSummaryJson: JSON.stringify(crawlSummary) },
  });
  // A site is read when at least one page of it was read — a 2xx response that
  // carried a document. It used to be "at least one request did not throw",
  // which a WAF challenge page satisfies: the 403 arrives over a perfectly
  // healthy connection, so a site that had blocked us entirely was audited as
  // a site with no robots.txt and no 200 responses, and scored 96.95.
  if (!isSiteRead(crawlSummary)) {
    // Nothing downstream has a site to work on, so nothing downstream runs: no
    // rules over a challenge page, no AI quota spent on a scan that is about to
    // be refunded, and no PSI number that would make this Partial instead of
    // Failed. Every planned module says the same thing, and says why.
    await markEveryModuleUnreadable(prisma, scanId, modulesToRun, crawlSummary);
    if (control !== undefined) await releaseResumeState(prisma, scanId);
    return { analyticsPages: [], stopped: false };
  }

  const apiCheckRun =
    modulesToRun.includes('Reliability') && (scope.apiChecks?.length ?? 0) > 0
      ? await runApiChecks(scope.apiChecks ?? [], origin, scope, {
          userAgent:
            scope.userAgent === 'mobile' ? `${CRAWLER_USER_AGENT} Mobile` : CRAWLER_USER_AGENT,
          ...(deps.crawl?.limiter !== undefined ? { limiter: deps.crawl.limiter } : {}),
          ...(deps.crawl?.dangerouslyAllowLoopback === true
            ? { dangerouslyAllowLoopback: true }
            : {}),
          shouldStop: isStopRequested,
        })
      : { checks: [], results: [] };
  const ctx: SiteContext = createSiteContext({
    origin,
    crawl: crawlResult,
    plan,
    ...(apiCheckRun.checks.length > 0 ? { apiChecks: apiCheckRun.checks } : {}),
  });
  // Эффективный normalized origin — поле domain fingerprint-ов и export context
  // (в тестах обходится fixture-origin, а не https-домен профиля).
  await prisma.scan.update({ where: { id: scanId }, data: { domain: ctx.domain } });

  const observedAt = now();
  const moduleContext: RuleModuleContext = {
    rendering: crawlResult.rendering,
    apiCheckResults: apiCheckRun.results,
  };
  let aiQuota = AiQuotaTracker.forPlan(plan);
  for (const module of modulePlan.runnable.filter((candidate) =>
    modulesToRun.includes(candidate),
  )) {
    if (isStopRequested()) {
      await saveCheckpoint(module);
      return { analyticsPages: [], stopped: true };
    }
    throwIfCancelled(scanId, signal);
    await setModule(prisma, scanId, module, { runtimeStatus: 'Running' });
    const result = plan === 'Free' ? runFreeCheck(ctx) : runModuleRules(module, ctx);
    const finalized = finalizeRuleModule(result, plan);
    // Строка модуля и его findings пишутся вместе: отмена после этой точки
    // оставляет секцию с её доказательствами, а не score без находок.
    await persistModuleResult(prisma, scan, {
      module,
      row: {
        runtimeStatus: finalized.runtimeStatus,
        statusReason: finalized.statusReason,
        coverage: finalized.coverage,
        score: finalized.score,
        applicableChecks: finalized.applicableChecks,
        completedApplicableChecks: finalized.completedApplicableChecks,
        usableOutput: finalized.usableOutput,
        metadataJson: metadataForRuleModule(
          module as ModuleName,
          plan,
          result.evaluations,
          moduleContext,
        ),
      },
      issueRows: issueRowsForModule(scanId, module, result.findings, finalized, observedAt),
      coverage: ruleModuleCoverage(result, requestContext),
    });
    completedStages.add(module);
    await saveCheckpoint(module);
  }

  if (modulePlan.geo && modulesToRun.includes('AI SEO / GEO')) {
    if (isStopRequested()) {
      await saveCheckpoint('AI SEO / GEO');
      return { analyticsPages: [], stopped: true };
    }
    // Платные внешние запросы: перед ними проверка отмены обязательна.
    throwIfCancelled(scanId, signal);
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
      ...(signal !== undefined ? { signal } : {}),
    });
    const geo = await runGeoModule(
      {
        scanId,
        plan,
        brand: profile.name,
        siteOrigin: ctx.domain,
        siteDomain: siteHostname,
        consent,
        requests: buildGeoRequests(
          scanId,
          profile.name,
          generation.questions,
          geoProvidersFor(consent),
        ),
      },
      { provider, quota: generation.quota, ...(signal !== undefined ? { signal } : {}) },
    );
    // Записывается ДО проверки отмены, и это принципиально: ответы, которые
    // провайдер уже прислал, оплачены, а их ai_response record — единственный
    // носитель deletion_evidence_ref (AI-001/DATA-006). Выбросить их значило бы
    // оставить у провайдера данные, на которые у системы нет ни записи, ни
    // ссылки на удаление, — и скан уже терминальный, второго шанса не будет.
    // Незавершённая часть при этом не выдаётся за результат: geoModuleRow
    // считает знаменателем все заданные вопросы, поэтому строка получает
    // Partial с реальным числом завершённых проверок (§575).
    await persistGeoModule(prisma, scanId, geo, generation, assessAiCrawlerReadiness(crawlResult));
    aiQuota = geo.quota;
    completedStages.add('AI SEO / GEO');
    await saveCheckpoint('AI SEO / GEO');
    // Уже полученные ответы записаны выше; отмена прекращает попытку здесь,
    // после того как оплаченная часть сохранена.
    throwIfCancelled(scanId, signal);
  }

  if (modulePlan.ux && modulesToRun.includes('UX/Conversion')) {
    if (isStopRequested()) {
      await saveCheckpoint('UX/Conversion');
      return { analyticsPages: [], stopped: true };
    }
    throwIfCancelled(scanId, signal);
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
        signal,
      );
      // Как и у GEO: завершённая часть сохраняется до проверки отмены. Три
      // статические проверки уже отработали, и §575 требует записать их как
      // Partial, а не выбросить вместе с прерванной AI-четвертью.
      await persistUxModule(prisma, scan, ux, requestContext);
      throwIfCancelled(scanId, signal);
    }
    completedStages.add('UX/Conversion');
    await saveCheckpoint('UX/Conversion');
  }

  for (const module of modulePlan.external.filter((candidate) =>
    modulesToRun.includes(candidate),
  )) {
    if (isStopRequested()) {
      await saveCheckpoint(module);
      return { analyticsPages: [], stopped: true };
    }
    // Внешний провайдер: отменённый скан за него не платит.
    throwIfCancelled(scanId, signal);
    await setModule(prisma, scanId, module, { runtimeStatus: 'Running' });
    if (module !== 'Performance') continue;
    await runPerformanceModule(deps, {
      scan,
      origin: ctx.domain,
      // The crawl's own pages, in its order; the audit bounds and orders them
      // itself (integrations/performance/url-selection.ts).
      // The URL a visitor ends on, not the one the link pointed at: measuring a
      // redirect source would report the redirect's timing as the page's.
      candidateUrls: crawlResult.pages
        .filter((page) => page.fetchError === undefined && page.html !== null)
        .map((page) => page.finalUrl),
      // The profile's own device leads. A keyed deployment measures both, so this
      // is only an order; a keyless one measures the first and nothing else, and
      // that one must be the device this scan was asked for.
      strategies: devicePreferenceFor(scope.userAgent),
    });
    // The stage settled, so a resumed attempt must not pay for it again.
    completedStages.add(module);
    await saveCheckpoint(module);
  }

  // Findings уже записаны — каждым модулем вместе с его строкой. Отмена после
  // завершившегося модуля оставляет его результат целиком, а незавершённые
  // модули терминализирует worker: снимок неполного модуля описывал бы момент
  // отмены, а не сайт.
  throwIfCancelled(scanId, signal);
  // The attempt finished, so there is nothing left to resume. Releasing the
  // evidence here — rather than only when the scan settles — is what keeps the
  // store bounded by the number of *interrupted* scans rather than by every
  // scan ever run, and it keeps an external retry starting from a clean slate.
  if (control !== undefined) await releaseResumeState(prisma, scanId);
  return {
    analyticsPages: includesAnalytics(plan) ? analyticsPageFacts(ctx) : [],
    stopped: false,
  };
}

/**
 * Clears what this attempt is about to rewrite, and nothing else.
 *
 * `modules === null` means the whole snapshot is being replaced — a first run,
 * a module-less retry, or an attempt without a control. Otherwise only the
 * stages this attempt will actually run are cleared, so a module that already
 * settled keeps its row, its findings and its provider records.
 */
async function clearPreviousModuleRows(
  prisma: PrismaClient,
  scanId: string,
  options: { readonly retryModule?: string; readonly modules: readonly string[] | null },
): Promise<void> {
  const { retryModule, modules } = options;
  if (retryModule !== undefined) {
    await prisma.issue.deleteMany({ where: { scanId, module: retryModule } });
    if (retryModule === 'AI SEO / GEO' || retryModule === 'UX/Conversion') {
      await prisma.aiResponseRecord.deleteMany({ where: { scanId, module: retryModule } });
    }
    await prisma.scanModule.deleteMany({ where: { scanId, module: retryModule } });
    return;
  }
  if (modules === null) {
    await prisma.issue.deleteMany({ where: { scanId } });
    await prisma.aiResponseRecord.deleteMany({ where: { scanId } });
    await prisma.scanModule.deleteMany({ where: { scanId } });
    return;
  }
  await prisma.issue.deleteMany({ where: { scanId, module: { in: [...modules] } } });
  await prisma.aiResponseRecord.deleteMany({ where: { scanId, module: { in: [...modules] } } });
  await prisma.scanModule.deleteMany({ where: { scanId, module: { in: [...modules] } } });
}
