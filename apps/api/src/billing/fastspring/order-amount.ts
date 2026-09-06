import type { CheckoutSession } from '@prisma/client';

import { planPriceUsd, type PaidPlan } from '../plans.ts';
import type { FastSpringCurrencyPolicy } from './config.ts';
import type { FastSpringOrderItem, OrderCompletedEvent } from './events.ts';

// What a completed FastSpring order is allowed to have charged.
//
// Two independent things are checked here, and only one of them is the price:
//
//   * the order must be the order we opened — same product, and, when FastSpring
//     charged in the currency it quoted, an amount the quote is consistent with;
//   * the order must be worth the plan, measured against `planPriceUsd(plan)`.
//
// The second check is what the provider quote may never stand in for. The quote
// comes out of the FastSpring catalogue, so a product entry priced at $1 by
// mistake (or by someone with access to the store) produces a $1 quote, a $1
// charge and a quote/charge comparison that matches perfectly. Access to Basic
// or Complete is therefore granted against the USD tariff this repository owns,
// never against the number the provider sent back.
//
// FOUR DOCUMENTED FIGURES, NO GUESSING. `order.completed` states the order on
// four fields, and every comparison below names which of them it uses
// (developer.fastspring.com — "Successful Orders", order.completed pricing
// fields; the same four exist per item):
//
//   subtotal  "Subtotal before discounts and tax"   — the LIST price
//   discount  "Total discount applied"              — same tax-free basis
//   tax       "Tax amount"
//   total     "Total order amount"                  — what the buyer was charged
//
// so `total = subtotal - discount + tax`, and the two figures that describe the
// payment are:
//
//   netPaid = subtotal - discount   what the buyer paid, tax excluded
//   charged = total                 what the buyer paid, tax included
//
// DISCOUNTS. `subtotal` is stated BEFORE discounts, so it is not what anyone
// paid: a coupon leaves it at the full $55 while the card is charged $27.50.
// Reading it as the payment — or reconstructing the charge as
// `max(subtotal, total)` — hands a full plan to a half-price order and records a
// $55 purchase against a $27.50 charge, so the later full refund of $27.50 looks
// like a partial one and never suspends the entitlement. The discount is a field
// FastSpring reports, at order and at item level, and it is read rather than
// assumed away. When the field is absent it is still not assumed away: anything
// in `subtotal + tax - total` that the tax does not explain is a deduction.
//
// TAX. Which side of the price carries the tax is a store-level setting no
// webhook field states: a gross-priced store folds it into the buyer's price
// ($55 charged = $49.70 net + $5.30 tax), a net-priced store adds it on top
// ($55 net + $5.50 tax = $60.50 charged). Comparing figures across the two bases
// is what refuses an order the buyer has already paid in full, so each
// comparison below is stated on one explicit basis:
//
//   * quote vs order — the quote must fall inside the order's own
//     [netPaid, list + tax] band, which collapses to a point comparison for an
//     undiscounted, untaxed order and stays correct in either pricing mode;
//   * order vs plan price — an order that already covers the tariff BEFORE tax
//     is worth the plan in either mode; an order that only reaches it once tax
//     is counted is worth the plan only if nothing was discounted off it;
//   * catalogue mismatch — measured on netPaid, so a taxed order is not
//     mistaken for a catalogue entry priced above the tariff.
//
// The policy is deliberately asymmetric, because the two failure directions are
// not comparable: an underpaid order that is honoured hands out a paid plan for
// nothing, while an order refused after the buyer was charged leaves a real
// charge with nothing to show for it and needs a manual refund. So:
//
//   * below the plan price  -> always rejected, in every branch;
//   * above the plan price  -> granted, and recorded as a catalogue mismatch;
//   * not expressible in USD -> granted, and recorded as unverified — unless the
//                              order was discounted, which is the one case where
//                              "unverified" would be covering for a real
//                              shortfall. Never silently: the reason reaches
//                              WebhookEvent.outcomeReason and
//                              CheckoutSession.statusReason.
//
// Currency itself is governed by FASTSPRING_CURRENCY_POLICY: a store that cannot
// localise keeps 'strict' and refuses anything but the quoted currency, while a
// store that localises accepts the buyer's currency and is checked against
// FastSpring's own USD payout figure.

/** Same-currency comparisons are exact to the cent. */
const EXACT_TOLERANCE = 0.01;

