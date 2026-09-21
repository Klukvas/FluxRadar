// Ask a site whether it will let our crawler in, before its owner pays.
//
// Two routes over one stored answer: GET reads the last one, POST takes a new
// one. The result is stored rather than returned and forgotten, because the
// checkout re-reads it — a browser that says "I checked and it was fine" is not
// evidence of anything.
//
// The probe leaves from the same network, with the same user agent, as the paid
// crawl will (`site-reachability.ts`). Anything cheaper would answer a different
// question.

import { Router } from 'express';
import type { PrismaClient, SiteReachabilityProbe } from '@prisma/client';

import { accountIdFrom, requireAuth } from '../auth/middleware.ts';
import { accountAndIpRules, RequestRateLimiter } from '../auth/rate-limit.ts';
import { sendOk } from '../http/envelope.ts';
import type { ApiLogger } from '../http/logger.ts';
import { requiredParam } from '../http/params.ts';
import { readCrawlEgressProxy } from '../integrations/crawl-egress-config.ts';
import {
  probeSiteReachability,
  type SiteReachabilityOptions,
} from '../integrations/site-reachability.ts';
import { findOwnProfile } from './routes.ts';

/**
 * How long a probe counts as current.
 *
 * Long enough to cover reading the result, filling in the scan form and paying;
 * short enough that a site which went down in between is asked again. The
 * checkout enforces the same window, from the same constant.
 */
export const REACHABILITY_PROBE_TTL_MS = 15 * 60 * 1000;

/**
 * Tighter than `scanActionRules`, because each call is an outbound request to
 * somebody else's server. A "check again" button a customer can hold down must
 * not become a way to point FluxRadar at a third party.
 */
const PROBE_RATE_LIMIT = { account: 10, ip: 30, windowMs: 10 * 60 * 1000 } as const;

export interface ReachabilityRouterDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
  readonly requestRateLimiter?: RequestRateLimiter;
  readonly logger?: ApiLogger;
  /** Test seam: the same shape `WorkerDeps.crawl` uses for the paid crawl. */
  readonly probe?: SiteReachabilityOptions;
}

export function reachabilityRouter(deps: ReachabilityRouterDeps): Router {
  const router = Router();
  const { prisma } = deps;
  const auth = requireAuth(prisma, deps.now);
  const requestRateLimiter = deps.requestRateLimiter ?? new RequestRateLimiter();

  router.get('/profiles/:profileId/reachability', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    const profile = await findOwnProfile(
      prisma,
      accountId,
      requiredParam(req.params.profileId, 'profileId'),
    );
    const stored = await prisma.siteReachabilityProbe.findUnique({
      where: { siteProfileId: profile.id },
    });
    sendOk(res, toDto(stored, deps.now()));
  });

  router.post('/profiles/:profileId/reachability', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    requestRateLimiter.assertAllowedAll(
      accountAndIpRules('reachability-probe', accountId, req.ip ?? 'unknown', PROBE_RATE_LIMIT),
    );
    const profile = await findOwnProfile(
      prisma,
      accountId,
      requiredParam(req.params.profileId, 'profileId'),
    );
    const result = await probeSiteReachability(profile.domain, {
      egressProxy: readCrawlEgressProxy(),
      ...deps.probe,
      now: deps.now,
    });
    deps.logger?.info('site reachability probed', {
      siteProfileId: profile.id,
      state: result.state,
      startStatus: result.startStatus,
    });
    const row = {
      accountId,
      state: result.state,
      startStatus: result.startStatus,
      fetchError: result.fetchError,
      signalsJson: JSON.stringify(result.accessControlSignals),
      checkedAt: result.checkedAt,
    };
    const stored = await prisma.siteReachabilityProbe.upsert({
      where: { siteProfileId: profile.id },
      create: { siteProfileId: profile.id, ...row },
      update: row,
    });
    sendOk(res, toDto(stored, deps.now()));
  });

  return router;
}

/**
 * Whether a stored probe still counts, and whether it said yes.
 *
 * Exported because the checkout asks the same question of the same row, and two
 * copies of "fresh enough" would eventually disagree about which purchases are
 * allowed.
 */
export function isProbeUsable(
  probe: Pick<SiteReachabilityProbe, 'state' | 'checkedAt'> | null,
  now: Date,
): boolean {
  if (probe === null) return false;
  return probe.state === 'reachable' && !isExpired(probe.checkedAt, now);
}

export function isExpired(checkedAt: Date, now: Date): boolean {
  return now.getTime() - checkedAt.getTime() > REACHABILITY_PROBE_TTL_MS;
}

function toDto(probe: SiteReachabilityProbe | null, now: Date): Record<string, unknown> {
  if (probe === null) {
    // Never checked is its own answer, and the form says so rather than showing
    // a stale-looking empty result.
    return { state: null, checkedAt: null, expired: false, canPurchase: false };
  }
  return {
    state: probe.state,
    startStatus: probe.startStatus,
    accessControlSignals: parseSignals(probe.signalsJson),
    checkedAt: probe.checkedAt.toISOString(),
    expired: isExpired(probe.checkedAt, now),
    canPurchase: isProbeUsable(probe, now),
  };
}

function parseSignals(json: string): readonly string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    // Evidence we cannot read is evidence we do not show.
    return [];
  }
}
