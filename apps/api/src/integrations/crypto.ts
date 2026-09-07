import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { readIntegrationEncryptionKey } from './encryption-key.ts';

const ENCRYPTED_PREFIX = 'v1';

/**
 * Derives the stable 256-bit key.
 *
 * Which secret is acceptable is decided in one place (`encryption-key.ts`), and
 * production has no fallback: `validateRuntimeConfig` fails the boot on the same
 * reader, so reaching the throw here means the process was started around that
 * check rather than through it.
 */
function encryptionKey(): Buffer {
  const result = readIntegrationEncryptionKey();
  if (result.state === 'invalid') {
    throw new Error(result.reason);
  }
  return createHash('sha256').update(result.secret, 'utf8').digest();
}

export function encryptIntegrationSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENCRYPTED_PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function decryptIntegrationSecret(value: string): string {
  const [prefix, ivValue, tagValue, ciphertextValue] = value.split(':');
  if (prefix !== ENCRYPTED_PREFIX || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error('invalid encrypted integration secret');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivValue, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function hashOAuthState(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