/**
 * Floor for an order whose USD value comes from a currency conversion, as a
 * fraction of the USD tariff. FX rates, localised price rounding and tax
 * treatment all move FastSpring's USD payout figure away from the list price, so
 * an exact comparison would reject genuine orders. Half the list price is far
 * outside that band and only a mispriced catalogue entry can produce it — which
 * must not silently grant a scan.
 */
const MIN_USD_RATIO = 0.6;

export type OrderAmountVerdict =
  | {
      readonly kind: 'accepted';
      /** USD figure the refund policy works in: what the buyer was charged. */
      readonly amountUsd: number;
      readonly settledAmount: number;
      readonly settledCurrency: string;
      /** Set when the amount is not a plain full-price match; operator-facing. */
      readonly unverifiedReason: string | null;
    }
  | { readonly kind: 'rejected'; readonly reason: string };

/** The provider's own quote for this session. Bookkeeping, never the price. */
interface Quote {
  readonly currency: string;
  readonly amount: number;
}

/**
 * One order on both tax bases, in the buyer's currency and — when FastSpring
 * reports a USD payout — in USD. `charged` is never below `netPaid`: tax is
 * added or folded in, never subtracted.
 */
interface OrderAmounts {
  /** `subtotal`: the list price, before discounts and before tax. */
  readonly list: number;
  /** `discount`: what was deducted from the list price. */
  readonly discount: number;
  /** What the buyer paid, tax excluded: `list - discount`. */
  readonly netPaid: number;
  /** What the buyer was charged, tax included. */
  readonly charged: number;
  /** The list price with the order's tax on top; the top of the quote band. */
  readonly listWithTax: number;
  readonly netPaidUsd: number | null;
  readonly chargedUsd: number | null;
}

function quoteOf(session: CheckoutSession): Quote {
  return {
    currency: session.quotedCurrency ?? 'USD',
    amount: session.quotedAmount ?? session.expectedAmountUsd,
  };
}

/**
 * The USD price this order has to be worth.
 *
 * Both inputs are server-issued: the current tariff, and the tariff as it stood
 * when the session was opened. The lower one is used so a price rise between
 * checkout and payment cannot refuse a buyer who paid exactly what they were
 * quoted. A stored expectation that is not a usable price falls back to the
 * tariff rather than lowering the floor.
 */
function requiredUsd(session: CheckoutSession, plan: PaidPlan): number {
  const tariff = planPriceUsd(plan);
  const promised = session.expectedAmountUsd;
  return Number.isFinite(promised) && promised > 0 ? Math.min(tariff, promised) : tariff;
}

export function resolveOrderAmount(
  session: CheckoutSession,
  event: OrderCompletedEvent,
  item: FastSpringOrderItem,
  policy: FastSpringCurrencyPolicy,
  plan: PaidPlan,
): OrderAmountVerdict {
  const amounts = readOrderAmounts(event, item);
  const quote = quoteOf(session);
  const expectedUsd = requiredUsd(session, plan);

  if (event.currency !== quote.currency && policy === 'strict') {
    return {
      kind: 'rejected',
      reason:
        `order currency ${event.currency} does not match the quoted ${quote.currency}; ` +
        'the store is configured as single-currency (FASTSPRING_CURRENCY_POLICY=strict)',
    };
  }
  // Bound to the checkout we opened: when FastSpring charged in the currency it
  // quoted, an order the quote does not sit inside is not this order. The band —
  // rather than one figure — is what keeps the tax mode of the store out of the
  // comparison; it collapses to the old exact match whenever there is no tax and
  // no discount. A discount widens the band downwards, because the quote is the
  // list price the discount came off; that a discounted order is not worth the
  // plan is decided below, against the tariff, not against the catalogue.
  if (event.currency === quote.currency && !quoteFitsOrder(quote.amount, amounts)) {
    return {
      kind: 'rejected',
      reason: describeQuoteMismatch(quote.amount, amounts),
    };
  }

  // An order already in USD is compared to the cent; a converted one gets the
  // FX band, because its USD figure went through a rate we do not control.
  const floor =
    event.currency === 'USD' ? expectedUsd - EXACT_TOLERANCE : expectedUsd * MIN_USD_RATIO;
  const settled = { settledAmount: amounts.charged, settledCurrency: event.currency } as const;

  if (isDiscounted(amounts)) {
    return resolveDiscountedOrder(amounts, event, floor, expectedUsd, plan, settled);
  }

  // Nothing was deducted, so the list price IS what was paid and the charged
  // figure — the only one that means the same thing in a gross-priced and in a
  // net-priced store — decides.
  const paidUsd = amounts.chargedUsd ?? amounts.netPaidUsd;
  if (paidUsd === null) {
    return {
      kind: 'accepted',
      // Nothing here can convert the charge, so the plan price stays the USD
      // reference the refund policy works in.
      amountUsd: expectedUsd,
      ...settled,
      unverifiedReason:
        `order was charged in ${event.currency} and carries no USD payout figure; ` +
        `amount not verified against the ${expectedUsd} USD ${plan} plan price`,
    };
  }
  if (paidUsd < floor) {
    return {
      kind: 'rejected',
      reason: `order is worth ${paidUsd} USD, below the ${expectedUsd} USD ${plan} plan price`,
    };
  }
  return {
    kind: 'accepted',
    amountUsd: paidUsd,
    ...settled,
    unverifiedReason: catalogueMismatchReason(amounts.netPaidUsd, expectedUsd, plan),
  };
}

