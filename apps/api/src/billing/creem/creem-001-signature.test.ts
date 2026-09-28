import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { signCreemWebhook, verifyCreemSignature } from './signature.ts';

// CREEM-001: creem-signature is hex(HMAC-SHA256(raw body, secret)).
// The bytes on the wire are signed, so any re-serialisation must fail.

const SECRET = 'test-creem-webhook-secret';
const BODY = JSON.stringify({
  id: 'evt_1',
  eventType: 'checkout.completed',
  created_at: 1767225600000,
  object: { id: 'ch_1' },
});

describe('CREEM-001 webhook signature', () => {
  it('produces the hex digest Creem documents', () => {
    const expected = createHmac('sha256', SECRET).update(BODY, 'utf8').digest('hex');
    expect(signCreemWebhook(BODY, SECRET)).toBe(expected);
    // hex, not base64: 64 lowercase hex characters.
    expect(signCreemWebhook(BODY, SECRET)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts a matching signature over the exact bytes, as Buffer or string', () => {
    const signature = signCreemWebhook(BODY, SECRET);
    expect(verifyCreemSignature(BODY, signature, SECRET)).toBe(true);
    expect(verifyCreemSignature(Buffer.from(BODY, 'utf8'), signature, SECRET)).toBe(true);
    expect(signCreemWebhook(Buffer.from(BODY, 'utf8'), SECRET)).toBe(signature);
  });

  it('rejects a tampered body, a foreign secret, an empty and a wrong-length signature', () => {
    const signature = signCreemWebhook(BODY, SECRET);
    expect(verifyCreemSignature(`${BODY} `, signature, SECRET)).toBe(false);
    expect(verifyCreemSignature(BODY, signature, 'other-secret')).toBe(false);
    expect(verifyCreemSignature(BODY, '', SECRET)).toBe(false);
    expect(verifyCreemSignature(BODY, 'short', SECRET)).toBe(false);
    expect(verifyCreemSignature(BODY, `${signature}extra`, SECRET)).toBe(false);
  });

  it('rejects a same-length signature that differs in one character', () => {
    const signature = signCreemWebhook(BODY, SECRET);
    const flipped = `${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}`;
    expect(flipped).toHaveLength(signature.length);
    expect(verifyCreemSignature(BODY, flipped, SECRET)).toBe(false);
  });

  // Hex is case-insensitive: a dashboard or a proxy that upper-cases the
  // header must not turn a genuine delivery into a 400.
  it('accepts the digest in upper case and with surrounding whitespace', () => {
    const signature = signCreemWebhook(BODY, SECRET);
    expect(verifyCreemSignature(BODY, signature.toUpperCase(), SECRET)).toBe(true);
    expect(verifyCreemSignature(BODY, ` ${signature} `, SECRET)).toBe(true);
  });

  it('rejects whitespace-equivalent JSON: the signature covers bytes, not values', () => {
    const reserialised = JSON.stringify(JSON.parse(BODY) as unknown, null, 2);
    expect(verifyCreemSignature(reserialised, signCreemWebhook(BODY, SECRET), SECRET)).toBe(false);
  });
});
