import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { ScanScopeInput } from '@fluxradar/contracts';
import { captureExecutionConfig, lockOwnProfile } from '../../profiles/execution-config.ts';
import { isExpired, isProbeUsable } from '../../profiles/reachability-routes.ts';
import { scopeWithEgressLocation, type LaunchEgress } from '../../scans/launch-egress.ts';

import type { AiConsentInput } from '../checkout-metadata.ts';
import { CHECKOUT_STATUS_REASONS, provisionalCheckoutDeadline } from '../checkout-lifecycle.ts';
import { checkoutReasonCode, type CheckoutReasonCode } from '../checkout-status-reason.ts';
import { CHECKOUT_SESSION_STATUSES } from '../constants.ts';
import { BillingNotFoundError, SitePreconditionError, WebhookValidationError } from '../errors.ts';
import { planPriceUsd, planUrlLimit, type PaidPlan } from '../plans.ts';
import { createFastSpringSession, type CreatedSession, type FetchLike } from './client.ts';
import { FASTSPRING_PROVIDER, type FastSpringConfig } from './config.ts';
import { CHECKOUT_REFERENCE_KEY } from './events.ts';

// Server-side checkout start. Everything that decides what the buyer is paying
// for — account, site profile, plan, crawl scope, AI consent — is validated here
// and stored in our own CheckoutSession row BEFORE FastSpring is called. Only an
// opaque reference travels to the provider and back, so a manipulated browser
// (or a foreign order) can never bind a payment to someone else's profile.

export interface CheckoutSessionDeps {
  readonly prisma: PrismaClient;
  readonly config: FastSpringConfig;
  readonly now: () => Date;
  readonly fetchImpl?: FetchLike;
}

export interface CheckoutSessionParams {
  readonly accountId: string;
  readonly siteProfileId: string;
  readonly plan: PaidPlan;
  readonly scope: ScanScopeInput;
  /** The egress location checked at launch; it, not `scope`, names where the scan goes. */
  readonly egress: LaunchEgress;
  readonly aiConsent?: AiConsentInput | undefined;
  readonly expectedProfileConfigVersion?: number | undefined;
}

/** Exactly what the browser is allowed to learn about a checkout session. */
export interface CheckoutSessionView {
  readonly reference: string;
  readonly sessionId: string;
  readonly checkoutUrl: string;
  readonly plan: PaidPlan;
  readonly amount: number;
  readonly currency: string;
  readonly mode: FastSpringConfig['mode'];
  readonly expiresAt: string | null;
}

