import { TARIFFS } from '@fluxradar/contracts';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

import { getPaddleWebhookSecret, signPaddleWebhook } from './paddle-signature.ts';
import { handlePaddleWebhook } from './webhook-handler.ts';
import type { WebhookHandlingResult } from './webhook-handler.ts';
import { PADDLE_PRICE_IDS } from './webhook-schema.ts';
import type { PaddleWebhookEvent, PaidPlan } from './webhook-schema.ts';

export interface SimulateCheckoutParams {
  readonly prisma: PrismaClient;
  readonly accountId: string;
  readonly siteProfileId: string;
  readonly plan: PaidPlan;
  readonly eventId?: string;
  readonly transactionId?: string;
  /** Defaults to PADDLE_WEBHOOK_SECRET from the environment. */
  readonly secret?: string;
  /** Test hook: tamper with individual fields (wrong amount/priceId probes). */
  readonly overrides?: Partial<PaddleWebhookEvent>;
}

export interface SimulateCheckoutResult {
  readonly event: PaddleWebhookEvent;
  readonly rawBody: string;
  readonly signature: string;
  readonly result: WebhookHandlingResult;
}

/**
 * MockPaddle dev-checkout (D-008/D-029): builds a `transaction.paid` event,
 * signs the raw body with HMAC-SHA256 and feeds it through the real webhook
 * handler — dev UI and tests exercise exactly the production code path.
 */
export async function simulatePaidCheckout(
  params: SimulateCheckoutParams,
): Promise<SimulateCheckoutResult> {
  const secret = params.secret ?? getPaddleWebhookSecret();
  const event: PaddleWebhookEvent = {
    eventId: params.eventId ?? `evt_${randomUUID()}`,
    eventType: 'transaction.paid',
    transactionId: params.transactionId ?? `txn_${randomUUID()}`,
    accountId: params.accountId,
    siteProfileId: params.siteProfileId,
    plan: params.plan,
    amountUsd: TARIFFS[params.plan].priceUsd,
    currency: 'USD',
    priceId: PADDLE_PRICE_IDS[params.plan],
    ...params.overrides,
  };
  const rawBody = JSON.stringify(event);
  const signature = signPaddleWebhook(rawBody, secret);
  const result = await handlePaddleWebhook(params.prisma, rawBody, signature, { secret });
  return { event, rawBody, signature, result };
}
