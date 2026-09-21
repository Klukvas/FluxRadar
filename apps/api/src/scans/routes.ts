// Scan lifecycle HTTP API. The route layer owns tenant checks and user-facing
// envelopes; the worker owns state transitions and scan execution.

import { Router } from 'express';
import type { PrismaClient, Scan, ScanModule } from '@prisma/client';
import { computeOverallScore } from '@fluxradar/scoring';
import { RULESET_VERSION, scanRequestInputSchema, scanScopeSchema } from '@fluxradar/contracts';
import { isModuleName, parseCrawlSummary } from '@fluxradar/contracts';
import type { ScanScopeInput } from '@fluxradar/contracts';
import { z } from 'zod';

import { accountIdFrom, requireAuth } from '../auth/middleware.ts';
import { cancelScan } from '../billing/cancel-scan.ts';
import { isFreeCheckAllowedOrigin } from '../billing/free-check-allowlist.ts';
import { isUniqueViolation } from '../billing/prisma-errors.ts';
import {
  PAID_ACCESS_INCLUDE,
  assertPaidReportAccess,
  assertPaidWorkAllowed,
  isPaidAccessActive,
  type PaidAccessScan,
} from '../billing/report-access.ts';
import { transitionScan } from '../billing/state-machine.ts';
import { conflict, forbidden, notFound, paymentRequired } from '../http/errors.ts';
import { sendOk } from '../http/envelope.ts';
import {
  pageMetaFrom,
  pageQuerySchema,
  pageRequestFrom,
  type PageMeta,
  type PageRequest,
} from '../http/pagination.ts';
import { requiredParam } from '../http/params.ts';
import { parseInput } from '../http/validate.ts';
import { modulePlanFor } from '../orchestrator/module-plan.ts';
import { findOwnProfile } from '../profiles/routes.ts';
import { RequestRateLimiter, scanActionRules } from '../auth/rate-limit.ts';
import { freeScanScope } from './free-scan-scope.ts';
import {
  captureExecutionConfig,
  lockOwnProfile,
  storedExecutionConfig,
} from '../profiles/execution-config.ts';

export interface ScansRouterDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
  readonly enqueueScan: (scanId: string) => void;
  readonly requestRateLimiter?: RequestRateLimiter;
  /** Origins exempt from both Free-check limits; empty keeps the one-time rule. */
  readonly freeCheckAllowedOrigins?: ReadonlySet<string>;
}

const freeCheckBodySchema = z
  .object({
    scope: scanScopeSchema.optional(),
    expectedProfileConfigVersion: z.number().int().min(1).optional(),
  })
  .optional();
const scanListQuerySchema = pageQuerySchema.extend({
  profileId: z.string().min(1).optional(),
  history: z.enum(['true', 'false']).optional(),
});
const profileScanListQuerySchema = pageQuerySchema;

const TERMINAL_MODULE_STATUSES = new Set(['Completed', 'Partial', 'Unavailable', 'Not applicable']);
const ACTIVE_SCAN_STATUSES = ['Pending', 'Queued', 'Running'] as const;
// Newest first, with the id as the tie-breaker: two scans created in the same
// millisecond must not swap places between one page and the next, which would
// show one of them twice and hide the other entirely.
const SCAN_HISTORY_ORDER = [{ createdAt: 'desc' }, { id: 'desc' }] as const;