export async function createCheckoutSession(
  deps: CheckoutSessionDeps,
  params: CheckoutSessionParams,
): Promise<CheckoutSessionView> {
  const profile = await deps.prisma.siteProfile.findFirst({
    where: { id: params.siteProfileId, accountId: params.accountId },
  });
  if (profile === null) {
    throw new BillingNotFoundError('site profile not found');
  }
  const scope = scopeWithEgressLocation(params.scope, params.egress);
  assertScopeWithinPlan(params.plan, scope);
  await assertSiteIsReachable(deps, profile.id, profile.domain, scope.egressLocation ?? null);

  const productPath = deps.config.productPaths[params.plan];
  const reference = `frcs_${randomUUID()}`;
  const createdAt = deps.now();
  // The row carries a deadline from the very first moment. FastSpring reports
  // its own below and overwrites it, but a call that times out (or a process
  // that dies mid-request) must not leave a session that blocks the profile —
  // and the buyer's next attempt — with no expiry at all.
  const provisionalExpiresAt = provisionalCheckoutDeadline(
    createdAt,
    deps.config.sessionExpirationDays,
  );
  // Committed before the provider call so an order.completed webhook — which can
  // arrive before our HTTP response reaches the browser — always finds its row.
  const row = await deps.prisma.$transaction(async (tx) => {
    const lockedProfile = await lockOwnProfile(
      tx,
      params.accountId,
      params.siteProfileId,
      params.expectedProfileConfigVersion,
    );
    return tx.checkoutSession.create({
      data: {
        provider: FASTSPRING_PROVIDER,
        reference,
        accountId: params.accountId,
        siteProfileId: profile.id,
        plan: params.plan,
        productPath,
        expectedAmountUsd: planPriceUsd(params.plan),
        liveMode: deps.config.liveMode,
        scopeJson: JSON.stringify(scope),
        profileConfigVersion: lockedProfile.scanConfigVersion,
        executionConfigJson: JSON.stringify(
          captureExecutionConfig(lockedProfile, params.plan, scope),
        ),
        aiConsentJson: params.aiConsent === undefined ? null : JSON.stringify(params.aiConsent),
        createdAt,
        expiresAt: provisionalExpiresAt,
      },
    });
  });

  let session: CreatedSession;
  try {
    session = await createFastSpringSession(
      {
        config: deps.config,
        ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
      },
      {
        productPath,
        tags: { [CHECKOUT_REFERENCE_KEY]: reference },
        attributes: { [CHECKOUT_REFERENCE_KEY]: reference },
      },
    );
  } catch (error) {
    // No checkout was ever opened at the provider, so this reference can never
    // be paid. Closing the row here is what keeps a provider outage from
    // leaving an open checkout behind on every retry.
    await closeUnopenedSession(deps.prisma, row.id);
    throw error;
  }

  // A provider deadline that is already in the past at creation is not a usable
  // deadline — a clock skew or a timestamp unit we read wrong — and accepting it
  // would declare a checkout dead the moment it opens. Ours stands in those cases.
  const expiresAt =
    session.expiresAt !== null && session.expiresAt.getTime() > createdAt.getTime()
      ? session.expiresAt
      : provisionalExpiresAt;
  await deps.prisma.checkoutSession.update({
    where: { id: row.id },
    data: {
      providerSessionId: session.sessionId,
      quotedAmount: session.quotedAmount,
      quotedCurrency: session.quotedCurrency,
      expiresAt,
    },
  });

  return {
    reference,
    sessionId: session.sessionId,
    checkoutUrl: session.checkoutUrl,
    plan: params.plan,
    amount: session.quotedAmount ?? planPriceUsd(params.plan),
    currency: session.quotedCurrency ?? 'USD',
    mode: deps.config.mode,
    expiresAt: expiresAt.toISOString(),
  };
}

/** Marks a session the provider never opened as terminal, never masking why. */
async function closeUnopenedSession(prisma: PrismaClient, sessionId: string): Promise<void> {
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

/** Payment progress the buyer may poll while the provider webhook is in flight. */
export interface CheckoutStatusView {
  readonly reference: string;
  readonly plan: string;
  /** 'created' — no confirmed payment yet; 'completed' — webhook granted access. */
  readonly status: string;
  /**
   * Why a rejected checkout produced nothing, as a closed code the UI localises.
   * The internal reason stays in the database for support — see
   * `billing/checkout-status-reason.ts`.
   */
  readonly reasonCode: CheckoutReasonCode | null;
  readonly scanId: string | null;
  readonly purchaseId: string | null;
  readonly expiresAt: string | null;
}

export async function findCheckoutStatus(
  prisma: PrismaClient,
  accountId: string,
  reference: string,
): Promise<CheckoutStatusView> {
  const row = await prisma.checkoutSession.findFirst({
    where: { reference, accountId },
    include: { purchase: { include: { scan: { select: { id: true } } } } },
  });
  if (row === null) {
    throw new BillingNotFoundError('checkout session not found');
  }
  return {
    reference: row.reference,
    plan: row.plan,
    status: row.status,
    reasonCode: checkoutReasonCode(row.status, row.statusReason),
    scanId: row.purchase?.scan?.id ?? null,
    purchaseId: row.purchaseId,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

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
async function assertSiteIsReachable(
  deps: CheckoutSessionDeps,
  siteProfileId: string,
  domain: string,
  egressLocation: string | null,
): Promise<void> {
  const probe = await deps.prisma.siteReachabilityProbe.findUnique({ where: { siteProfileId } });
  if (isProbeUsable(probe, domain, egressLocation, deps.now())) return;
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
  if (isExpired(probe.checkedAt, deps.now())) {
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
function assertScopeWithinPlan(plan: PaidPlan, scope: ScanScopeInput): void {
  const urlLimit = planUrlLimit(plan);
  if (scope.maxPages !== undefined && scope.maxPages > urlLimit) {
    throw new WebhookValidationError(`maxPages exceeds the ${plan} plan limit of ${urlLimit} URLs`);
  }
}
