import { roundCents, type ChargeBasis } from '../refund-basis.ts';
import type { CreemRefundCreatedEvent } from './events.ts';

// What one Creem refund is worth on the purchase's charged basis.
//
// The basis, the full-refund ratio and the cumulative sum are shared with every
// provider (billing/refund-basis.ts); this module only reads Creem's own fields.
// `refund.created` states `refund_amount` in cents in `refund_currency`, which
// is the currency the buyer was charged in — Creem refunds in the order's own
// currency — so the ordinary case is a same-currency figure read straight onto
// the basis.
//
// FAIL CLOSED. Where the payload does not let a refund be measured — no amount
// at all, or a currency the purchase was not charged in — the line is counted as
// the WHOLE charge and the reason is stored on it. The two failure directions are
// not comparable: an over-counted refund suspends a report an operator can
// restore, while an under-counted one leaves a buyer reading a report whose
// money is already back. Nothing here fetches an exchange rate, and it must not
// start: a rate read at refund time is not the rate the charge was settled at.

/** One refund, expressed on the charge basis and in USD. */
export interface CreemRefundLine {
  readonly amountCharged: number;
  readonly amountUsd: number;
  readonly currency: string;
  /** Set whenever the figures needed more than reading the payload. */
  readonly reason: string | null;
}

export function resolveCreemRefundLine(
  event: CreemRefundCreatedEvent,
  basis: ChargeBasis,
): CreemRefundLine {
  if (event.refundAmount === null) {
    return whole(basis, 'refund.created states no amount, so it returns the whole charge');
  }
  if (basis.total <= 0) {
    return whole(basis, 'purchase records no usable charged amount to measure the refund against');
  }
  const currency = event.refundCurrency?.toUpperCase() ?? null;
  if (currency === null || currency === basis.currency.toUpperCase()) {
    const amountCharged = roundCents(event.refundAmount / 100);
    return {
      amountCharged,
      amountUsd: usdOf(amountCharged, basis),
      currency: basis.currency,
      reason:
        currency === null
          ? `refund.created states no currency; read as ${basis.currency}, the charged currency`
          : null,
    };
  }
  return whole(
    basis,
    `refund quoted in ${currency} against a charge in ${basis.currency}, which cannot be ` +
      'converted here, so it is counted as the whole charge',
  );
}

/** The whole charge came back — or could not be measured, which counts the same. */
function whole(basis: ChargeBasis, reason: string): CreemRefundLine {
  return {
    amountCharged: roundCents(basis.total),
    amountUsd: roundCents(basis.totalUsd),
    currency: basis.currency,
    reason,
  };
}

/**
 * The refund in USD: the charged figure itself when the charge was in USD, and
 * otherwise the same share of the purchase's USD value that it is of the charge.
 */
function usdOf(amountCharged: number, basis: ChargeBasis): number {
  if (basis.currency.toUpperCase() === 'USD' || basis.total <= 0) {
    return roundCents(amountCharged);
  }
  return roundCents((basis.totalUsd * amountCharged) / basis.total);
}
