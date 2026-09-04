// Scan lifecycle HTTP API. The route layer owns tenant checks and user-facing
// envelopes; the worker owns state transitions and scan execution.

import { Router } from 'express';
import type { PrismaClient, Scan, ScanModule } from '@prisma/client';
import { computeOverallScore } from '@fluxradar/scoring';
import { RULESET_VERSION, scanRequestInputSchema, scanScopeSchema } from '@fluxradar/contracts';
import { isModuleName } from '@fluxradar/contracts';
import { z } from 'zod';

import { accountIdFrom, requireAuth } from '../auth/middleware.ts';
import { cancelScan } from '../billing/cancel-scan.ts';
import { isUniqueViolation } from '../billing/prisma-errors.ts';
import { transitionScan } from '../billing/state-machine.ts';
import { conflict, forbidden, notFound, paymentRequired } from '../http/errors.ts';
import { sendOk } from '../http/envelope.ts';
import { requiredParam } from '../http/params.ts';
import { parseInput } from '../http/validate.ts';
import { modulePlanFor } from '../orchestrator/module-plan.ts';
import { findOwnProfile } from '../profiles/routes.ts';

export interface ScansRouterDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
  readonly enqueueScan: (scanId: string) => void;
}

const freeCheckBodySchema = z.object({ scope: scanScopeSchema.optional() }).optional();
const scanListQuerySchema = z.object({
  profileId: z.string().min(1).optional(),
  history: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const TERMINAL_MODULE_STATUSES = new Set(['Completed', 'Partial', 'Unavailable', 'Not applicable']);
const ACTIVE_SCAN_STATUSES = ['Pending', 'Queued', 'Running'] as const;

export function scansRouter(deps: ScansRouterDeps): Router {
  const router = Router();
  const auth = requireAuth(deps.prisma, deps.now);

  router.post('/profiles/:profileId/free-check', auth, async (req, res) => {
    // Validate the optional shape even though Free always forces homepage-only
    // execution; rejecting malformed JSON keeps the boundary predictable.
    parseInput(freeCheckBodySchema, req.body);
    const accountId = accountIdFrom(res);
    const profileId = requiredParam(req.params.profileId, 'profileId');
    const profile = await findOwnProfile(deps.prisma, accountId, profileId);
    const created = await createFreeScan(deps.prisma, accountId, profile.id, deps.now());
    deps.enqueueScan(created.id);
    sendOk(res, toScanDto(created, []), { status: 201 });
  });

  // A single generic creation endpoint is kept for clients that only expose a
  // plan picker. Paid plans must go through the signed dev-checkout route so
  // an entitlement can never be granted by a bare scan request.
  router.post('/profiles/:profileId/scans', auth, async (req, res) => {
    const input = parseInput(scanRequestInputSchema, req.body);
    const accountId = accountIdFrom(res);
    const profileId = requiredParam(req.params.profileId, 'profileId');
    const profile = await findOwnProfile(deps.prisma, accountId, profileId);
    if (input.plan !== 'Free') {
      throw paymentRequired('Basic and Complete scans must be purchased before creation');
    }
    const scan = await createFreeScan(deps.prisma, accountId, profile.id, deps.now());
    deps.enqueueScan(scan.id);
    sendOk(res, toScanDto(scan, []), { status: 201 });
  });

  router.get('/scans', auth, async (req, res) => {
    const query = parseInput(scanListQuerySchema, req.query);
    const accountId = accountIdFrom(res);
    if (query.profileId !== undefined) {
      await findOwnProfile(deps.prisma, accountId, query.profileId);
    }
    const where = {
      accountId,
      ...(query.profileId !== undefined ? { siteProfileId: query.profileId } : {}),
    };
    const all = await deps.prisma.scan.findMany({
      where,
      include: { modules: true, siteProfile: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const visible = await applyHistoryGate(all, query.history === 'true');
    const page = visible.slice(query.offset, query.offset + query.limit);
    sendOk(
      res,
      page.map((scan) => toScanDto(scan, scan.modules)),
      {
        meta: {
          total: visible.length,
          page: Math.floor(query.offset / query.limit) + 1,
          limit: query.limit,
        },
      },
    );
  });

  // This endpoint is deliberately separate from the history list: returning
  // one in-flight scan lets a workspace recover after a refresh without
  // unlocking or exposing historical results.
  router.get('/scans/active', auth, async (req, res) => {
    const scan = await deps.prisma.scan.findFirst({
      where: { accountId: accountIdFrom(res), status: { in: [...ACTIVE_SCAN_STATUSES] } },
      include: { modules: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    sendOk(res, scan === null ? null : toScanDto(scan, scan.modules));
  });

  router.get('/profiles/:profileId/scans', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    const profileId = requiredParam(req.params.profileId, 'profileId');
    await findOwnProfile(deps.prisma, accountId, profileId);
    const scans = await deps.prisma.scan.findMany({
      where: { accountId, siteProfileId: profileId },
      include: { modules: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const visible = await applyHistoryGate(scans, false);
    sendOk(
      res,
      visible.map((scan) => toScanDto(scan, scan.modules)),
      {
        meta: { total: visible.length, page: 1, limit: visible.length || 1 },
      },
    );
  });

  router.get('/scans/:scanId', auth, async (req, res) => {
    const scanId = requiredParam(req.params.scanId, 'scanId');
    const scan = await findOwnScan(deps.prisma, accountIdFrom(res), scanId);
    sendOk(res, toScanDto(scan, scan.modules));
  });

  router.get('/scans/:scanId/dashboard', auth, async (req, res) => {
    const scanId = requiredParam(req.params.scanId, 'scanId');
    const scan = await findOwnScan(deps.prisma, accountIdFrom(res), scanId);
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
    });
  });

  router.post('/scans/:scanId/process', auth, async (req, res) => {
    const scanId = requiredParam(req.params.scanId, 'scanId');
    const scan = await findOwnScan(deps.prisma, accountIdFrom(res), scanId);
    if (scan.status === 'Completed' || scan.status === 'Cancelled') {
      throw conflict('SCAN_TERMINAL', 'scan is already terminal');
    }
    deps.enqueueScan(scan.id);
    sendOk(res, { scanId: scan.id, status: scan.status }, { status: 202 });
  });

  router.post('/scans/:scanId/retry', auth, async (req, res) => {
    const scanId = requiredParam(req.params.scanId, 'scanId');
    const scan = await findOwnScan(deps.prisma, accountIdFrom(res), scanId);
    if (scan.status !== 'Partial') {
      throw conflict('RETRY_NOT_ALLOWED', 'only Partial scans can use the module retry');
    }
    if (scan.purchaseId !== null) {
      const entitlement = await deps.prisma.entitlement.findUnique({
        where: { purchaseId: scan.purchaseId },
        include: { purchase: true },
      });
      if (
        entitlement === null ||
        entitlement.suspended ||
        entitlement.expiresAt.getTime() <= deps.now().getTime() ||
        entitlement.purchase.status !== 'paid'
      ) {
        throw forbidden(
          'ENTITLEMENT_INACTIVE',
          'scan retry is unavailable after entitlement expiry or suspension',
        );
      }
    }
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
      (plan.geo && retryModule === 'AI SEO / GEO');
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

  router.post('/scans/:scanId/cancel', auth, async (req, res) => {
    const scanId = requiredParam(req.params.scanId, 'scanId');
    const scan = await findOwnScan(deps.prisma, accountIdFrom(res), scanId);
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

export async function createFreeScan(
  prisma: PrismaClient,
  accountId: string,
  siteProfileId: string,
  now: Date,
): Promise<Scan> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.account.updateMany({
      where: { id: accountId, freeCheckUsedAt: null },
      data: { freeCheckUsedAt: now },
    });
    if (claimed.count !== 1) {
      throw conflict('FREE_CHECK_USED', 'the one-time free check has already been used');
    }
    const profile = await tx.siteProfile.findFirst({ where: { id: siteProfileId, accountId } });
    if (profile === null) {
      throw notFound('site profile not found');
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
    const scan = await tx.scan.create({
      data: {
        purchaseId: null,
        accountId,
        siteProfileId,
        plan: 'Free',
        domain: profile.domain,
        status: 'Pending',
        scopeJson: JSON.stringify({ includeSubdomains: false }),
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

export async function findOwnScan(
  prisma: PrismaClient,
  accountId: string,
  scanId: string,
): Promise<Scan & { readonly modules: readonly ScanModule[] }> {
  const scan = await prisma.scan.findFirst({
    where: { id: scanId, accountId },
    include: { modules: true },
  });
  if (scan === null) {
    throw notFound('scan not found');
  }
  return scan as Scan & { readonly modules: readonly ScanModule[] };
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

function parseScope(value: string): unknown {
  try {
    const parsed = scanScopeSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : scanScopeSchema.parse({ includeSubdomains: false });
  } catch {
    return scanScopeSchema.parse({ includeSubdomains: false });
  }
}

async function applyHistoryGate(
  scans: readonly (Scan & { modules: ScanModule[] })[],
  historyRequested: boolean,
) {
  const hasComplete = scans.some((scan) => scan.plan === 'Complete');
  if (!hasComplete && scans.some((scan) => scan.plan === 'Basic')) {
    if (historyRequested) {
      throw forbidden(
        'HISTORY_REQUIRES_COMPLETE',
        'scan history is available on Complete scans only',
      );
    }
    return scans.slice(0, 1);
  }
  // The Complete purchase unlocks the full historical list. Free/Basic current
  // results remain accessible by direct scan id even when history is gated.
  return scans;
}

function retryableModule(
  modules: readonly ScanModule[],
  plan: ReturnType<typeof modulePlanFor>,
): string | null {
  const orderedModules = [
    ...plan.runnable,
    ...plan.external,
    ...(plan.geo ? ['AI SEO / GEO' as const] : []),
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
