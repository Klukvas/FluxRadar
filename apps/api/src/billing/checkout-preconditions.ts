import type { PrismaClient } from '@prisma/client';
import type { ScanScopeInput } from '@fluxradar/contracts';

import { isExpired, isProbeUsable } from '../profiles/reachability-routes.ts';
import { CHECKOUT_STATUS_REASONS } from './checkout-lifecycle.ts';
import { CHECKOUT_SESSION_STATUSES } from './constants.ts';
import { SitePreconditionError, WebhookValidationError } from './errors.ts';
import { planUrlLimit, type PaidPlan } from './plans.ts';

// What has to be true of a site and a scope before ANY provider is asked to
// open a checkout for them. Every provider module runs these in the same order,
// before its own session row exists and before its provider is called, so a
// sale that would have to be refused after payment is refused before it.

/**
 * Refuses the sale unless a recent probe says the crawler can read this site.
 *
 * Read from our own table, never from the request: the browser showed the buyer
 * a reachability panel, but a browser can be told anything, and "I checked, it
 * was fine" is not evidence. The panel exists to explain the refusal before the
 * buyer meets it; this is the refusal.
 *
 * A stale probe is refused too, with its own message. A site that was reachable
 * an hour ago and is now behind a challenge would otherwise sell exactly the
 * audit this whole precondition exists to prevent.
 *
 * So is a probe from another egress location (D-228): a site can let Kyiv in
 * and refuse Frankfurt, so a yes from one country is not evidence about the
 * country being bought. `egressLocation` is the location the scope resolved
 * to, null for a deployment that crawls directly.
 */
export async function assertSiteIsReachable(
  prisma: PrismaClient,
  now: Date,
  siteProfileId: string,
  domain: string,
  egressLocation: string | null,
): Promise<void> {
  const probe = await prisma.siteReachabilityProbe.findUnique({ where: { siteProfileId } });
  if (isProbeUsable(probe, domain, egressLocation, now)) return;
  // A probe of a domain this profile no longer points at is not a result about
  // the site being bought. The profile's domain can be changed whenever no
  // checkout is open, so without this the gate is bypassed by probing an easy
  // site, repointing the profile, and paying inside the same 15 minutes.
  if (probe === null || probe.origin !== domain || probe.egressLocation !== egressLocation) {
    throw new SitePreconditionError(
      'unchecked',
      'This site has not been checked yet. Run the reachability check before paying.',
    );
  }
  if (isExpired(probe.checkedAt, now)) {
    throw new SitePreconditionError(
      'stale',
      'The reachability check is out of date. Run it again before paying.',
    );
  }
  throw new SitePreconditionError(
    probe.state,
    'The last check could not read this site, so an audit of it cannot be sold yet.',
  );
}

/**
 * A scope that exceeds the plan's URL limit must be rejected at checkout, not
 * silently trimmed after payment.
 */
export function assertScopeWithinPlan(plan: PaidPlan, scope: ScanScopeInput): void {
  const urlLimit = planUrlLimit(plan);
  if (scope.maxPages !== undefined && scope.maxPages > urlLimit) {
    throw new WebhookValidationError(`maxPages exceeds the ${plan} plan limit of ${urlLimit} URLs`);
  }
}

/**
 * Marks a session the provider never opened as terminal, never masking why.
 *
 * No checkout was opened at the provider, so this reference can never be paid.
 * Closing the row is what keeps a provider outage from leaving an open checkout
 * behind — one that blocks the profile and the buyer's next attempt — on every
 * retry.
 */
export async function closeUnopenedSession(prisma: PrismaClient, sessionId: string): Promise<void> {
  try {
    await prisma.checkoutSession.updateMany({
      where: { id: sessionId, status: CHECKOUT_SESSION_STATUSES.created },
      data: {
        status: CHECKOUT_SESSION_STATUSES.rejected,
        statusReason: CHECKOUT_STATUS_REASONS.providerUnavailable,
      },
    });
  } catch {
    // The provider failure is the error the caller has to see, so a failed
    // second write must not replace it. The row still expires on its own
    // deadline, and the retention sweep closes it.
  }
}
