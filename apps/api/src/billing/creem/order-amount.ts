import type { CheckoutSession } from '@prisma/client';

import { planPriceUsd, type PaidPlan } from '../plans.ts';
import { roundCents } from '../refund-basis.ts';
import type { CreemCheckoutCompletedEvent } from './events.ts';

// What a completed Creem order is allowed to have charged.
//
// Two independent things are checked, and only one of them is the price:
//
//   * the order must be the order we opened — the product id on it is checked
//     by the webhook handler against the session, before this runs;
//   * the order must be worth the plan, measured against `planPriceUsd(plan)`.
//
// The second check is what the Creem catalogue may never stand in for. A product
// priced at $1 by mistake (or by someone with access to the dashboard) produces
// a $1 charge that Creem reports faithfully. Access to a plan is therefore
// granted against the USD tariff this repository owns, never against the number
// the provider sent back. Same policy as FastSpring's order-amount.ts, on
// Creem's own fields.
//
// THE FIGURES CREEM STATES, ALL IN CENTS (docs.creem.io — Webhooks, the order
// object on checkout.completed / dispute.created):
//
//   amount       the product's list price
//   sub_total    the price after a discount, before tax
//   tax_amount   the tax on the order
//   amount_due   what was charged: sub_total + tax_amount in exclusive tax mode,
//   amount_paid  sub_total with the tax already inside in inclusive tax mode
//
// and the product itself states which tax mode applies (`product.tax_mode`).
// So the two figures that describe the payment are:
//
//   charged       = amount_paid ?? amount_due ?? amount     tax included
//   worthBeforeTax = charged - tax_amount                    tax excluded
//
// TAX. In exclusive mode the buyer pays the tariff PLUS tax, so `worthBeforeTax`
// is the tariff and decides. In inclusive mode the buyer pays exactly the
// tariff with the tax folded in, so `worthBeforeTax` is BELOW the tariff for an
// order paid in full — and only `charged` can say the plan was paid for. Which
// one is compared is therefore stated per order, on the mode the product
// reports, rather than picked once for the store.
//
// DISCOUNTS. A coupon lowers `sub_total` while `amount` stays the list price,
// so the list price is never read as the payment of a discounted order: an
// order that says it carries a discount (a discount object, a discount id, a
// `discount_amount`, or a sub-total below the list price) is measured on the
// charge Creem states for it — `amount_paid` or `amount_due` — and REFUSED when
// the payload states neither. Creem's own webhook example nests an order with
// nothing but `amount`, and a buyer can type a coupon on the hosted page
// without this side ever knowing, so "no post-discount figure" is exactly where
// a real shortfall hides (the same rule FastSpring's order-amount.ts applies to
// a discount it cannot express in USD). An order that only reaches the tariff
// once tax is counted is worth the plan ONLY if nothing was discounted off it:
// in inclusive mode a discounted order's `charged` is already short, and in
// exclusive mode a large enough tax would otherwise lift a heavily discounted
// order back over the tariff while the seller was paid far less.
//
// The policy is deliberately asymmetric, because the two failure directions are
// not comparable: an underpaid order that is honoured hands out a paid plan for
// nothing, while an order refused after the buyer was charged leaves a real
// charge with nothing to show for it and needs a manual refund. So:
//
//   * below the plan price   -> always rejected, in every branch;
//   * above the plan price   -> granted, and recorded as a catalogue mismatch;
//   * not stated in USD      -> granted, and recorded as unverified — unless the
//                               order was discounted, which is the one case where
//                               "unverified" would be covering for a real
//                               shortfall. Never silently: the reason reaches
//                               WebhookEvent.outcomeReason and
//                               CheckoutSession.statusReason.
//
// Creem products are created in USD for FluxRadar (see .env.example); a
// product priced in another currency is an operator mistake this code grants
// through and flags rather than refuses after the card was charged.

/** Same-currency comparisons are exact to the cent. */
const EXACT_TOLERANCE = 0.01;

const USD = 'USD';

export type CreemOrderAmountVerdict =
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

/** The order's money in dollars, on both tax bases. */
interface OrderAmounts {
  /** What the buyer was charged, tax included. */
  readonly charged: number;
  /** The same charge with the order's tax taken out. */
  readonly worthBeforeTax: number;
  readonly discounted: boolean;
  /** What the discount took off, in dollars, when the payload states it. */
  readonly discount: number | null;
  readonly currency: string;
}

