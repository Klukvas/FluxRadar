import { TARIFFS } from '@fluxradar/contracts';

// The paid-plan vocabulary. The checkout, the webhook and the internal
// free-access path all speak these literals; none of them owns them.

export const PAID_PLANS = ['Basic', 'WebsiteAudit', 'Complete'] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

export function isPaidPlan(value: string): value is PaidPlan {
  return (PAID_PLANS as readonly string[]).includes(value);
}

/** Catalogue price in USD for a paid plan (§18 tariff matrix). */
export function planPriceUsd(plan: PaidPlan): number {
  return TARIFFS[plan].priceUsd;
}

/** Maximum crawlable URLs the plan allows; the checkout validates scope against it. */
export function planUrlLimit(plan: PaidPlan): number {
  return TARIFFS[plan].urlLimit;
}
