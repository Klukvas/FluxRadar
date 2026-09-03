import { REFUND_REASON_CODES, TARIFFS, scanScopeSchema } from '@fluxradar/contracts';
import { AI_PROVIDER_NAMES } from '@fluxradar/ai';
import { z } from 'zod';

// MockPaddle price catalogue: one fixed price ID per paid plan. The webhook
// handler rejects any event whose priceId/amount/currency disagree with the
// tariff matrix (§18) — a tampered checkout must never grant an entitlement.
export const PADDLE_PRICE_IDS = {
  Basic: 'pri_fluxradar_basic_v1',
  Complete: 'pri_fluxradar_complete_v1',
} as const;

export type PaidPlan = keyof typeof PADDLE_PRICE_IDS;

export const PAID_PLANS = Object.keys(PADDLE_PRICE_IDS) as readonly PaidPlan[];

export const PADDLE_EVENT_TYPES = [
  'transaction.paid',
  'transaction.refunded',
  'transaction.disputed',
] as const;
export type PaddleEventType = (typeof PADDLE_EVENT_TYPES)[number];

// Passthrough-полезная нагрузка checkout-а (аналог custom_data реального Paddle,
// D-134): реальный scope запроса и AI-consent пользователя едут внутри
// подписанного события и применяются атомарно в той же транзакции, что и
// создание Scan/Entitlement. Оба поля опциональны — события формата T-06
// без customData остаются валидными (scan получает DEFAULT_SCOPE_JSON).
export const paddleCustomDataSchema = z.object({
  scope: scanScopeSchema.optional(),
  aiConsent: z
    .object({
      providers: z.array(z.enum(AI_PROVIDER_NAMES)).min(1),
      noticeVersion: z.string().min(1),
    })
    .optional(),
});

export type PaddleCustomData = z.infer<typeof paddleCustomDataSchema>;

export const paddleWebhookEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.enum(PADDLE_EVENT_TYPES),
  transactionId: z.string().min(1),
  accountId: z.string().min(1),
  siteProfileId: z.string().min(1),
  plan: z.enum(PAID_PLANS as [PaidPlan, ...PaidPlan[]]),
  amountUsd: z.number().nonnegative(),
  currency: z.string().min(1),
  priceId: z.string().min(1),
  customData: paddleCustomDataSchema.optional(),
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
