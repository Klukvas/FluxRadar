import { afterEach, describe, expect, it } from 'vitest';

import { decryptIntegrationSecret, encryptIntegrationSecret, hashOAuthState } from './crypto.ts';

const previousSecret = process.env.INTEGRATION_ENCRYPTION_KEY;

afterEach(() => {
  if (previousSecret === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
  else process.env.INTEGRATION_ENCRYPTION_KEY = previousSecret;
});

describe('integration secret encryption', () => {
  it('round-trips a token and does not persist it as plaintext', () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = 'test-integration-key';
    const encrypted = encryptIntegrationSecret('oauth-access-token');
    expect(encrypted).not.toContain('oauth-access-token');
    expect(decryptIntegrationSecret(encrypted)).toBe('oauth-access-token');
  });

  it('hashes OAuth state deterministically', () => {
    expect(hashOAuthState('state')).toBe(hashOAuthState('state'));
    expect(hashOAuthState('state')).not.toBe(hashOAuthState('other-state'));
  });
});
