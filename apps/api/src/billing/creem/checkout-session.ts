import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { ScanScopeInput } from '@fluxradar/contracts';

import { captureExecutionConfig, lockOwnProfile } from '../../profiles/execution-config.ts';
import { scopeWithEgressLocation, type LaunchEgress } from '../../scans/launch-egress.ts';
import { scopeTargetMessage, scopeTargetProblems } from '../../scans/scope-targets.ts';
import { provisionalCheckoutDeadline } from '../checkout-lifecycle.ts';
import type { AiConsentInput } from '../checkout-metadata.ts';
import {
  assertScopeWithinPlan,
  assertSiteIsReachable,
  closeUnopenedSession,
} from '../checkout-preconditions.ts';
import {
  BillingNotFoundError,
  PlanNotPurchasableError,
  WebhookValidationError,
} from '../errors.ts';
import { planPriceUsd, type PaidPlan } from '../plans.ts';
import type { FetchLike } from '../fastspring/client.ts';
import { createCreemCheckout, type CreatedCheckout } from './client.ts';
import { CREEM_PROVIDER, type CreemConfig } from './config.ts';
import { CREEM_CHECKOUT_REFERENCE_KEY } from './events.ts';

// Server-side checkout start, the Creem way. Everything that decides what the
// buyer is paying for — account, site profile, plan, crawl scope, AI consent — is
// validated here and stored in our own CheckoutSession row BEFORE Creem is
// called. An opaque reference travels to the provider and back (as the
// checkout's `request_id`, and again in its metadata), so a manipulated browser
// (or a foreign order) can never bind a payment to someone else's profile. The
// account email goes along with it, only to pre-fill the hosted checkout; the
// privacy policy discloses that transfer.
//
// Creem hosts the checkout page itself: the browser is sent to the URL this
// module returns and comes back to the deployment's return URL afterwards. That
// return grants nothing — the scan appears solely because the signed
// checkout.completed webhook created it (webhook-handler.ts).

/**
 * How long a Creem checkout row is treated as payable.
 *
 * Creem documents no lifetime for a hosted checkout and accepts none on the
 * request, so unlike FastSpring's link the page a buyer left open in a tab
 * does not die when our row's deadline passes. The deadline is what decides
 * whether the row still blocks deleting the profile or changing its domain
 * (openCheckoutSessionWhere): past it, a profile can be deleted and the row
 * with it, and a payment that lands afterwards is recorded as an order this
 * environment cannot bind. A week — the most FastSpring allows — keeps that
 * window to buyers who return to a tab left open for over a week, at the cost
 * of a profile that cannot be deleted for a week after an abandoned checkout.
 * A payment that lands after the deadline but before the profile is gone is
 * still honoured (claimableCheckoutSessionWhere).
 */
export const CREEM_CHECKOUT_DEADLINE_DAYS = 7;

export interface CreemCheckoutSessionDeps {
  readonly prisma: PrismaClient;
  readonly config: CreemConfig;
  readonly now: () => Date;
  readonly fetchImpl?: FetchLike;
}