/**
 * A discounted order, judged on what is left after the discount.
 *
 * The charged figure may not stand in for it here: tax is added after the
 * deduction, so a large enough VAT lifts a heavily discounted order back over
 * the tariff while the seller was paid far less. Only `netPaid` — list minus
 * discount, tax excluded — states what the buyer actually paid for the plan, and
 * an order that cannot express it in USD is refused rather than granted as
 * "unverified": that combination is exactly where a real shortfall hides.
 */
function resolveDiscountedOrder(
  amounts: OrderAmounts,
  event: OrderCompletedEvent,
  floor: number,
  expectedUsd: number,
  plan: PaidPlan,
  settled: { readonly settledAmount: number; readonly settledCurrency: string },
): OrderAmountVerdict {
  const discount = `a ${amounts.discount} ${event.currency} discount`;
  if (amounts.netPaidUsd === null) {
    return {
      kind: 'rejected',
      reason:
        `order carries ${discount} and no USD payout figure, so what is left of it cannot be ` +
        `verified against the ${expectedUsd} USD ${plan} plan price`,
    };
  }
  if (amounts.netPaidUsd < floor) {
    return {
      kind: 'rejected',
      reason:
        `order is worth ${amounts.netPaidUsd} USD after ${discount}, ` +
        `below the ${expectedUsd} USD ${plan} plan price`,
    };
  }
  return {
    kind: 'accepted',
    amountUsd: amounts.chargedUsd ?? amounts.netPaidUsd,
    ...settled,
    unverifiedReason:
      `order carries ${discount}; the ${amounts.netPaidUsd} USD left after it still covers ` +
      `the ${expectedUsd} USD ${plan} plan price`,
  };
}

/**
 * The order on every basis the checks need, taken only from fields FastSpring
 * documents.
 *
 * The item figures are preferred over the order ones because a store may add
 * items of its own; the order total is used for the charged figure only when the
 * order contains nothing but the item we sold, since tax is not reported per item
 * and cannot be split out of a mixed order.
 */
function readOrderAmounts(event: OrderCompletedEvent, item: FastSpringOrderItem): OrderAmounts {
  const list = item.subtotal ?? event.subtotal ?? event.total;
  const discount = resolveDiscount(event, item);
  const netPaid = cents(list - discount);
  const singleItem = isSingleItemOrder(event);
  const charged = singleItem ? event.total : netPaid;
  const listUsd = usdOf(event, item.subtotalInPayoutCurrency, event.subtotalInPayoutCurrency, list);
  const discountUsd = usdDiscount(event, item, discount);
  const netPaidUsd = listUsd === null || discountUsd === null ? null : cents(listUsd - discountUsd);
  return {
    list,
    discount,
    netPaid,
    charged,
    listWithTax: singleItem ? cents(charged + discount) : list,
    netPaidUsd,
    chargedUsd: usdCharged(event, charged, netPaidUsd),
  };
}

function isDiscounted(amounts: OrderAmounts): boolean {
  return amounts.discount > EXACT_TOLERANCE;
}

function isSingleItemOrder(event: OrderCompletedEvent): boolean {
  return event.items.length === 1;
}

