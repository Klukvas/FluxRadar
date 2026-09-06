import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { signFastSpringWebhook, verifyFastSpringSignature } from './signature.ts';

// FASTSPRING-001: X-FS-Signature is base64(HMAC-SHA256(raw body, secret)).
// The bytes on the wire are signed, so any re-serialisation must fail.

const SECRET = 'test-fastspring-webhook-secret';
const BODY = JSON.stringify({ events: [{ id: 'evt_1', type: 'order.completed', data: {} }] });

describe('FASTSPRING-001 webhook signature', () => {
  it('produces the base64 digest FastSpring documents', () => {
    const expected = createHmac('sha256', SECRET).update(BODY, 'utf8').digest('base64');
    expect(signFastSpringWebhook(BODY, SECRET)).toBe(expected);
    // base64, not hex: a hex digest would be 64 lowercase characters.
    expect(signFastSpringWebhook(BODY, SECRET)).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(signFastSpringWebhook(BODY, SECRET)).not.toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts a matching signature over the exact bytes, as Buffer or string', () => {
    const signature = signFastSpringWebhook(BODY, SECRET);
    expect(verifyFastSpringSignature(BODY, signature, SECRET)).toBe(true);
    expect(verifyFastSpringSignature(Buffer.from(BODY, 'utf8'), signature, SECRET)).toBe(true);
  });

  it('rejects a tampered body, a foreign secret, an empty and a wrong-length signature', () => {
    const signature = signFastSpringWebhook(BODY, SECRET);
    expect(verifyFastSpringSignature(`${BODY} `, signature, SECRET)).toBe(false);
    expect(verifyFastSpringSignature(BODY, signature, 'other-secret')).toBe(false);
    expect(verifyFastSpringSignature(BODY, '', SECRET)).toBe(false);
    expect(verifyFastSpringSignature(BODY, 'short', SECRET)).toBe(false);
    expect(verifyFastSpringSignature(BODY, `${signature}extra`, SECRET)).toBe(false);
  });

  it('rejects whitespace-equivalent JSON: the signature covers bytes, not values', () => {
    const reserialised = JSON.stringify(JSON.parse(BODY) as unknown, null, 2);
    expect(
      verifyFastSpringSignature(reserialised, signFastSpringWebhook(BODY, SECRET), SECRET),
    ).toBe(false);
  });
});
