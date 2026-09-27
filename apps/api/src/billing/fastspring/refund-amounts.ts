import {
  FULL_REFUND_RATIO,
  chargeBasisOf,
  cumulativeRefund,
  roundCents as cents,
  type ChargeBasis,
  type CumulativeRefund,
} from '../refund-basis.ts';
import type { ReturnCreatedEvent } from './events.ts';

// The basis itself — what the purchase was charged, the full-refund ratio and
// the cumulative sum — is provider-neutral and lives in billing/refund-basis.ts.
// It is re-exported here so every FastSpring caller keeps one import.
export {
  FULL_REFUND_RATIO,
  chargeBasisOf,
  cumulativeRefund,
  type ChargeBasis,
  type CumulativeRefund,
};

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
// fail-closed branch above by design.

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

/** One return, expressed on the charge basis and in USD. */
export interface ReturnLine {
  readonly amountCharged: number;
  readonly amountUsd: number;
  readonly currency: string;
  /** Set whenever the figures needed more than reading the payload. */
  readonly reason: string | null;
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
