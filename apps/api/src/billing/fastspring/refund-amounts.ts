import type { Purchase } from '@prisma/client';

import type { ReturnCreatedEvent } from './events.ts';

// What one FastSpring return is worth, and what everything returned so far adds
// up to.
//
// ONE BASIS, STATED ONCE. A purchase records two figures: `amountUsd`, the
// USD-normalised charge the refund policy works in, and `settledAmount` /
// `settledCurrency`, what the buyer was actually charged when FastSpring
// localised the currency. A return is quoted in the currency the buyer was
// charged in, so the comparison that decides whether the money is back is stated
// on the CHARGED basis — `settledAmount` when there is one, `amountUsd`
// otherwise — and every line is converted onto that basis before it is summed.
// Mixing the two bases is what would let a tax-only refund of a net-priced order
// look like a full one, or a full refund of a localised order look partial.
//
// FAIL CLOSED. Where the payload does not let a return be measured — no amount at
// all, a currency the purchase was not charged in and no USD figure to convert
// through — the line is counted as the WHOLE charge and the reason is stored on
// it. The two failure directions are not comparable: an over-counted refund
// suspends a report an operator can restore, while an under-counted one leaves a
// buyer reading a report whose money is already back.
//
// ONE EXCHANGE RATE, AND IT IS THE STORE'S. Nothing in this repository fetches
// FX rates, and it must not start: a rate read at refund time is not the rate the
// charge was settled at, and a wrong one silently moves the suspend decision. The
// only rate that exists here is the one FastSpring itself states on the payload —
// the order's USD payout figure against the same order's charged figure — and it
// exists only for a store paid out in USD (`CONVERTIBLE_PAYOUT_CURRENCY`). That
// is a property of the FastSpring store, confirmed by the operator through
// FASTSPRING_STORE_VERIFIED, not something this code can detect; a store paid out
// in anything else states no rate at all, and its cross-currency returns take the
// fail-closed branch above by design. See docs/FASTSPRING.md §4.

/**
 * A return covering at least this share of the charge is treated as full.
 *
 * Not 1.0, and deliberately not configurable. The two figures being compared
 * travel through different roundings — FastSpring rounds the localised charge to
 * the buyer's currency, the refund to the same, and the cumulative sum here to
 * cents — so an exact equality test would leave a genuinely full refund a cent
 * short and hand the buyer a readable report. One percent of the smallest plan
 * ($55) is 55 cents, far above any rounding this arithmetic can produce and far
 * below any partial refund a seller would actually issue. Widening it would start
 * suspending real partial refunds; narrowing it would start missing full ones,
 * which is the failure that costs money.
 */
export const FULL_REFUND_RATIO = 0.99;

/**
 * The payout currency whose figures can convert a foreign-currency return onto
 * the charged basis.
 *
 * FluxRadar prices in USD: the §18 tariff is USD and `Purchase.amountUsd` is the
 * USD normalisation every refund decision is anchored to. So the only conversion
 * this code can perform is "what share of the order's own USD value is this
 * return's USD value", which needs FastSpring to have stated both — and it states
 * them only when the store is paid out in USD. A return quoted in a currency the
 * purchase was not charged in, from a store paid out in EUR, carries a figure in
 * EUR that no rate here can place on the charge; it is counted as the whole charge
 * rather than guessed at.
 */
export const CONVERTIBLE_PAYOUT_CURRENCY = 'USD';

/** What the purchase was charged, on the one basis every return is measured in. */
export interface ChargeBasis {
  /** What the buyer was charged, in `currency`. */
  readonly total: number;
  readonly currency: string;
  /** The same charge, USD-normalised (`Purchase.amountUsd`). */
  readonly totalUsd: number;
}

/** One return, expressed on the charge basis and in USD. */
export interface ReturnLine {
  readonly amountCharged: number;
  readonly amountUsd: number;
  readonly currency: string;
  /** Set whenever the figures needed more than reading the payload. */
  readonly reason: string | null;
}

/** Everything returned against a purchase so far. */
export interface CumulativeRefund {
  readonly amountCharged: number;
  readonly amountUsd: number;
  /** Share of the charge that is back, capped at 1. */
  readonly share: number;
  readonly isFull: boolean;
}

