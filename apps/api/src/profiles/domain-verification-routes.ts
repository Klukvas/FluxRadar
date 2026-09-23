// The optional domain ownership proof, over HTTP.
//
// Three routes and nothing else: issue a token, read the state, run the check.
// Every one is scoped to the signed-in account's own profile, so another
// account's proof is indistinguishable from a profile that does not exist. None
// of them is consulted by the audit pipeline — a site with no proof is audited
// exactly as it was before this existed.

import { domainVerificationStartInputSchema } from '@fluxradar/contracts';
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';

import { accountIdFrom, requireAuth } from '../auth/middleware.ts';
import { RequestRateLimiter, scanActionRules } from '../auth/rate-limit.ts';
import { sendOk } from '../http/envelope.ts';
import { conflict, notFound } from '../http/errors.ts';
import { requiredParam } from '../http/params.ts';
import { parseInput } from '../http/validate.ts';
import {
  findDomainVerification,
  isProofStale,
  startDomainVerification,
  toDomainVerificationView,
  verifyDomainOwnership,
  type DomainVerificationDeps,
} from './domain-verification.ts';
import { findOwnProfile } from './routes.ts';

export interface DomainVerificationRouterDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
  readonly requestRateLimiter?: RequestRateLimiter;
  /** Test seam for the DNS and loopback reads the proof performs. */
  readonly verification?: DomainVerificationDeps;
}

export function domainVerificationRouter(deps: DomainVerificationRouterDeps): Router {
  const router = Router();
  const auth = requireAuth(deps.prisma, deps.now);
  const requestRateLimiter = deps.requestRateLimiter ?? new RequestRateLimiter();

  /** Issues a token, or re-issues one to rotate it or change the method. */
  router.post('/profiles/:profileId/verification', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    const input = parseInput(domainVerificationStartInputSchema, req.body);
    requestRateLimiter.assertAllowedAll(
      scanActionRules('domain-verification', accountId, req.ip ?? 'unknown'),
    );
    const profile = await findOwnProfile(
      deps.prisma,
      accountId,
      requiredParam(req.params.profileId, 'profileId'),
    );
    const record = await startDomainVerification(deps.prisma, profile, input.method, deps.now());
    sendOk(res, toDomainVerificationView(record, deps.now()), { status: 201 });
  });

  router.get('/profiles/:profileId/verification', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    const profile = await findOwnProfile(
      deps.prisma,
      accountId,
      requiredParam(req.params.profileId, 'profileId'),
    );
    const record = await findDomainVerification(deps.prisma, profile.id, accountId);
    if (record === null) {
      // Not an error: most sites never start one, and the UI offers to.
      sendOk(res, null);
      return;
    }
    const now = deps.now();
    sendOk(res, {
      ...toDomainVerificationView(record, now),
      // A confirmed proof is a statement about the past; this says how old it is
      // so the UI can offer a re-check instead of implying it is live.
      stale: isProofStale(record, now),
    });
  });

  /** Runs the proof now and records what it found. */
  router.post('/profiles/:profileId/verification/verify', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    requestRateLimiter.assertAllowedAll(
      scanActionRules('domain-verification-check', accountId, req.ip ?? 'unknown'),
    );
    const profile = await findOwnProfile(
      deps.prisma,
      accountId,
      requiredParam(req.params.profileId, 'profileId'),
    );
    const record = await findDomainVerification(deps.prisma, profile.id, accountId);
    if (record === null) {
      throw notFound('no verification has been started for this site');
    }
    if (record.tokenExpiresAt.getTime() <= deps.now().getTime()) {
      // Refused before any request: an expired token proves control at an
      // unknown time, so the honest answer is "issue a new one".
      throw conflict(
        'VERIFICATION_TOKEN_EXPIRED',
        'the verification token expired; issue a new one',
      );
    }
    const checked = await verifyDomainOwnership(
      deps.prisma,
      profile,
      record,
      deps.now(),
      deps.verification ?? {},
    );
    sendOk(res, toDomainVerificationView(checked, deps.now()));
  });

  return router;
}
