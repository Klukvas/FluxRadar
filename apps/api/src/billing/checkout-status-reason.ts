import { CHECKOUT_SESSION_STATUSES } from './constants.ts';
import { CHECKOUT_STATUS_REASONS } from './checkout-lifecycle.ts';

// What a buyer is told about a checkout that produced no scan.
//
// `CheckoutSession.statusReason` is written for us, not for them: it quotes
// order amounts, product paths, currency policy variable names and the internal
// vocabulary of the webhook handler ("checkout reference does not belong to this
// environment"). Putting that string on a browser-facing response tells anyone
// holding a reference how the validation is structured and what it compares,
// which is exactly the map an attacker probing the checkout would ask for — and
// it means nothing to the buyer who reads it.
//
// The API answers with one of a closed set of codes instead. The UI turns the
// code into a localised sentence; the raw reason stays in the database, on the
// `CheckoutSession` and on the `WebhookEvent` beside the stored payload, where
// support and reconciliation need it.

export const CHECKOUT_REASON_CODES = {
  /** The deadline passed with no payment; nothing was charged for this session. */
  expired: 'checkout_expired',
  /** The provider never opened a checkout, so no payment could have been taken. */
  providerUnavailable: 'provider_unavailable',
  /** A payment arrived that could not be verified against this checkout. */
  paymentNotVerified: 'payment_not_verified',
} as const;

export type CheckoutReasonCode = (typeof CHECKOUT_REASON_CODES)[keyof typeof CHECKOUT_REASON_CODES];

const CODE_BY_REASON: Readonly<Record<string, CheckoutReasonCode>> = {
  [CHECKOUT_STATUS_REASONS.abandoned]: CHECKOUT_REASON_CODES.expired,
  [CHECKOUT_STATUS_REASONS.providerUnavailable]: CHECKOUT_REASON_CODES.providerUnavailable,
};

/**
 * The safe code for a checkout the buyer is looking at.
 *
 * Only a rejection needs explaining. A completed session already gave the buyer
 * the scan, and its reason — when it has one — is a reconciliation note about
 * the amount, not something the buyer can act on. An unrecognised rejection
 * reason maps to the generic code rather than leaking itself, so a reason added
 * later cannot reach the browser by being forgotten here.
 */
export function checkoutReasonCode(
  status: string,
  statusReason: string | null,
): CheckoutReasonCode | null {
  if (status !== CHECKOUT_SESSION_STATUSES.rejected || statusReason === null) {
    return null;
  }
  return CODE_BY_REASON[statusReason] ?? CHECKOUT_REASON_CODES.paymentNotVerified;
}
