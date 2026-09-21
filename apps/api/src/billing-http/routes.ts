// The internal free-access checkout: `/billing/dev-checkout`.
//
// It runs a paid plan without a payment, and only for a named internal account
// — the FLUXRADAR_INTERNAL_FREE_EMAILS allowlist, which fails closed when unset
// (billing/internal-access.ts). Everyone else answers 402 and buys through the
// provider (billing-http/fastspring-routes.ts). There is no simulated payment
// here: nothing but a signed FastSpring order grants a purchase (D-229).

import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { TARIFFS, scanScopeSchema } from '@fluxradar/contracts';
import { z } from 'zod';

import { accountIdFrom, requireAuth } from '../auth/middleware.ts';
import { isInternalFreeEmail } from '../billing/internal-access.ts';
import { createInternalFreeScan } from '../billing/internal-checkout.ts';
import { aiConsentSchema } from '../billing/checkout-metadata.ts';
import { PAID_PLANS } from '../billing/plans.ts';
import { sendOk } from '../http/envelope.ts';
import { paymentRequired, unauthorized } from '../http/errors.ts';
import { parseInput } from '../http/validate.ts';
import { findOwnProfile } from '../profiles/routes.ts';
import type { EgressLocationMonitor } from '../integrations/crawl-egress-monitor.ts';
import { resolveLaunchEgressLocation } from '../scans/launch-egress.ts';
import { RequestRateLimiter, scanActionRules } from '../auth/rate-limit.ts';
import type { Mailer } from '../email/mailer.ts';
import { notifyScanEvent } from '../email/notifications.ts';

const devCheckoutInputSchema = z
  .object({
    siteProfileId: z.string().min(1),
    plan: z.enum(PAID_PLANS),
    scope: scanScopeSchema,
    aiConsent: aiConsentSchema.optional(),
    expectedProfileConfigVersion: z.number().int().min(1).optional(),
  })
  .superRefine((input, ctx) => {
    const { urlLimit } = TARIFFS[input.plan];
    if (input.scope.maxPages !== undefined && input.scope.maxPages > urlLimit) {
      ctx.addIssue({
        code: 'custom',
        message: `maxPages exceeds the ${input.plan} plan limit of ${urlLimit} URLs`,
        path: ['scope', 'maxPages'],
      });
    }
  });

export interface BillingRouterDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
  readonly enqueueScan?: (scanId: string) => void;
  readonly internalFreeEmails: ReadonlySet<string>;
  readonly requestRateLimiter?: RequestRateLimiter;
  readonly mailer?: Mailer;
  /** Checks the chosen egress location before a scan is created (D-228). */
  readonly egress: EgressLocationMonitor;
}

export function billingRouter(deps: BillingRouterDeps): Router {
  const router = Router();
  const auth = requireAuth(deps.prisma, deps.now);
  const requestRateLimiter = deps.requestRateLimiter ?? new RequestRateLimiter();

  router.post('/billing/dev-checkout', auth, async (req, res) => {
    const input = parseInput(devCheckoutInputSchema, req.body);
    const accountId = accountIdFrom(res);
    requestRateLimiter.assertAllowedAll(
      scanActionRules('checkout', accountId, req.ip ?? 'unknown'),
    );
    const account = await deps.prisma.account.findUnique({
      where: { id: accountId },
      select: { email: true },
    });
    if (account === null) {
      throw unauthorized('session account no longer exists');
    }
    // The one way in, and it does not depend on NODE_ENV: a named internal
    // account. Everyone else pays the provider.
    if (!isInternalFreeEmail(account.email, deps.internalFreeEmails)) {
      throw paymentRequired(
        'paid scans must be purchased through /billing/checkout-session in this environment',
      );
    }
    const profile = await findOwnProfile(deps.prisma, accountId, input.siteProfileId);
    const egress = await resolveLaunchEgressLocation(deps.egress, input.scope.egressLocation);
    const scan = await createInternalFreeScan({
      prisma: deps.prisma,
      accountId,
      siteProfileId: profile.id,
      plan: input.plan,
      scope: input.scope,
      egress,
      aiConsent: input.aiConsent,
      expectedProfileConfigVersion: input.expectedProfileConfigVersion,
      now: deps.now(),
    });
    sendOk(
      res,
      {
        purchaseId: null,
        entitlementId: null,
        scanId: scan.id,
        transactionId: null,
        eventId: null,
        plan: input.plan,
        billing: 'internal-free',
      },
      { status: 201 },
    );
    deps.enqueueScan?.(scan.id);
    void notifyScanEvent(
      deps.prisma,
      deps.mailer,
      scan.id,
      'purchase_confirmed',
      'Your internal test audit is ready to run.',
    ).catch(() => undefined);
  });

  return router;
}
