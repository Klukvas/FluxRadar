import { OFFERED_PAID_PLANS, TARIFFS, isOfferedForPurchase } from '@fluxradar/contracts';

import { PlanNotOfferedError } from './errors.ts';

// The paid-plan vocabulary. The checkout, the webhook and the internal
// free-access path all speak these literals; none of them owns them.
//
// Two lists on purpose. PAID_PLANS is every plan a purchase can be for, so the
// webhook, refunds and reports still accept a Website Audit bought before it
// was withdrawn. OFFERED_PAID_PLANS is what a NEW checkout may be opened for.

export const PAID_PLANS = ['Basic', 'WebsiteAudit', 'Complete'] as const;

export { OFFERED_PAID_PLANS };
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

/** Refuses a new sale of a plan that is still honoured but no longer offered. */
export function assertPlanOfferedForPurchase(plan: PaidPlan): void {
  if (!isOfferedForPurchase(plan)) {
    throw new PlanNotOfferedError(plan);
  }
}
