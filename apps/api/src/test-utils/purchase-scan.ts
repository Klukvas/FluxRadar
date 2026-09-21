// A paid scan, bought the way production buys one.
//
// The only thing that grants paid access is a signed FastSpring
// order.completed matched to a checkout session row (D-229). So that is what
// this writes: the session row as `createCheckoutSession` stores it, then the
// order through the real webhook handler — the purchase, the entitlement, the
// scan and its job all come from production code, not from a test's guess.

import { randomUUID } from 'node:crypto';

import { scanScopeSchema, type ScanScopeInput } from '@fluxradar/contracts';
import type { PrismaClient } from '@prisma/client';

import type { AiConsentInput } from '../billing/checkout-metadata.ts';
import { FASTSPRING_PROVIDER } from '../billing/fastspring/config.ts';
import {
  TEST_FASTSPRING_SECRET,
  orderCompletedData,
  signedDelivery,
} from '../billing/fastspring/test-payloads.ts';
import { handleFastSpringWebhook } from '../billing/fastspring/webhook-handler.ts';
import { planPriceUsd, type PaidPlan } from '../billing/plans.ts';
import { assertProfileRevision, captureExecutionConfig } from '../profiles/execution-config.ts';

const TEST_PRODUCT_PATHS: Readonly<Record<PaidPlan, string>> = {
  Basic: 'fluxradar-basic-scan',
  Complete: 'fluxradar-complete-scan',
};

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
  assertProfileRevision(profile, params.expectedProfileConfigVersion);
  const scope = scanScopeSchema.parse({ includeSubdomains: false, ...params.scope });
  const productPath = TEST_PRODUCT_PATHS[params.plan];
  const price = planPriceUsd(params.plan);
  const session = await prisma.checkoutSession.create({
    data: {
      provider: FASTSPRING_PROVIDER,
      reference: `frcs_${randomUUID()}`,
      accountId: profile.accountId,
      siteProfileId: profile.id,
      plan: params.plan,
      productPath,
      expectedAmountUsd: price,
      quotedAmount: price,
      quotedCurrency: 'USD',
      liveMode: false,
      scopeJson: JSON.stringify(scope),
      profileConfigVersion: profile.scanConfigVersion,
      executionConfigJson: JSON.stringify(captureExecutionConfig(profile, params.plan, scope)),
      aiConsentJson: params.aiConsent === undefined ? null : JSON.stringify(params.aiConsent),
    },
  });
  const { rawBody, signature } = signedDelivery([
    {
      id: `evt_${randomUUID()}`,
      type: 'order.completed',
      data: orderCompletedData({
        orderId: `ord_${randomUUID()}`,
        reference: session.reference,
        productPath,
        amount: price,
      }),
    },
  ]);
  const delivered = await handleFastSpringWebhook(prisma, rawBody, signature, {
    secret: TEST_FASTSPRING_SECRET,
    expectLive: false,
    currencyPolicy: 'strict',
  });
  const [scanId] = delivered.createdScanIds;
  if (scanId === undefined) {
    throw new Error(
      `purchaseScan: the order created no scan (${JSON.stringify(delivered.results)})`,
    );
  }
  const settled = await prisma.checkoutSession.findUniqueOrThrow({ where: { id: session.id } });
  if (settled.purchaseId === null) {
    throw new Error('purchaseScan: the checkout session was not linked to a purchase');
  }
  return { scanId, purchaseId: settled.purchaseId };
}
