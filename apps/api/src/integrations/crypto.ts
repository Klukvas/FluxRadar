import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ENCRYPTED_PREFIX = 'v1';

/** Derives a stable 256-bit key without persisting a second secret. */
function encryptionKey(): Buffer {
  const dedicated = process.env.INTEGRATION_ENCRYPTION_KEY?.trim();
  const developmentOrTest =
    process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
  const secret = dedicated || (developmentOrTest ? process.env.SESSION_SECRET?.trim() : undefined);
  if (!secret) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY is not configured');
  }
  return createHash('sha256').update(secret, 'utf8').digest();
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