export function chargeBasisOf(
  purchase: Pick<Purchase, 'amountUsd' | 'currency' | 'settledAmount' | 'settledCurrency'>,
): ChargeBasis {
  return {
    total: purchase.settledAmount ?? purchase.amountUsd,
    currency: purchase.settledCurrency ?? purchase.currency,
    totalUsd: purchase.amountUsd,
  };
}

export function resolveReturnLine(event: ReturnCreatedEvent, basis: ChargeBasis): ReturnLine {
  if (event.totalReturn === null) {
    return whole(basis, 'return.created states no amount, so it returns the whole charge');
  }
  if (basis.total <= 0) {
    return whole(basis, 'purchase records no usable charged amount to measure the return against');
  }
  if (event.currency === null || event.currency === basis.currency) {
    const amountCharged = cents(event.totalReturn);
    return {
      amountCharged,
      amountUsd: usdOf(event, amountCharged, basis),
      currency: basis.currency,
      reason:
        event.currency === null
          ? `return.created states no currency; read as ${basis.currency}, the charged currency`
          : null,
    };
  }

  // A return quoted in another currency than the charge can still be measured
  // when FastSpring converted it: the order's own USD figures give the rate.
  const usd = usdReturn(event);
  if (usd !== null && basis.totalUsd > 0) {
    return {
      amountCharged: cents((basis.total * usd) / basis.totalUsd),
      amountUsd: cents(usd),
      currency: basis.currency,
      reason:
        `return quoted in ${event.currency} against a charge in ${basis.currency}; ` +
        `converted through the order's ${basis.totalUsd} USD payout figure`,
    };
  }
  return whole(
    basis,
    `return quoted in ${event.currency} against a charge in ${basis.currency} and the payload ` +
      'carries no USD figure to convert it, so it is counted as the whole charge',
  );
}

export function cumulativeRefund(
  totals: { readonly amountCharged: number | null; readonly amountUsd: number | null },
  basis: ChargeBasis,
): CumulativeRefund {
  const amountCharged = cents(totals.amountCharged ?? 0);
  const share = basis.total > 0 ? Math.min(1, Math.max(0, amountCharged / basis.total)) : 1;
  return {
    amountCharged,
    amountUsd: cents(totals.amountUsd ?? 0),
    share,
    isFull: share >= FULL_REFUND_RATIO,
  };
}

/** The whole charge came back — or could not be measured, which counts the same. */
function whole(basis: ChargeBasis, reason: string): ReturnLine {
  return {
    amountCharged: cents(basis.total),
    amountUsd: cents(basis.totalUsd),
    currency: basis.currency,
    reason,
  };
}

/**
 * The return in USD: FastSpring's own figure when the store is paid out in USD,
 * the charged figure itself when the charge was already in USD, and otherwise the
 * same share of the purchase's USD value that it is of the charge.
 */
function usdOf(event: ReturnCreatedEvent, amountCharged: number, basis: ChargeBasis): number {
  const reported = usdReturn(event);
  if (reported !== null) {
    return cents(reported);
  }
  if (basis.currency === CONVERTIBLE_PAYOUT_CURRENCY || basis.total <= 0) {
    return cents(amountCharged);
  }
  return cents((basis.totalUsd * amountCharged) / basis.total);
}

/**
 * FastSpring's own USD figure for the return.
 *
 * The payout currency is checked, never assumed: `totalReturnInPayoutCurrency` is
 * stated in whatever currency the store is paid out in, so reading it without the
 * check would treat a EUR figure as a USD one — a silent 8-15% error in the share
 * that decides whether a report stays readable.
 */
function usdReturn(event: ReturnCreatedEvent): number | null {
  return event.payoutCurrency === CONVERTIBLE_PAYOUT_CURRENCY
    ? event.totalReturnInPayoutCurrency
    : null;
}

/** Currency amounts are cents; the arithmetic must not accumulate FP noise. */
function cents(value: number): number {
  return Math.round(value * 100) / 100;
}
