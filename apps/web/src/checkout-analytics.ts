// Checkout milestones in GA4's ecommerce shape, so the property's own funnel and
// monetisation reports work without custom definitions.
//
// Only live-mode checkouts are reported. While the Creem store runs in test
// mode every order is a test card, and a test purchase sent to GA becomes
// revenue in the property that can never be taken out again.

import { trackEvent } from './analytics';
import type { CheckoutConfig, CheckoutSession, CheckoutStatus } from './api';

// What this page load already reported. A purchase seen again after a reload is
// left to GA's transaction_id deduplication; within one page these keep a second
// poll or a re-render from sending it twice.
const reportedCheckouts = new Set<string>();
const reportedPurchases = new Set<string>();

function purchasedItems(plan: string): readonly Readonly<Record<string, string>>[] {
  return [{ item_id: plan, item_name: `FluxRadar ${plan}` }];
}

/**
 * How long the checkout redirect waits for gtag to hand `begin_checkout` over.
 * gtag never calls back when its script was blocked or has not loaded yet, and
 * the buyer must not wait on analytics for longer than a blink.
 */
export const BEGIN_CHECKOUT_DELIVERY_MS = 400;

/**
 * Reports the checkout the server just opened, then calls `proceed` — the
 * redirect to the provider — exactly once: when gtag has handed the event over,
 * after BEGIN_CHECKOUT_DELIVERY_MS at the latest, or at once when nothing was
 * sent (no consent, another host, a test-mode store, a session already reported).
 */
export function trackBeginCheckout(session: CheckoutSession, proceed: () => void): void {
  let proceeded = false;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  const proceedOnce = (): void => {
    if (proceeded) return;
    proceeded = true;
    if (fallback !== undefined) clearTimeout(fallback);
    proceed();
  };
  const sent =
    session.mode === 'live' &&
    !reportedCheckouts.has(session.reference) &&
    trackEvent(
      'begin_checkout',
      { currency: session.currency, value: session.amount, items: purchasedItems(session.plan) },
      { onDelivered: proceedOnce },
    );
  if (!sent) {
    proceedOnce();
    return;
  }
  reportedCheckouts.add(session.reference);
  if (!proceeded) fallback = setTimeout(proceedOnce, BEGIN_CHECKOUT_DELIVERY_MS);
}

/**
 * Sent when the server confirms the order. The purchase id is the transaction
 * id, so the confirmation being seen again after a reload is deduplicated by GA
 * instead of counted twice.
 */
export function trackPurchase(status: CheckoutStatus, config: CheckoutConfig | null): void {
  if (config?.mode !== 'live' || status.purchaseId === null) return;
  if (status.scanId === null || reportedPurchases.has(status.purchaseId)) return;
  const plans = Array.isArray(config.plans) ? config.plans : [];
  const price = plans.find((entry) => entry.plan === status.plan);
  const sent = trackEvent('purchase', {
    transaction_id: status.purchaseId,
    ...(price === undefined ? {} : { currency: price.currency, value: price.priceUsd }),
    items: purchasedItems(status.plan),
  });
  if (sent) reportedPurchases.add(status.purchaseId);
}

/**
 * Reports a confirmed order once the store's config is known, whenever that is.
 * The confirmation window closes as soon as the order is confirmed, so the
 * report cannot wait on that window. A config that cannot be read sends no
 * purchase at all: without it, neither the live mode nor the price is known, and
 * a purchase with a guessed value would be revenue that cannot be corrected.
 */
export function reportPurchaseWhenConfigReady(
  status: CheckoutStatus,
  config: Promise<CheckoutConfig | null>,
): void {
  void config
    .then((value) => trackPurchase(status, value))
    .catch((error: unknown) => console.error('FluxRadar purchase report failed', error));
}

/** Test seam: forgets which checkouts and purchases this page load reported. */
export function resetCheckoutAnalyticsForTests(): void {
  reportedCheckouts.clear();
  reportedPurchases.clear();
}
