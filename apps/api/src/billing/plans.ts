import { TARIFFS } from '@fluxradar/contracts';

// Provider-neutral paid-plan vocabulary. Both the legacy MockPaddle path and the
// FastSpring path speak these literals; neither owns them.

export const PAID_PLANS = ['Basic', 'Complete'] as const;
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
