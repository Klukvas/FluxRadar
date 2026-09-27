import type { Purchase } from '@prisma/client';

// The one basis every provider's refund is measured on, and the sum that decides
// whether the money is back.
//
// A purchase records two figures: `amountUsd`, the USD-normalised charge the
// refund policy works in, and `settledAmount` / `settledCurrency`, what the buyer
// was actually charged when the provider localised the currency. A refund is
// quoted in the currency the buyer was charged in, so the comparison that decides
// whether the money is back is stated on the CHARGED basis — `settledAmount` when
// there is one, `amountUsd` otherwise — and every provider converts its lines onto
// that basis before they are summed here. Mixing the two bases is what would let
// a tax-only refund of a net-priced order look like a full one, or a full refund
// of a localised order look partial.
//
// Provider-neutral by construction: nothing here reads a payload. Each provider
// module (fastspring/refund-amounts.ts, creem/refund-line.ts) states what ONE of
// its refunds is worth on this basis; this module only says what the purchase
// was charged and what everything returned so far adds up to.

/**
 * A return covering at least this share of the charge is treated as full.
 *
 * Not 1.0, and deliberately not configurable. The two figures being compared
 * travel through different roundings — the provider rounds the localised charge
 * to the buyer's currency, the refund to the same, and the cumulative sum here to
 * cents — so an exact equality test would leave a genuinely full refund a cent
 * short and hand the buyer a readable report. One percent of the smallest plan
 * ($55) is 55 cents, far above any rounding this arithmetic can produce and far
 * below any partial refund a seller would actually issue. Widening it would start
 * suspending real partial refunds; narrowing it would start missing full ones,
 * which is the failure that costs money.
 */
export const FULL_REFUND_RATIO = 0.99;

/** What the purchase was charged, on the one basis every refund is measured in. */
export interface ChargeBasis {
  /** What the buyer was charged, in `currency`. */
  readonly total: number;
  readonly currency: string;
  /** The same charge, USD-normalised (`Purchase.amountUsd`). */
  readonly totalUsd: number;
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

export function cumulativeRefund(
  totals: { readonly amountCharged: number | null; readonly amountUsd: number | null },
  basis: ChargeBasis,
): CumulativeRefund {
  const amountCharged = roundCents(totals.amountCharged ?? 0);
  const share = basis.total > 0 ? Math.min(1, Math.max(0, amountCharged / basis.total)) : 1;
  return {
    amountCharged,
    amountUsd: roundCents(totals.amountUsd ?? 0),
    share,
    isFull: share >= FULL_REFUND_RATIO,
  };
}

/** Currency amounts are cents; the arithmetic must not accumulate FP noise. */
export function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}
