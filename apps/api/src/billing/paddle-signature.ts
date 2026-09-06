import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// LEGACY MockPaddle webhook signing (D-029): HMAC-SHA256 over the *raw* body
// bytes, hex-encoded. Verification is timing-safe. Production billing signs with
// FastSpring's base64 scheme instead — see billing/fastspring/signature.ts.

export function getPaddleWebhookSecret(): string {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('PADDLE_WEBHOOK_SECRET is not configured');
  }
  return secret;
}

/**
 * Startup variant. The MockPaddle route is not mounted in production, so an
 * absent secret there yields an unusable per-process value rather than blocking
 * the boot on a development-only setting.
 */
export function resolvePaddleWebhookSecret(): string {
  if (process.env.PADDLE_WEBHOOK_SECRET === undefined && process.env.NODE_ENV === 'production') {
    return randomBytes(32).toString('hex');
  }
  return getPaddleWebhookSecret();
}

export function signPaddleWebhook(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

export function verifyPaddleSignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(signPaddleWebhook(rawBody, secret), 'utf8');
  const provided = Buffer.from(signature, 'utf8');
  // timingSafeEqual throws on length mismatch; unequal length is already a reject
  // and leaks nothing beyond the (public) digest length.
  if (provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(provided, expected);
}
