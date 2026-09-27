import { createHmac, timingSafeEqual } from 'node:crypto';

// Creem webhook security: the `creem-signature` header carries the HEX encoding
// of HMAC-SHA256 over the *raw* request body, keyed with the webhook secret from
// Developers → Webhooks in the Creem dashboard (docs.creem.io — Webhooks, "How
// to verify Creem signature"). The bytes on the wire are hashed directly —
// re-serialising the JSON would change them and break verification.

export const CREEM_SIGNATURE_HEADER = 'creem-signature';

export function signCreemWebhook(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(toBytes(rawBody)).digest('hex');
}

/**
 * Timing-safe comparison. A length mismatch is rejected before timingSafeEqual
 * (which throws on unequal lengths) and leaks nothing beyond the public digest
 * length. Hex is case-insensitive, so a header in upper case still verifies.
 */
export function verifyCreemSignature(
  rawBody: Buffer | string,
  signature: string,
  secret: string,
): boolean {
  if (signature === '') {
    return false;
  }
  const expected = Buffer.from(signCreemWebhook(rawBody, secret), 'utf8');
  const provided = Buffer.from(signature.trim().toLowerCase(), 'utf8');
  if (provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(provided, expected);
}

function toBytes(rawBody: Buffer | string): Buffer {
  return Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
}