/**
 * What was deducted from the list price, in the buyer's currency.
 *
 * The item and order fields should agree for a single-item order; the larger is
 * taken so a store that fills only one of them still refuses the order. A store
 * that fills neither is not taken at its word either: FastSpring's own identity
 * is `total = subtotal - discount + tax`, so whatever the tax does not account
 * for was deducted. A payload with no tax field can only understate the result
 * (the missing tax makes the difference negative, which floors at zero), so a
 * missing field never invents a discount that is not there.
 */
function resolveDiscount(event: OrderCompletedEvent, item: FastSpringOrderItem): number {
  const reported = Math.max(item.discount ?? 0, event.discount ?? 0);
  return Math.max(0, reported, derivedDiscount(event));
}

/**
 * The deduction the order's own arithmetic implies. Only computed for an order
 * that contains nothing but the item we sold: in a mixed order the difference
 * may belong to a line we did not sell.
 */
function derivedDiscount(event: OrderCompletedEvent): number {
  if (!isSingleItemOrder(event) || event.subtotal === null) {
    return 0;
  }
  return cents(event.subtotal + (event.tax ?? 0) - event.total);
}

/** Currency amounts are cents; the arithmetic must not accumulate FP noise. */
function cents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A buyer-currency figure expressed in USD, or null when the payload expresses
 * none. An order already charged in USD needs no conversion; anything else needs
 * FastSpring to be paid out in USD and to report the converted figure.
 */
function usdOf(
  event: OrderCompletedEvent,
  itemFigure: number | null,
  orderFigure: number | null,
  inBuyerCurrency: number,
): number | null {
  if (event.currency === 'USD') {
    return inBuyerCurrency;
  }
  if (event.payoutCurrency !== 'USD') {
    return null;
  }
  return itemFigure ?? orderFigure;
}

/**
 * The discount in USD. A zero discount converts to zero without needing a payout
 * figure; a real one that FastSpring did not convert leaves the net figure
 * unknown, which the discounted branch treats as a refusal rather than a grant.
 */
function usdDiscount(
  event: OrderCompletedEvent,
  item: FastSpringOrderItem,
  discount: number,
): number | null {
  if (discount <= EXACT_TOLERANCE) {
    return 0;
  }
  return usdOf(event, item.discountInPayoutCurrency, event.discountInPayoutCurrency, discount);
}

/** What the buyer was charged, in USD, or null when the payload expresses none. */
function usdCharged(
  event: OrderCompletedEvent,
  charged: number,
  netPaidUsd: number | null,
): number | null {
  if (event.currency === 'USD') {
    return charged;
  }
  if (event.payoutCurrency !== 'USD' || !isSingleItemOrder(event)) {
    return netPaidUsd;
  }
  return event.totalInPayoutCurrency ?? netPaidUsd;
}

/**
 * Whether the quote is consistent with this order. The band runs from what the
 * buyer paid before tax to the list price with the order's tax on top, so
 * anything the store's tax mode or a catalogue discount can explain is inside
 * it — and a second unit, a foreign order or a charge for a different product
 * is not.
 */
function quoteFitsOrder(quoted: number, amounts: OrderAmounts): boolean {
  return (
    quoted >= amounts.netPaid - EXACT_TOLERANCE && quoted <= amounts.listWithTax + EXACT_TOLERANCE
  );
}

function describeQuoteMismatch(quoted: number, amounts: OrderAmounts): string {
  const charged = amounts.charged > amounts.netPaid ? ` (${amounts.charged} charged with tax)` : '';
  return `order amount ${amounts.netPaid}${charged} does not match the quoted ${quoted}`;
}

/**
 * A catalogue entry priced above the tariff. Measured on what was paid before
 * tax, so a taxed order — which is charged more than the tariff in a net-priced
 * store by construction — is not reported as a mismatch every single time.
 */
function catalogueMismatchReason(
  netPaidUsd: number | null,
  expectedUsd: number,
  plan: PaidPlan,
): string | null {
  if (netPaidUsd === null || netPaidUsd <= expectedUsd + EXACT_TOLERANCE) {
    return null;
  }
  // Worth more than the plan costs: the buyer keeps what they paid for, but the
  // catalogue entry disagrees with the tariff and an operator has to see that.
  return (
    `order is worth ${netPaidUsd} USD before tax, above the ${expectedUsd} USD ${plan} plan ` +
    'price; the FastSpring catalogue price does not match the tariff'
  );
}
