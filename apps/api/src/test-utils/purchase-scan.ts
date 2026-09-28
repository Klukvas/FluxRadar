// A paid scan, bought the way production buys one.
//
// The only thing that grants paid access is a signed Creem checkout.completed
// matched to a checkout session row (D-229). So the session is opened by
// `createCreemCheckoutSession` itself — plan limit, reachability gate, profile
// lock and revision check, stored scope, execution config and deadline are all
// production code — and the order goes through the real webhook handler,
// which makes the purchase, the entitlement, the scan and its job.
//
// What stands in for the outside world, and nothing else:
// - Creem's checkout API, answering with a checkout priced at the plan's USD
//   list price;
// - the reachability check, as the fresh 'reachable' probe of the profile's own
//   domain that the launch screen leaves behind for a site the crawler can read;
// - the egress location: a deployment that crawls directly, as tests do.
// Only the HTTP layer of POST /billing/checkout-session (auth, rate limit, body
// parsing) is skipped; CREEM-004 covers that.

import { randomUUID } from 'node:crypto';

import { scanScopeSchema, type ScanScopeInput } from '@fluxradar/contracts';
import type { PrismaClient, SiteProfile } from '@prisma/client';

import type { AiConsentInput } from '../billing/checkout-metadata.ts';
import { createCreemCheckoutSession } from '../billing/creem/checkout-session.ts';
import { readCreemConfig, type CreemConfig } from '../billing/creem/config.ts';
import { TEST_CREEM_SECRET, checkoutCompletedObject, signedCreemDelivery } from '../billing/creem/test-payloads.ts';
import { CREEM_EVENT_TYPES } from '../billing/creem/events.ts';
import { handleCreemWebhook } from '../billing/creem/webhook-handler.ts';
import type { FetchLike } from '../billing/fetch-like.ts';
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
  const opened = await openCheckout(prisma, params);
  return completeOrder(prisma, opened.reference, params.plan, opened.now);
}

/** A checkout session opened by production code, left unpaid. */
export interface OpenedCheckout {
  readonly reference: string;
  readonly productId: string;
  readonly now: Date;
}

/**
 * Opens the checkout without settling it, so a test can deliver its own order.
 *
 * The half `purchaseScan` does first, exported for the cases that are about the
 * order rather than the purchase: a replayed delivery, one naming another
 * product, one carrying the wrong amount.
 */
export async function openCheckout(
  prisma: PrismaClient,
  params: PurchaseScanParams,
): Promise<OpenedCheckout> {
  const profile = await prisma.siteProfile.findUniqueOrThrow({
    where: { id: params.siteProfileId },
  });
  const now = new Date();
  await recordReachableProbe(prisma, profile, now);
  const checkout = await createCreemCheckoutSession(
    { prisma, config: CHECKOUT_CONFIG, now: () => now, fetchImpl: checkoutPricedAt(params.plan) },
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
  return { reference: checkout.reference, productId: productIdFor(params.plan), now };
}

export interface DeliveredOrderParams {
  readonly reference: string | null;
  readonly productId: string;
  readonly amountCents: number;
  /** Reuse an id to replay a delivery the provider already sent. */
  readonly orderId?: string;
  readonly checkoutId?: string;
  readonly eventId?: string;
}

/** Delivers one signed `checkout.completed` through the real webhook handler. */
export async function deliverOrder(
  prisma: PrismaClient,
  params: DeliveredOrderParams,
): Promise<{
  readonly createdScanIds: readonly string[];
  readonly orderId: string;
  readonly eventId: string;
}> {
  const orderId = params.orderId ?? `ord_${randomUUID()}`;
  const checkoutId = params.checkoutId ?? `chk_${randomUUID()}`;
  const eventId = params.eventId ?? `evt_${randomUUID()}`;
  const { rawBody, signature } = signedCreemDelivery(
    {
      id: eventId,
      eventType: CREEM_EVENT_TYPES.checkoutCompleted,
      object: checkoutCompletedObject({
        checkoutId,
        orderId,
        reference: params.reference,
        productId: params.productId,
        amountCents: params.amountCents,
      }),
    },
    CHECKOUT_CONFIG.webhookSecret,
  );
  const delivered = await handleCreemWebhook(prisma, rawBody, signature, {
    secret: CHECKOUT_CONFIG.webhookSecret,
    expectLive: CHECKOUT_CONFIG.liveMode,
    now: new Date(),
  });
  return { createdScanIds: delivered.createdScanIds, orderId, eventId };
}

/** The Creem product id the test store maps a plan to; absent is a fixture bug. */
export function productIdFor(plan: PaidPlan): string {
  const productId = CHECKOUT_CONFIG.productIds[plan];
  if (productId === undefined) {
    throw new Error(`purchaseScan: the test Creem config has no product for ${plan}`);
  }
  return productId;
}

/** Delivers the signed checkout.completed for a session, as Creem would. */
async function completeOrder(
  prisma: PrismaClient,
  reference: string,
  plan: PaidPlan,
  now: Date,
): Promise<PurchasedScan> {
  const productId = productIdFor(plan);
  const amountCents = Math.round(planPriceUsd(plan) * 100);
  const orderId = `ord_${randomUUID()}`;
  const checkoutId = `chk_${randomUUID()}`;
  const { rawBody, signature } = signedCreemDelivery(
    {
      id: `evt_${randomUUID()}`,
      eventType: CREEM_EVENT_TYPES.checkoutCompleted,
      object: checkoutCompletedObject({ checkoutId, orderId, reference, productId, amountCents }),
    },
    CHECKOUT_CONFIG.webhookSecret,
  );
  const delivered = await handleCreemWebhook(prisma, rawBody, signature, {
    secret: CHECKOUT_CONFIG.webhookSecret,
    expectLive: CHECKOUT_CONFIG.liveMode,
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

/** Creem's Checkout API, answering with a checkout at the list price. */
function checkoutPricedAt(plan: PaidPlan): FetchLike {
  const body = JSON.stringify({
    id: `chk_${randomUUID()}`,
    checkout_url: 'https://test-checkout.creem.io/session/stub',
    status: 'pending',
    mode: 'test',
    product: { id: productIdFor(plan), price: Math.round(planPriceUsd(plan) * 100), currency: 'USD' },
  });
  return () =>
    Promise.resolve(
      new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
    );
}

function testCheckoutConfig(): CreemConfig {
  const result = readCreemConfig({
    CREEM_MODE: 'test',
    CREEM_API_KEY: 'creem-api-key-value',
    CREEM_WEBHOOK_SECRET: TEST_CREEM_SECRET,
    FRONTEND_ORIGIN: 'https://fluxradar.test',
    CREEM_PRODUCT_ID_BASIC: 'prod_basic',
    CREEM_PRODUCT_ID_COMPLETE: 'prod_complete',
    CREEM_PRODUCT_ID_WEBSITE_AUDIT: 'prod_website_audit',
  });
  if (result.state !== 'configured') {
    throw new Error(`purchaseScan: the test Creem config is ${result.state}`);
  }
  return result.config;
}
