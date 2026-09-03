import { createHmac, timingSafeEqual } from 'node:crypto';

// MockPaddle webhook signing (D-029): HMAC-SHA256 over the *raw* body bytes,
// hex-encoded. Verification is timing-safe.

export function getPaddleWebhookSecret(): string {
  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('PADDLE_WEBHOOK_SECRET is not configured');
  }
  return secret;
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
