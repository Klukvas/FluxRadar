import { createHmac, timingSafeEqual } from 'node:crypto';

// FastSpring message security: the X-FS-Signature header carries the base64
// encoding of HMAC-SHA256 over the *raw* request body, keyed with the webhook
// secret configured in the FastSpring app. The bytes on the wire are hashed
// directly — re-serialising the JSON would change them and break verification.

export const FASTSPRING_SIGNATURE_HEADER = 'x-fs-signature';

export function signFastSpringWebhook(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(toBytes(rawBody)).digest('base64');
}

/**
 * Timing-safe comparison. A length mismatch is rejected before timingSafeEqual
 * (which throws on unequal lengths) and leaks nothing beyond the public digest
 * length.
 */
export function verifyFastSpringSignature(
  rawBody: Buffer | string,
  signature: string,
  secret: string,
): boolean {
  if (signature === '') {
    return false;
  }
  const expected = Buffer.from(signFastSpringWebhook(rawBody, secret), 'utf8');
  const provided = Buffer.from(signature, 'utf8');
  if (provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(provided, expected);
}

function toBytes(rawBody: Buffer | string): Buffer {
  return Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
}
