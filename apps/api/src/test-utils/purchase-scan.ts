// A paid scan, bought the way production buys one.
//
// The only thing that grants paid access is a signed FastSpring
// order.completed matched to a checkout session row (D-229). So the session is
// opened by `createCheckoutSession` itself — plan limit, reachability gate,
// profile lock and revision check, stored scope, execution config and deadline
// are all production code — and the order goes through the real webhook
// handler, which makes the purchase, the entitlement, the scan and its job.
//
// What stands in for the outside world, and nothing else:
// - FastSpring's session API, answering with a session priced at the plan's
//   USD list price;
// - the reachability check, as the fresh 'reachable' probe of the profile's own
//   domain that the launch screen leaves behind for a site the crawler can read;
// - the egress location: a deployment that crawls directly, as tests do.
// Only the HTTP layer of POST /billing/checkout-session (auth, rate limit, body
// parsing) is skipped; FASTSPRING-004 covers that.

import { randomUUID } from 'node:crypto';

import { scanScopeSchema, type ScanScopeInput } from '@fluxradar/contracts';
import type { PrismaClient, SiteProfile } from '@prisma/client';

import type { AiConsentInput } from '../billing/checkout-metadata.ts';
import { createCheckoutSession } from '../billing/fastspring/checkout-session.ts';
import type { FetchLike } from '../billing/fastspring/client.ts';
import { readFastSpringConfig, type FastSpringConfig } from '../billing/fastspring/config.ts';
import {
  TEST_FASTSPRING_SECRET,
  orderCompletedData,
  signedDelivery,
} from '../billing/fastspring/test-payloads.ts';
import { handleFastSpringWebhook } from '../billing/fastspring/webhook-handler.ts';
import { planPriceUsd, type PaidPlan } from '../billing/plans.ts';
import { silentLogger } from '../http/logger.ts';
import { createEgressLocationMonitor } from '../integrations/crawl-egress-monitor.ts';
import { resolveLaunchEgressLocation } from '../scans/launch-egress.ts';

const CHECKOUT_CONFIG = testCheckoutConfig();
const DIRECT_EGRESS = createEgressLocationMonitor({ locations: [], logger: silentLogger });

export interface PurchaseScanParams {
  /** The profile being bought for; the buyer is the account that owns it. */
  readonly siteProfileId: string;
  readonly plan: PaidPlan;
  /** As a checkout request sends it; defaults are applied by `scanScopeSchema`. */
  readonly scope: Partial<ScanScopeInput>;
  readonly aiConsent?: AiConsentInput;
  /** Refuses the purchase, as the checkout does, when the profile has moved on. */
  readonly expectedProfileConfigVersion?: number;
}

export interface PurchasedScan {
  readonly scanId: string;
  readonly purchaseId: string;
}

export async function purchaseScan(
  prisma: PrismaClient,
  params: PurchaseScanParams,
): Promise<PurchasedScan> {
  const profile = await prisma.siteProfile.findUniqueOrThrow({
    where: { id: params.siteProfileId },
  });
  const now = new Date();
  await recordReachableProbe(prisma, profile, now);
  const checkout = await createCheckoutSession(
    { prisma, config: CHECKOUT_CONFIG, now: () => now, fetchImpl: sessionPricedAt(params.plan) },
    {
      accountId: profile.accountId,
      siteProfileId: profile.id,
      plan: params.plan,
      scope: scanScopeSchema.parse({ includeSubdomains: false, ...params.scope }),
      egress: await resolveLaunchEgressLocation(DIRECT_EGRESS, undefined),
      aiConsent: params.aiConsent,
      expectedProfileConfigVersion: params.expectedProfileConfigVersion,
    },
  );
  return completeOrder(prisma, checkout.reference, params.plan, now);
}

/** Delivers the signed order.completed for a session, as FastSpring would. */
async function completeOrder(
  prisma: PrismaClient,
  reference: string,
  plan: PaidPlan,
  now: Date,
): Promise<PurchasedScan> {
  const order = orderCompletedData({
    orderId: `ord_${randomUUID()}`,
    reference,
    productPath: CHECKOUT_CONFIG.productPaths[plan],
    amount: planPriceUsd(plan),
  });
  const { rawBody, signature } = signedDelivery(
    [{ id: `evt_${randomUUID()}`, type: 'order.completed', data: order }],
    CHECKOUT_CONFIG.webhookSecret,
  );
  const delivered = await handleFastSpringWebhook(prisma, rawBody, signature, {
    secret: CHECKOUT_CONFIG.webhookSecret,
    expectLive: CHECKOUT_CONFIG.liveMode,
    currencyPolicy: CHECKOUT_CONFIG.currencyPolicy,
    now,
  });
  const [scanId] = delivered.createdScanIds;
  if (scanId === undefined) {
    throw new Error(
      `purchaseScan: the order created no scan (${JSON.stringify(delivered.results)})`,
    );
  }
  const settled = await prisma.checkoutSession.findUniqueOrThrow({ where: { reference } });
  if (settled.purchaseId === null) {
    throw new Error('purchaseScan: the checkout session was not linked to a purchase');
  }
  return { scanId, purchaseId: settled.purchaseId };
}

/** The probe a passing reachability check leaves behind, for a direct crawl. */
async function recordReachableProbe(
  prisma: PrismaClient,
  profile: SiteProfile,
  checkedAt: Date,
): Promise<void> {
  const probe = {
    accountId: profile.accountId,
    origin: profile.domain,
    egressLocation: null,
    state: 'reachable',
    checkedAt,
  };
  await prisma.siteReachabilityProbe.upsert({
    where: { siteProfileId: profile.id },
    create: { siteProfileId: profile.id, ...probe },
    update: probe,
  });
}

/** FastSpring's Sessions v1 API, answering with a session at the list price. */
function sessionPricedAt(plan: PaidPlan): FetchLike {
  const body = JSON.stringify({
    id: `sess_${randomUUID()}`,
    subtotal: planPriceUsd(plan),
    currency: 'USD',
  });
  return () =>
    Promise.resolve(
      new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
    );
}

function testCheckoutConfig(): FastSpringConfig {
  const result = readFastSpringConfig({
    FASTSPRING_MODE: 'test',
    FASTSPRING_API_USERNAME: 'api-user',
    FASTSPRING_API_PASSWORD: 'api-password-value',
    FASTSPRING_WEBHOOK_SECRET: TEST_FASTSPRING_SECRET,
    FASTSPRING_STOREFRONT_URL: 'https://fluxradar.test.onfastspring.com',
    FASTSPRING_PRODUCT_PATH_BASIC: 'fluxradar-basic-scan',
    FASTSPRING_PRODUCT_PATH_COMPLETE: 'fluxradar-complete-scan',
  });
  if (result.state !== 'configured') {
    throw new Error(`purchaseScan: the test FastSpring config is ${result.state}`);
  }
  return result.config;
}