export function scansRouter(deps: ScansRouterDeps): Router {
  const router = Router();
  const auth = requireAuth(deps.prisma, deps.now);
  const requestRateLimiter = deps.requestRateLimiter ?? new RequestRateLimiter();
  const freeCheckAllowedOrigins = deps.freeCheckAllowedOrigins ?? new Set<string>();

  router.post('/profiles/:profileId/free-check', auth, async (req, res) => {
    // Validate the optional shape even though Free always forces homepage-only
    // execution; rejecting malformed JSON keeps the boundary predictable. What
    // survives validation is recorded as the scan's scope by `freeScanScope`,
    // which keeps only the settings a Free check actually honours.
    const body = parseInput(freeCheckBodySchema, req.body);
    const accountId = accountIdFrom(res);
    requestRateLimiter.assertAllowedAll(
      scanActionRules('scan-create', accountId, req.ip ?? 'unknown'),
    );
    const profileId = requiredParam(req.params.profileId, 'profileId');
    const profile = await findOwnProfile(deps.prisma, accountId, profileId);
    const created = await createFreeScan(
      deps.prisma,
      accountId,
      profile.id,
      deps.now(),
      freeCheckAllowedOrigins,
      body?.scope,
      body?.expectedProfileConfigVersion,
    );
    deps.enqueueScan(created.id);
    sendOk(res, toScanDto(created, []), { status: 201 });
  });

  // A single generic creation endpoint is kept for clients that only expose a
  // plan picker. Paid plans must go through the signed dev-checkout route so
  // an entitlement can never be granted by a bare scan request.
  router.post('/profiles/:profileId/scans', auth, async (req, res) => {
    const input = parseInput(scanRequestInputSchema, req.body);
    const accountId = accountIdFrom(res);
    requestRateLimiter.assertAllowedAll(
      scanActionRules('scan-create', accountId, req.ip ?? 'unknown'),
    );
    const profileId = requiredParam(req.params.profileId, 'profileId');
    const profile = await findOwnProfile(deps.prisma, accountId, profileId);
    if (input.plan !== 'Free') {
      throw paymentRequired('Basic and Complete scans must be purchased before creation');
    }
    const scan = await createFreeScan(
      deps.prisma,
      accountId,
      profile.id,
      deps.now(),
      freeCheckAllowedOrigins,
      input.scope,
    );
    deps.enqueueScan(scan.id);
    sendOk(res, toScanDto(scan, []), { status: 201 });
  });

  router.get('/scans', auth, async (req, res) => {
    const query = parseInput(scanListQuerySchema, req.query);
    const page = pageRequestFrom(query);
    const accountId = accountIdFrom(res);
    if (query.profileId !== undefined) {
      await findOwnProfile(deps.prisma, accountId, query.profileId);
    }
    const where = {
      accountId,
      ...(query.profileId !== undefined ? { siteProfileId: query.profileId } : {}),
    };
    const listed = await listScanHistory(deps.prisma, where, page, query.history === 'true');
    sendOk(
      res,
      listed.scans.map((scan) => toScanDto(scan, readableModules(scan))),
      { meta: listed.meta },
    );
  });

  // This endpoint is deliberately separate from the history list: returning
  // one in-flight scan lets a workspace recover after a refresh without
  // unlocking or exposing historical results.
  router.get('/scans/active', auth, async (req, res) => {
    const scan = (await deps.prisma.scan.findFirst({
      where: { accountId: accountIdFrom(res), status: { in: [...ACTIVE_SCAN_STATUSES] } },
      include: { modules: true, ...PAID_ACCESS_INCLUDE },
      orderBy: [...SCAN_HISTORY_ORDER],
    })) as OwnScan | null;
    sendOk(res, scan === null ? null : toScanDto(scan, readableModules(scan)));
  });

  router.get('/profiles/:profileId/scans', auth, async (req, res) => {
    const query = parseInput(profileScanListQuerySchema, req.query);
    const page = pageRequestFrom(query);
    const accountId = accountIdFrom(res);
    const profileId = requiredParam(req.params.profileId, 'profileId');
    await findOwnProfile(deps.prisma, accountId, profileId);
    // Never the history view: this list is the profile's own results, so the
    // Complete-only gate applies here exactly as it does with history=false.
    const listed = await listScanHistory(
      deps.prisma,
      { accountId, siteProfileId: profileId },
      page,
      false,
    );
    sendOk(
      res,
      listed.scans.map((scan) => toScanDto(scan, readableModules(scan))),
      { meta: listed.meta },
    );
  });

  router.get('/scans/:scanId', auth, async (req, res) => {
    const scanId = requiredParam(req.params.scanId, 'scanId');
    const scan = await findOwnReportScan(deps.prisma, accountIdFrom(res), scanId);
    sendOk(res, toScanDto(scan, scan.modules));
  });

  router.get('/scans/:scanId/dashboard', auth, async (req, res) => {
    const scanId = requiredParam(req.params.scanId, 'scanId');
    const scan = await findOwnReportScan(deps.prisma, accountIdFrom(res), scanId);
    const geoModule = scan.modules.find((module) => module.module === 'AI SEO / GEO');
    const geoResponses =
      geoModule === undefined
        ? []
        : await deps.prisma.aiResponseRecord.findMany({
            where: { scanId, module: 'AI SEO / GEO' },
            select: {
              aiRequestKey: true,
              provider: true,
              modelId: true,
              rawText: true,
              citationsJson: true,
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          });
    const moduleSummaries = scan.modules.flatMap((module) => {
      if (!isModuleName(module.module)) return [];
      return [
        {
          module: module.module,
          moduleStatus: module.runtimeStatus as
            'Completed' | 'Partial' | 'Unavailable' | 'Not applicable',
          coverage: module.coverage ?? 0,
          score: module.score,
          usableOutput: module.usableOutput,
        },
      ];
    });
    // Free exposes the fixed SEO homepage check, but it intentionally has no
    // overall score weight. Its SEO module must therefore not be passed to the
    // scoring engine, which correctly rejects unweighted non-side modules.
    const overall =
      scan.plan === 'Free'
        ? computeOverallScore('Free', [])
        : computeOverallScore(scan.plan as 'Basic' | 'Complete', moduleSummaries);
    sendOk(res, {
      scan: toScanDto(scan, scan.modules),
      overall,
      modules: scan.modules.map(toModuleDto),
      geoObservations: geoObservationsFrom(geoModule?.metadataJson, geoResponses),
    });
  });

  router.post('/scans/:scanId/process', auth, async (req, res) => {
    const scanId = requiredParam(req.params.scanId, 'scanId');
    const accountId = accountIdFrom(res);
    requestRateLimiter.assertAllowedAll(
      scanActionRules('scan-process', accountId, req.ip ?? 'unknown'),
    );
    const scan = await findOwnScan(deps.prisma, accountId, scanId);
    // Running the scan is what the purchase bought, so a refunded or suspended
    // one may not re-trigger it. The worker refuses the job as well; this is the
    // answer the caller gets instead of a 202 for work that will never run.
    assertPaidWorkAllowed(scan, deps.now());
    if (scan.status === 'Completed' || scan.status === 'Cancelled') {
      throw conflict('SCAN_TERMINAL', 'scan is already terminal');
    }
    deps.enqueueScan(scan.id);
    sendOk(res, { scanId: scan.id, status: scan.status }, { status: 202 });
  });

  router.post('/scans/:scanId/retry', auth, async (req, res) => {
    const scanId = requiredParam(req.params.scanId, 'scanId');
    const accountId = accountIdFrom(res);
    requestRateLimiter.assertAllowedAll(
      scanActionRules('scan-retry', accountId, req.ip ?? 'unknown'),
    );
    const scan = await findOwnScan(deps.prisma, accountId, scanId);
    if (scan.status !== 'Partial') {
      throw conflict('RETRY_NOT_ALLOWED', 'only Partial scans can use the module retry');
    }
    // D-194: a retry needs an ACTIVE paid entitlement — paid, not suspended and
    // not expired. The rule now lives beside the one the read paths apply, so
    // the two can no longer drift apart.
    assertPaidWorkAllowed(scan, deps.now());
    const input = z
      .object({ module: z.string().min(1).optional() })
      .optional()
      .parse(req.body);
    const plan = modulePlanFor(scan.plan as 'Free' | 'Basic' | 'Complete');
    const retryModule = input?.module ?? retryableModule(scan.modules, plan);
    if (retryModule === null) {
      throw conflict('RETRY_NOT_ALLOWED', 'the scan has no retryable module');
    }
    const isPlanned =
      plan.runnable.some((module) => module === retryModule) ||
      plan.external.some((module) => module === retryModule) ||
      (plan.geo && retryModule === 'AI SEO / GEO') ||
      (plan.ux && retryModule === 'UX/Conversion');
    const moduleRow = scan.modules.find((module) => module.module === retryModule);
    if (
      !isPlanned ||
      moduleRow === undefined ||
      (moduleRow.runtimeStatus !== 'Partial' && moduleRow.runtimeStatus !== 'Unavailable')
    ) {
      throw conflict('RETRY_NOT_ALLOWED', 'only a Partial or Unavailable module can be retried');
    }
    await transitionScan(deps.prisma, scan.id, 'Partial', 'Running', { now: deps.now() });
    await deps.prisma.job.updateMany({
      where: { scanId: scan.id },
      data: { status: 'Pending', type: `module-retry:${retryModule}`, claimedAt: null },
    });
    deps.enqueueScan(scan.id);
    sendOk(res, { scanId: scan.id, status: 'Running', module: retryModule }, { status: 202 });
  });

  // DELIBERATELY NOT GUARDED by paid access. Cancelling returns no report data,
  // and it is how a customer stops work that is still running — including work
  // running under a purchase that has just been refunded, where refusing would
  // leave them unable to stop a scan they no longer own. The refund path itself
  // is idempotent (billing/cancel-scan.ts).
  router.post('/scans/:scanId/cancel', auth, async (req, res) => {
    const scanId = requiredParam(req.params.scanId, 'scanId');
    const accountId = accountIdFrom(res);
    // Cancellation is a write that can also open a refund; it belongs under the
    // same ceiling as the other scan actions rather than being free to repeat.
    requestRateLimiter.assertAllowedAll(
      scanActionRules('scan-cancel', accountId, req.ip ?? 'unknown'),
    );
    const scan = await findOwnScan(deps.prisma, accountId, scanId);
    const cancelled = await cancelScan(deps.prisma, scan.id);
    const updated = await deps.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    sendOk(res, {
      scanId: updated.id,
      status: updated.status,
      cancelledFrom: cancelled.cancelledFrom,
      refundId: cancelled.refund?.id ?? null,
    });
  });

  return router;
}

/**
 * Creates the one Free scan an account is entitled to, or an unmetered one for
 * an origin this deployment allowlisted.
 *
 * The profile is read first because the allowlist is keyed by its domain, and
 * the limits are only spent when the domain is not exempt: an allowlisted origin
 * leaves freeCheckUsedAt untouched and writes no global claim, so it can be
 * re-checked from any account, as often as it needs to be. Everything stays in
 * one transaction, so a scan that fails to be created never spends a limit.
 *
 * `requestedScope` is what the caller asked for, not what is stored: Free runs a
 * fixed homepage check, so the row records the settings that check will actually
 * apply (see free-scan-scope.ts).
 */
export async function createFreeScan(
  prisma: PrismaClient,
  accountId: string,
  siteProfileId: string,
  now: Date,
  allowedOrigins: ReadonlySet<string> = new Set(),
  requestedScope?: ScanScopeInput,
  expectedProfileConfigVersion?: number,
): Promise<Scan> {
  return prisma.$transaction(async (tx) => {
    const profile = await lockOwnProfile(
      tx,
      accountId,
      siteProfileId,
      expectedProfileConfigVersion,
    );
    if (!isFreeCheckAllowedOrigin(profile.domain, allowedOrigins)) {
      const claimed = await tx.account.updateMany({
        where: { id: accountId, freeCheckUsedAt: null },
        data: { freeCheckUsedAt: now },
      });
      if (claimed.count !== 1) {
        throw conflict('FREE_CHECK_USED', 'the one-time free check has already been used');
      }
      try {
        await tx.freeCheckClaim.create({
          data: { origin: profile.domain, claimedAt: now },
        });
      } catch (error) {
        if (isUniqueViolation(error, 'origin')) {
          throw conflict('FREE_CHECK_DOMAIN_USED', 'this domain has already received a free check');
        }
        throw error;
      }
    }
    const scan = await tx.scan.create({
      data: {
        purchaseId: null,
        accountId,
        siteProfileId,
        plan: 'Free',
        domain: profile.domain,
        status: 'Pending',
        scopeJson: JSON.stringify(freeScanScope(requestedScope)),
        profileConfigVersion: profile.scanConfigVersion,
        executionConfigJson: JSON.stringify(
          captureExecutionConfig(profile, 'Free', freeScanScope(requestedScope)),
        ),
        rulesetVersion: RULESET_VERSION,
        createdAt: now,
      },
    });
    await tx.job.create({
      data: { scanId: scan.id, type: 'scan', status: 'Pending', createdAt: now },
    });
    return scan;
  });
}

export type OwnScan = Scan & PaidAccessScan & { readonly modules: readonly ScanModule[] };

/**
 * One scan of this account, or a 404 — the tenant boundary, unchanged.
 *
 * It always loads the paid-access snapshot with it, so no caller has to remember
 * a second query and no read path can silently skip the guard for lack of the
 * data to apply it.
 */
export async function findOwnScan(
  prisma: PrismaClient,
  accountId: string,
  scanId: string,
): Promise<OwnScan> {
  const scan = await prisma.scan.findFirst({
    where: { id: scanId, accountId },
    include: { modules: true, ...PAID_ACCESS_INCLUDE },
  });
  if (scan === null) {
    throw notFound('scan not found');
  }
  return scan as OwnScan;
}

/**
 * The same scan, but only while the purchase behind it still entitles the
 * account to the report. EVERY read of paid report data goes through this —
 * details, dashboard, issues, evidence and export — so a refunded or charged-back
 * purchase revokes all of them together instead of one at a time.
 */
export async function findOwnReportScan(
  prisma: PrismaClient,
  accountId: string,
  scanId: string,
): Promise<OwnScan> {
  const scan = await findOwnScan(prisma, accountId, scanId);
  assertPaidReportAccess(scan);
  return scan;
}

/** Modules are report data, so a scan whose payment came back lists none. */
export function readableModules(scan: OwnScan): readonly ScanModule[] {
  return isPaidAccessActive(scan) ? scan.modules : [];
}

function toScanDto(scan: Scan, modules: readonly ScanModule[]): Record<string, unknown> {
  const terminal = modules.filter((module) =>
    TERMINAL_MODULE_STATUSES.has(module.runtimeStatus),
  ).length;
  return {
    id: scan.id,
    profileId: scan.siteProfileId,
    plan: scan.plan,
    domain: scan.domain,
    status: scan.status,
    statusReason: scan.statusReason,
    scope: parseScope(scan.scopeJson),
    // How much of the site the crawl actually read, so the report can say
    // "15 of 334 addresses" instead of a module coverage that counts checks.
    // Null on scans that ran before the column existed — not recorded, which
    // the report states rather than rendering as a measured zero.
    crawlSummary: parseCrawlSummary(scan.crawlSummaryJson),
    profileConfigVersion: scan.profileConfigVersion,
    executionConfig: storedExecutionConfig(scan.executionConfigJson),
    rulesetVersion: scan.rulesetVersion,
    retry: { platform: scan.platformRetryCount, module: scan.moduleRetryCount },
    progress: { completedModules: terminal, totalModules: modules.length },
    startedAt: scan.startedAt?.toISOString() ?? null,
    completedAt: scan.completedAt?.toISOString() ?? null,
    createdAt: scan.createdAt.toISOString(),
    modules: modules.map(toModuleDto),
  };
}

function toModuleDto(module: ScanModule): Record<string, unknown> {
  return {
    module: module.module,
    status: module.runtimeStatus,
    statusReason: module.statusReason,
    coverage: module.coverage,
    score: module.score,
    applicableChecks: module.applicableChecks,
    completedApplicableChecks: module.completedApplicableChecks,
    usableOutput: module.usableOutput,
    metadata: parseMetadata(module.metadataJson),
  };
}

function parseMetadata(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

interface GeoAiResponse {
  readonly aiRequestKey: string;
  readonly provider: string;
  readonly modelId: string;
  readonly rawText: string;
  readonly citationsJson: string;
}

interface GeoMentions {
  readonly brand: boolean;
  readonly domain: boolean;
}

interface GeoObservation {
  readonly purpose: 'awareness' | 'discovery';
  readonly question: string;
  readonly status: 'answered' | 'unavailable';
  readonly reason: string | null;
  readonly provider: string | null;
  readonly modelId: string | null;
  readonly answer: string | null;
  readonly citations: readonly string[];
  readonly mentions: GeoMentions | null;
}

/**
 * Turns the GEO execution ledger into the evidence the report can display.
 *
 * The request list is authoritative: the generator response uses the same
 * module but is an implementation detail, so it never appears as a visibility
 * observation. A response row without a matching recorded request is ignored;
 * a recorded response whose evidence row is missing is shown as unavailable
 * instead of manufacturing an answer.
 */
function geoObservationsFrom(
  metadataJson: string | undefined,
  responses: readonly GeoAiResponse[],
): readonly GeoObservation[] {
  if (metadataJson === undefined) return [];
  const metadata = recordValue(parseMetadata(metadataJson));
  const visibility = recordValue(metadata?.providerVisibility);
  const requests = visibility?.requests;
  if (!Array.isArray(requests)) return [];
  const responsesByKey = new Map(responses.map((response) => [response.aiRequestKey, response]));

  return requests.flatMap((entry): GeoObservation[] => {
    const request = recordValue(entry);
    const purpose = request?.purpose;
    const question = request?.question;
    if (
      request === null ||
      (purpose !== 'awareness' && purpose !== 'discovery') ||
      typeof question !== 'string' ||
      question.trim() === ''
    ) {
      return [];
    }
    const reason = typeof request.reason === 'string' ? request.reason : null;
    if (request.status !== 'response' || typeof request.aiRequestKey !== 'string') {
      return [unavailableGeoObservation(purpose, question, reason)];
    }
    const response = responsesByKey.get(request.aiRequestKey);
    if (response === undefined) {
      return [unavailableGeoObservation(purpose, question, 'EvidenceUnavailable')];
    }
    return [
      {
        purpose,
        question,
        status: 'answered',
        reason: null,
        provider: response.provider,
        modelId: response.modelId,
        answer: response.rawText,
        citations: stringArrayFromJson(response.citationsJson),
        mentions: mentionsFrom(request.mentions),
      },
    ];
  });
}

function unavailableGeoObservation(
  purpose: GeoObservation['purpose'],
  question: string,
  reason: string | null,
): GeoObservation {
  return {
    purpose,
    question,
    status: 'unavailable',
    reason,
    provider: null,
    modelId: null,
    answer: null,
    citations: [],
    mentions: null,
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function mentionsFrom(value: unknown): GeoMentions | null {
  const mentions = recordValue(value);
  return typeof mentions?.brand === 'boolean' && typeof mentions.domain === 'boolean'
    ? { brand: mentions.brand, domain: mentions.domain }
    : null;
}

function stringArrayFromJson(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

function parseScope(value: string): unknown {
  try {
    const parsed = scanScopeSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : scanScopeSchema.parse({ includeSubdomains: false });
  } catch {
    return scanScopeSchema.parse({ includeSubdomains: false });
  }
}

type ScanWithModules = Scan & PaidAccessScan & { modules: ScanModule[] };

interface ScanHistoryPage {
  readonly scans: readonly ScanWithModules[];
  readonly meta: PageMeta;
}

/**
 * One page of scan history, gated and counted by PostgreSQL.
 *
 * The gate is unchanged: a Complete purchase unlocks the full historical list,
 * an account that has bought Basic but never Complete sees only its current
 * result, and a Free/Basic result stays reachable by its own scan id in either
 * case — the gate hides the list, not the scan. What changed
 * is where the work happens — this used to load every scan the account had ever
 * run, decide the gate over the loaded array and slice the page in JavaScript,
 * which made the cost of listing grow with how long a customer had been paying
 * us. The gate is now two existence probes and the page is one indexed read.
 */
async function listScanHistory(
  prisma: PrismaClient,
  where: { readonly accountId: string; readonly siteProfileId?: string },
  page: PageRequest,
  historyRequested: boolean,
): Promise<ScanHistoryPage> {
  const [complete, basic] = await Promise.all([
    prisma.scan.findFirst({ where: { ...where, plan: 'Complete' }, select: { id: true } }),
    prisma.scan.findFirst({ where: { ...where, plan: 'Basic' }, select: { id: true } }),
  ]);
  if (complete === null && basic !== null) {
    if (historyRequested) {
      throw forbidden(
        'HISTORY_REQUIRES_COMPLETE',
        'scan history is available on Complete scans only',
      );
    }
    // Exactly one row is visible, so only the first page can carry it.
    const current =
      page.offset === 0
        ? ((await prisma.scan.findMany({
            where,
            include: { modules: true, ...PAID_ACCESS_INCLUDE },
            orderBy: [...SCAN_HISTORY_ORDER],
            take: 1,
          })) as ScanWithModules[])
        : [];
    return {
      scans: current,
      meta: { total: 1, page: page.page, limit: page.limit, hasNext: false },
    };
  }
  const [scans, total] = await Promise.all([
    prisma.scan.findMany({
      where,
      include: { modules: true, ...PAID_ACCESS_INCLUDE },
      orderBy: [...SCAN_HISTORY_ORDER],
      skip: page.offset,
      take: page.limit,
    }) as Promise<ScanWithModules[]>,
    prisma.scan.count({ where }),
  ]);
  return { scans, meta: pageMetaFrom(page, scans.length, total) };
}

function retryableModule(
  modules: readonly ScanModule[],
  plan: ReturnType<typeof modulePlanFor>,
): string | null {
  const orderedModules = [
    ...plan.runnable,
    ...plan.external,
    ...(plan.geo ? ['AI SEO / GEO' as const] : []),
    ...(plan.ux ? ['UX/Conversion' as const] : []),
  ];
  for (const planned of orderedModules) {
    const candidate = modules.find(
      (module) =>
        module.module === planned &&
        (module.runtimeStatus === 'Partial' || module.runtimeStatus === 'Unavailable'),
    );
    if (candidate !== undefined) return candidate.module;
  }
  return null;
}
