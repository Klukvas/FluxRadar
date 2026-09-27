import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { ScanScopeInput } from '@fluxradar/contracts';
import { captureExecutionConfig, lockOwnProfile } from '../../profiles/execution-config.ts';
import { scopeTargetMessage, scopeTargetProblems } from '../../scans/scope-targets.ts';
import { scopeWithEgressLocation, type LaunchEgress } from '../../scans/launch-egress.ts';

import type { AiConsentInput } from '../checkout-metadata.ts';
import { provisionalCheckoutDeadline } from '../checkout-lifecycle.ts';
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
  // Before anything is read or written: a plan with no product at the provider
  // cannot be paid for, so opening a session for it would only produce a dead
  // checkout row.
  const productPath = deps.config.productPaths[params.plan];
  if (productPath === undefined) {
    throw new PlanNotPurchasableError(params.plan);
  }
  const profile = await deps.prisma.siteProfile.findFirst({
    where: { id: params.siteProfileId, accountId: params.accountId },
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

// The buyer-facing status poll is provider-neutral and lives beside the other
// shared checkout pieces; it is re-exported here so the FastSpring surface stays
// one import.
export { findCheckoutStatus, type CheckoutStatusView } from '../checkout-status.ts';
