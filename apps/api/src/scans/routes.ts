// Scan lifecycle HTTP API. The route layer owns tenant checks and user-facing
// envelopes; the worker owns state transitions and scan execution.

import { Router } from 'express';
import type { PrismaClient, Scan, ScanModule } from '@prisma/client';
import { computeOverallScore } from '@fluxradar/scoring';
import { RULESET_VERSION, scanRequestInputSchema, scanScopeSchema } from '@fluxradar/contracts';
import { isModuleName, parsePlan } from '@fluxradar/contracts';
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
import { conflict, notFound, paymentRequired } from '../http/errors.ts';
import { sendOk } from '../http/envelope.ts';
import { pageQuerySchema, pageRequestFrom } from '../http/pagination.ts';
import { requiredParam } from '../http/params.ts';
import { parseInput } from '../http/validate.ts';
import { InvalidTransitionError } from '../billing/errors.ts';
import { modulePlanFor } from '../orchestrator/module-plan.ts';
import { requestScanPause, resumeScan } from '../orchestrator/pause.ts';
import { findOwnProfile } from '../profiles/routes.ts';
import { RequestRateLimiter, scanActionRules } from '../auth/rate-limit.ts';
import { freeScanScope } from './free-scan-scope.ts';
import { assertReportSnapshotReady } from './report-readiness.ts';
import { toModuleDto, toScanDto } from './scan-dto.ts';
import { listScanHistory } from './scan-history.ts';
import { geoEvidenceFrom, geoObservationsFrom, geoVisibilitySummaryFrom } from './geo-report.ts';
import { captureExecutionConfig, lockOwnProfile } from '../profiles/execution-config.ts';
import type { EgressLocationMonitor } from '../integrations/crawl-egress-monitor.ts';
import {
  egressLaunchConfig,
  resolveLaunchEgressLocation,
  scopeWithEgressLocation,
  type LaunchEgress,
} from './launch-egress.ts';

export interface ScansRouterDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
  readonly enqueueScan: (scanId: string) => void;
  readonly requestRateLimiter?: RequestRateLimiter;
  /** Origins exempt from both Free-check limits; empty keeps the one-time rule. */
  readonly freeCheckAllowedOrigins?: ReadonlySet<string>;
  /** Which egress locations exist here and which are up (D-228). */
  readonly egress: EgressLocationMonitor;
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

