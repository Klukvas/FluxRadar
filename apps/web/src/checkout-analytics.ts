// Checkout milestones in GA4's ecommerce shape, so the property's own funnel and
// monetisation reports work without custom definitions.
//
// Only live-mode checkouts are reported. While the FastSpring store runs in test
// mode every order is a test card, and a test purchase sent to GA becomes
// revenue in the property that can never be taken out again.

import { trackEvent } from './analytics';
import type { CheckoutConfig, CheckoutSession, CheckoutStatus } from './api';

function purchasedItems(plan: string): readonly Readonly<Record<string, string>>[] {
  return [{ item_id: plan, item_name: `FluxRadar ${plan}` }];
}

export function trackBeginCheckout(session: CheckoutSession): void {
  if (session.mode !== 'live') return;
  trackEvent('begin_checkout', {
    currency: session.currency,
    value: session.amount,
    items: purchasedItems(session.plan),
  });
}

/**
 * Sent when the server confirms the order. The purchase id is the transaction
 * id, so the confirmation being seen again after a reload is deduplicated by GA
 * instead of counted twice.
 */
export function trackPurchase(status: CheckoutStatus, config: CheckoutConfig | null): void {
  if (config?.mode !== 'live' || status.purchaseId === null) return;
  const plans = Array.isArray(config.plans) ? config.plans : [];
  const price = plans.find((entry) => entry.plan === status.plan);
  trackEvent('purchase', {
    transaction_id: status.purchaseId,
    ...(price === undefined ? {} : { currency: price.currency, value: price.priceUsd }),
    items: purchasedItems(status.plan),
  });
}
