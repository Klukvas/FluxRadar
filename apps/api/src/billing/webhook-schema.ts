import { REFUND_REASON_CODES, TARIFFS } from '@fluxradar/contracts';
import { z } from 'zod';

import { checkoutMetadataSchema } from './checkout-metadata.ts';
import { PAID_PLANS, type PaidPlan } from './plans.ts';

// LEGACY MockPaddle contract (D-008/D-029). No live Paddle integration ever
// existed: this path exists so local development and the historical BILLING-00x
// suites keep exercising the state machine. Production billing is FastSpring —
// see billing/fastspring/. Nothing here may run in production (the dev-checkout
// route refuses, and the /webhooks/paddle route is not mounted there).

export const PADDLE_PROVIDER = 'paddle' as const;

// One fixed price ID per paid plan. The handler rejects any event whose
// priceId/amount/currency disagree with the tariff matrix (§18) — a tampered
// checkout must never grant an entitlement.
export const PADDLE_PRICE_IDS: Readonly<Record<PaidPlan, string>> = {
  Basic: 'pri_fluxradar_basic_v1',
  Complete: 'pri_fluxradar_complete_v1',
};

export { PAID_PLANS };
export type { PaidPlan };

/** @deprecated Use `checkoutMetadataSchema`; kept for the legacy MockPaddle payload. */
export const paddleCustomDataSchema = checkoutMetadataSchema;
export type PaddleCustomData = z.infer<typeof checkoutMetadataSchema>;

export const PADDLE_EVENT_TYPES = [
  'transaction.paid',
  'transaction.refunded',
  'transaction.disputed',
] as const;
export type PaddleEventType = (typeof PADDLE_EVENT_TYPES)[number];

export const paddleWebhookEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.enum(PADDLE_EVENT_TYPES),
  transactionId: z.string().min(1),
  accountId: z.string().min(1),
  siteProfileId: z.string().min(1),
  plan: z.enum(PAID_PLANS),
  amountUsd: z.number().nonnegative(),
  currency: z.string().min(1),
  priceId: z.string().min(1),
  customData: checkoutMetadataSchema.optional(),
  taxAmountUsd: z.number().nonnegative().optional(),
  refundRequestId: z.string().min(1).optional(),
  refundReasonCode: z.enum(REFUND_REASON_CODES).optional(),
});

export type PaddleWebhookEvent = z.infer<typeof paddleWebhookEventSchema>;

/** amount/currency/priceId must match the tariff matrix exactly (§18). */
export function findPriceMismatch(event: PaddleWebhookEvent): string | null {
  const tariff = TARIFFS[event.plan];
  if (event.priceId !== PADDLE_PRICE_IDS[event.plan]) {
    return `priceId ${event.priceId} does not match plan ${event.plan}`;
  }
  if (event.currency !== 'USD') {
    return `unsupported currency ${event.currency}`;
  }
  if (event.amountUsd !== tariff.priceUsd) {
    return `amount ${event.amountUsd} does not match ${event.plan} price ${tariff.priceUsd}`;
  }
  return null;
}