// Paused belongs here: it is the account's in-flight scan, and the workspace
// has to find it again after a refresh in order to offer Resume at all.
const ACTIVE_SCAN_STATUSES = ['Pending', 'Queued', 'Running', 'Paused'] as const;
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
    // Free does not choose a country: whatever the body says, it leaves from
    // the default location — and is refused, like any launch, while that
    // location is down, rather than spending the one free check on our outage.
    const created = await createFreeScan(deps.prisma, {
      accountId,
      siteProfileId: profile.id,
      now: deps.now(),
      allowedOrigins: freeCheckAllowedOrigins,
      requestedScope: body?.scope,
      expectedProfileConfigVersion: body?.expectedProfileConfigVersion,
      egress: await resolveLaunchEgressLocation(deps.egress, undefined),
    });
    deps.enqueueScan(created.id);
    sendOk(res, toScanDto(created, []), { status: 201 });
  });

  // A single generic creation endpoint is kept for clients that only expose a
  // plan picker. Paid plans must go through a checkout — a signed Creem
  // order, or the internal allowlist's /billing/internal-checkout — so a paid scan
  // can never be created by a bare scan request.
  router.post('/profiles/:profileId/scans', auth, async (req, res) => {
    const input = parseInput(scanRequestInputSchema, req.body);
    const accountId = accountIdFrom(res);
    requestRateLimiter.assertAllowedAll(
      scanActionRules('scan-create', accountId, req.ip ?? 'unknown'),
    );
    const profileId = requiredParam(req.params.profileId, 'profileId');
    const profile = await findOwnProfile(deps.prisma, accountId, profileId);
    if (input.plan !== 'Free') {
      throw paymentRequired('paid scans must be purchased before creation');
    }
    const scan = await createFreeScan(deps.prisma, {
      accountId,
      siteProfileId: profile.id,
      now: deps.now(),
      allowedOrigins: freeCheckAllowedOrigins,
      requestedScope: input.scope,
      egress: await resolveLaunchEgressLocation(deps.egress, undefined),
    });
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

  // What the launch screen may offer. Server-issued rather than built into the
  // bundle: which countries exist is a fact of this deployment, and which of
  // them are answering is a fact of the last few minutes (D-228).
  router.get('/scans/launch-config', auth, async (_req, res) => {
    sendOk(res, { egress: await egressLaunchConfig(deps.egress) });
  });

  // This endpoint is deliberately separate from the history list: returning
  // one in-flight scan lets a workspace recover after a refresh without
  // unlocking or exposing historical results.
  router.get('/scans/active', auth, async (req, res) => {
    const scan = (await deps.prisma.scan.findFirst({
      where: { accountId: accountIdFrom(res), status: { in: [...ACTIVE_SCAN_STATUSES] } },
      include: { modules: true, job: { select: { status: true } }, ...PAID_ACCESS_INCLUDE },
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
    // the history gate applies here exactly as it does with history=false.
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
    assertReportSnapshotReady(scan, scan.job);
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
        : computeOverallScore(parsePlan(scan.plan), moduleSummaries);
    // The claim validator and the DTO must judge against the same snapshot, so
    // it is parsed once here rather than twice below.
    const geoEvidence = geoEvidenceFrom(geoModule?.metadataJson);
    sendOk(res, {
      scan: toScanDto(scan, scan.modules),
      overall,
      modules: scan.modules.map(toModuleDto),
      geoObservations: geoObservationsFrom(geoModule?.metadataJson, geoResponses, geoEvidence),
      geoEvidence,
      geoVisibilitySummary: geoVisibilitySummaryFrom(geoModule?.metadataJson),
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
    // A paused scan has its own way back: resuming keeps the checkpoint, while
    // re-processing here would claim a job the pause deliberately parked.
    if (scan.status === 'Paused') {
      throw conflict('SCAN_PAUSED', 'scan is paused; resume it instead');
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
    const plan = modulePlanFor(parsePlan(scan.plan));
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

  /**
   * Stops the run without giving it up.
   *
   * Unlike cancelling, nothing is settled and nothing is refunded: the same
   * scan and the same job stay in place, so resuming costs the owner nothing
   * and grants them nothing. A running scan stops at its next stage boundary
   * rather than mid-request, which is what keeps a half-written module from
   * reaching the report.
   */
  router.post('/scans/:scanId/pause', auth, async (req, res) => {
    const scanId = requiredParam(req.params.scanId, 'scanId');
    const accountId = accountIdFrom(res);
    requestRateLimiter.assertAllowedAll(
      scanActionRules('scan-pause', accountId, req.ip ?? 'unknown'),
    );
    const scan = await findOwnScan(deps.prisma, accountId, scanId);
    let paused: Awaited<ReturnType<typeof requestScanPause>>;
    try {
      paused = await requestScanPause(deps.prisma, scan.id, deps.now());
    } catch (error) {
      if (error instanceof InvalidTransitionError) {
        throw conflict('PAUSE_NOT_ALLOWED', 'only a scan that has not finished can be paused');
      }
      throw error;
    }
    const updated = await deps.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    // The re-read is the authority on both halves of the answer: a worker can
    // reach the stage boundary a running scan stops at while this request is
    // still in flight, and `status: Paused` with `pause: pausing` would tell the
    // owner to keep waiting for something that has already happened.
    const state = updated.status === 'Paused' ? 'paused' : paused.state;
    sendOk(res, { scanId: updated.id, status: updated.status, pause: state });
  });

  /** Puts a paused scan back in the queue, on the job and purchase it already has. */
  router.post('/scans/:scanId/resume', auth, async (req, res) => {
    const scanId = requiredParam(req.params.scanId, 'scanId');
    const accountId = accountIdFrom(res);
    requestRateLimiter.assertAllowedAll(
      scanActionRules('scan-resume', accountId, req.ip ?? 'unknown'),
    );
    const scan = await findOwnScan(deps.prisma, accountId, scanId);
    // Resuming is the work the purchase bought continuing, so the same paid
    // gate applies as to starting it. No new entitlement is spent.
    assertPaidWorkAllowed(scan, deps.now());
    try {
      await resumeScan(deps.prisma, scan.id, deps.now());
    } catch (error) {
      if (error instanceof InvalidTransitionError) {
        throw conflict('RESUME_NOT_ALLOWED', 'only a paused scan can be resumed');
      }
      throw error;
    }
    deps.enqueueScan(scan.id);
    const updated = await deps.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    sendOk(res, { scanId: updated.id, status: updated.status }, { status: 202 });
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

export interface CreateFreeScanParams {
  readonly accountId: string;
  readonly siteProfileId: string;
  readonly now: Date;
  /** Origins exempt from both Free-check limits; absent keeps the one-time rule. */
  readonly allowedOrigins?: ReadonlySet<string>;
  readonly requestedScope?: ScanScopeInput | undefined;
  readonly expectedProfileConfigVersion?: number | undefined;
  /** The default egress location, checked at launch (`resolveLaunchEgressLocation`). */
  readonly egress: LaunchEgress;
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
 * apply (see free-scan-scope.ts), plus the default egress location checked at
 * launch — never one the request named.
 */
export async function createFreeScan(
  prisma: PrismaClient,
  params: CreateFreeScanParams,
): Promise<Scan> {
  const {
    accountId,
    siteProfileId,
    now,
    allowedOrigins = new Set<string>(),
    requestedScope,
    expectedProfileConfigVersion,
  } = params;
  const scope = scopeWithEgressLocation(freeScanScope(requestedScope), params.egress);
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
        scopeJson: JSON.stringify(scope),
        profileConfigVersion: profile.scanConfigVersion,
        executionConfigJson: JSON.stringify(captureExecutionConfig(profile, 'Free', scope)),
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

export type OwnScan = Scan &
  PaidAccessScan & {
    readonly modules: readonly ScanModule[];
    readonly job: { readonly status: string } | null;
  };

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
    include: { modules: true, job: { select: { status: true } }, ...PAID_ACCESS_INCLUDE },
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
