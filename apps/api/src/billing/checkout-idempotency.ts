// The per-draft idempotency contract for POST /billing/checkout-session.
//
// The browser mints one hex key per form draft and reuses it across retries of
// that draft; the server stores the key on the CheckoutSession row together
// with a hash of the request payload, and replays the stored checkout view when
// the same draft arrives again. This module holds the wire pieces of that
// contract — the header name, the key validation and the payload hash — so the
// route stays about HTTP and the session module stays about sessions.

import { createHash } from 'node:crypto';

import { validationError } from '../http/errors.ts';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/**
 * Hex keys only: the web client mints 16 random bytes as 32 lowercase hex
 * characters, and the range keeps older or foreign clients honest without
 * accepting free-form input that could collide with stored values.
 */
const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-fA-F]{16,64}$/;

/**
 * The key from the request header, or null when the client sent none.
 *
 * An absent or empty header means "no idempotency asked for" and keeps the
 * pre-contract behaviour; a present but malformed one is a client bug and is
 * refused loudly — silently dropping it would turn one checkout into two.
 */
export function readIdempotencyKey(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === '') return null;
  const trimmed = raw.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(trimmed)) {
    throw validationError('Idempotency-Key must be 16-64 hexadecimal characters');
  }
  return trimmed.toLowerCase();
}

/**
 * sha256 of the canonical JSON of the validated request payload.
 *
 * Canonical means key order cannot change the hash: the same draft serialized
 * by two bundle versions hashes identically, and any difference in what the
 * buyer is actually paying for — plan, scope, consent, the configuration
 * version — is a different hash by construction.
 */
export function checkoutRequestHash(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, sortKeys(entry)]),
    );
  }
  return value;
}