export interface CreemCheckoutSessionParams {
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
export interface CreemCheckoutSessionView {
  readonly reference: string;
  /** The Creem checkout id; the hosted page is addressed by it. */
  readonly sessionId: string;
  /** The Creem-hosted checkout page the browser navigates to. */
  readonly checkoutUrl: string;
  readonly plan: PaidPlan;
  readonly amount: number;
  readonly currency: string;
  readonly mode: CreemConfig['mode'];
  readonly expiresAt: string | null;
}

export async function createCreemCheckoutSession(
  deps: CreemCheckoutSessionDeps,
  params: CreemCheckoutSessionParams,
): Promise<CreemCheckoutSessionView> {
  // Before anything is read or written: a plan with no product at the provider
  // cannot be paid for, so opening a session for it would only produce a dead
  // checkout row.
  const productId = deps.config.productIds[params.plan];
  if (productId === undefined) {
    throw new PlanNotPurchasableError(params.plan);
  }
  const profile = await deps.prisma.siteProfile.findFirst({
    where: { id: params.siteProfileId, accountId: params.accountId },
    include: { account: { select: { email: true } } },
  });
  if (profile === null) {
    throw new BillingNotFoundError('site profile not found');
  }
  // Seed URLs and API checks name addresses of their own. A checkout must not
  // open on a scan that would have to refuse half of what it was asked for.
  const targetProblems = scopeTargetProblems(params.scope, profile.domain);
  if (targetProblems.length > 0) {
    throw new WebhookValidationError(scopeTargetMessage(targetProblems));
  }
  const scope = scopeWithEgressLocation(params.scope, params.egress);
  assertScopeWithinPlan(params.plan, scope);
  await assertSiteIsReachable(
    deps.prisma,
    deps.now(),
    profile.id,
    profile.domain,
    scope.egressLocation ?? null,
  );

  const reference = `frcs_${randomUUID()}`;
  const createdAt = deps.now();
  // The row carries a deadline from the very first moment: a call that times
  // out (or a process that dies mid-request) must not leave a session that
  // blocks the profile — and the buyer's next attempt — with no expiry at all.
  const expiresAt = provisionalCheckoutDeadline(createdAt, CREEM_CHECKOUT_DEADLINE_DAYS);
  // Committed before the provider call so a checkout.completed webhook — which
  // can arrive before our HTTP response reaches the browser — always finds its
  // row.
  const row = await deps.prisma.$transaction(async (tx) => {
    const lockedProfile = await lockOwnProfile(
      tx,
      params.accountId,
      params.siteProfileId,
      params.expectedProfileConfigVersion,
    );
    return tx.checkoutSession.create({
      data: {
        provider: CREEM_PROVIDER,
        reference,
        accountId: params.accountId,
        siteProfileId: profile.id,
        plan: params.plan,
        productPath: productId,
        expectedAmountUsd: planPriceUsd(params.plan),
        liveMode: deps.config.liveMode,
        scopeJson: JSON.stringify(scope),
        profileConfigVersion: lockedProfile.scanConfigVersion,
        executionConfigJson: JSON.stringify(
          captureExecutionConfig(lockedProfile, params.plan, scope),
        ),
        aiConsentJson: params.aiConsent === undefined ? null : JSON.stringify(params.aiConsent),
        createdAt,
        expiresAt,
      },
    });
  });

  let checkout: CreatedCheckout;
  try {
    checkout = await createCreemCheckout(
      {
        config: deps.config,
        ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
      },
      {
        productId,
        // The tariff the product must be priced at. Creem echoes the product
        // on the created checkout, and a product priced or denominated
        // differently is refused HERE, before a card is charged, rather than
        // by the webhook after it.
        expectedPriceCents: Math.round(planPriceUsd(params.plan) * 100),
        expectedCurrency: 'USD',
        requestId: reference,
        successUrl: deps.config.returnUrl,
        metadata: { [CREEM_CHECKOUT_REFERENCE_KEY]: reference },
        // Pre-filled so the buyer types it once; Creem needs it for the receipt
        // either way, and the account email is what the purchase belongs to.
        customerEmail: profile.account.email,
      },
    );
  } catch (error) {
    // No checkout was ever opened at the provider, so this reference can never
    // be paid. Closing the row here is what keeps a provider outage from
    // leaving an open checkout behind on every retry.
    await closeUnopenedSession(deps.prisma, row.id);
    throw error;
  }

  // Creem does not quote the session back; the tariff is the only price and the
  // webhook checks the charge against it, so the quote columns stay empty.
  await deps.prisma.checkoutSession.update({
    where: { id: row.id },
    data: { providerSessionId: checkout.checkoutId },
  });

  return {
    reference,
    sessionId: checkout.checkoutId,
    checkoutUrl: checkout.checkoutUrl,
    plan: params.plan,
    amount: planPriceUsd(params.plan),
    currency: 'USD',
    mode: deps.config.mode,
    expiresAt: expiresAt.toISOString(),
  };
}