/** Why the order's money cannot be read at all; the order is refused, not guessed. */
interface UnreadableAmounts {
  readonly unreadable: string;
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

export function resolveCreemOrderAmount(
  session: CheckoutSession,
  event: CreemCheckoutCompletedEvent,
  plan: PaidPlan,
): CreemOrderAmountVerdict {
  const amounts = readOrderAmounts(event);
  if ('unreadable' in amounts) {
    return { kind: 'rejected', reason: amounts.unreadable };
  }
  const expectedUsd = requiredUsd(session, plan);
  const settled = { settledAmount: amounts.charged, settledCurrency: amounts.currency } as const;

  if (amounts.currency !== USD) {
    if (amounts.discounted) {
      return {
        kind: 'rejected',
        reason:
          `order was charged in ${amounts.currency} and carries a discount, so what is left of ` +
          `it cannot be verified against the ${expectedUsd} USD ${plan} plan price`,
      };
    }
    return {
      kind: 'accepted',
      // Nothing here can convert the charge, so the plan price stays the USD
      // reference the refund policy works in.
      amountUsd: expectedUsd,
      ...settled,
      unverifiedReason:
        `order was charged in ${amounts.currency}; amount not verified against the ` +
        `${expectedUsd} USD ${plan} plan price (Creem products are expected to be priced in USD)`,
    };
  }

  const floor = expectedUsd - EXACT_TOLERANCE;
  if (amounts.worthBeforeTax >= floor) {
    return {
      kind: 'accepted',
      amountUsd: amounts.charged,
      unverifiedReason: joinReasons(
        // A discount that still leaves the tariff covered is granted, and said
        // out loud: an operator has to see that a coupon was used on a product
        // this repository asks to keep coupon-free.
        discountReason(amounts, expectedUsd, plan),
        catalogueMismatchReason(amounts.worthBeforeTax, expectedUsd, plan),
      ),
      ...settled,
    };
  }
  // Only reaches the tariff once tax is counted: an inclusive-tax order paid in
  // full looks exactly like this, and a discounted one must not.
  if (amounts.charged >= floor && !amounts.discounted) {
    return {
      kind: 'accepted',
      amountUsd: amounts.charged,
      unverifiedReason: null,
      ...settled,
    };
  }
  const discount = amounts.discounted ? ' after a discount' : '';
  return {
    kind: 'rejected',
    reason:
      `order is worth ${amounts.worthBeforeTax} USD before tax (${amounts.charged} USD charged)` +
      `${discount}, below the ${expectedUsd} USD ${plan} plan price`,
  };
}

/**
 * The order in dollars, taken only from fields Creem documents. An order nobody
 * can measure is refused, never granted as "unverified": a payload that states
 * no amount at all, and a discounted payload that states no post-discount
 * charge.
 */
function readOrderAmounts(event: CreemCheckoutCompletedEvent): OrderAmounts | UnreadableAmounts {
  // A discount is what the checkout says it carried, or what the arithmetic
  // shows: a sub-total below the list price is a deduction whether or not the
  // payload names it. A payload that states neither figure cannot invent one.
  const derivedDiscount =
    event.amount !== null && event.subTotal !== null && event.subTotal < event.amount;
  const discounted = event.hasDiscount || derivedDiscount;
  const paidCents = event.amountPaid ?? event.amountDue;
  // Only an undiscounted order may be read off its list price: there the list
  // price IS what was paid. A discounted one has to state what was charged.
  const chargedCents = paidCents ?? (discounted ? null : (event.subTotal ?? event.amount));
  if (chargedCents === null) {
    return {
      unreadable: discounted
        ? 'order carries a discount and states no post-discount charge (amount_paid or ' +
          'amount_due), so what was paid cannot be verified against the tariff'
        : 'checkout.completed payload states no order amount',
    };
  }
  const charged = dollars(chargedCents);
  const tax = dollars(event.taxAmount ?? 0);
  return {
    charged,
    worthBeforeTax: roundCents(Math.max(0, charged - tax)),
    discounted,
    discount: readDiscount(event),
    currency: (event.currency ?? USD).toUpperCase(),
  };
}

/** What the discount took off, in dollars: the stated figure, else the arithmetic. */
function readDiscount(event: CreemCheckoutCompletedEvent): number | null {
  if (event.discountAmount !== null && event.discountAmount > 0) {
    return dollars(event.discountAmount);
  }
  if (event.amount !== null && event.subTotal !== null && event.subTotal < event.amount) {
    return dollars(event.amount - event.subTotal);
  }
  return null;
}

/** Says that a coupon was used, and that the remainder still covers the plan. */
function discountReason(amounts: OrderAmounts, expectedUsd: number, plan: PaidPlan): string | null {
  if (!amounts.discounted) {
    return null;
  }
  const taken = amounts.discount === null ? 'a discount' : `a ${amounts.discount} USD discount`;
  return (
    `order carries ${taken}; the ${amounts.worthBeforeTax} USD paid before tax still covers ` +
    `the ${expectedUsd} USD ${plan} plan price`
  );
}

function joinReasons(...reasons: readonly (string | null)[]): string | null {
  const stated = reasons.filter((reason): reason is string => reason !== null);
  return stated.length === 0 ? null : stated.join('; ');
}

/** Cents, as Creem states every amount, into the dollars billing works in. */
function dollars(cents: number): number {
  return roundCents(cents / 100);
}

/**
 * A catalogue entry priced above the tariff. Measured on what was paid before
 * tax, so an exclusive-tax order — which is charged more than the tariff by
 * construction — is not reported as a mismatch every single time.
 */
function catalogueMismatchReason(
  worthBeforeTax: number,
  expectedUsd: number,
  plan: PaidPlan,
): string | null {
  if (worthBeforeTax <= expectedUsd + EXACT_TOLERANCE) {
    return null;
  }
  // Worth more than the plan costs: the buyer keeps what they paid for, but the
  // catalogue entry disagrees with the tariff and an operator has to see that.
  return (
    `order is worth ${worthBeforeTax} USD before tax, above the ${expectedUsd} USD ${plan} plan ` +
    'price; the Creem product price does not match the tariff'
  );
}
