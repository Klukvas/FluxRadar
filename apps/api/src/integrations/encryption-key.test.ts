// The integration encryption key policy.
//
// This key is the only thing between a database dump and every customer's
// Google/Bing OAuth tokens, so the two ways of getting it wrong are asserted
// here rather than discovered in production:
//
//   * production silently deriving it from SESSION_SECRET, which ties every
//     stored token's lifetime to a secret that is rotated for other reasons;
//   * production being handed a copy of SESSION_SECRET under the right variable
//     name, which passes a presence check and reintroduces the same coupling.
//
// Both must fail the boot, by variable name, with no value anywhere in the text.

import { describe, expect, it } from 'vitest';

import {
  INTEGRATION_ENCRYPTION_KEY_VAR,
  SESSION_SECRET_VAR,
  readIntegrationEncryptionKey,
} from './encryption-key.ts';
import { validateRuntimeConfig } from './config.ts';

const SHARED_SECRET = 'the-same-secret-in-both-variables';

const productionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@db:5432/fluxradar',
} satisfies NodeJS.ProcessEnv;

function bootMessage(env: NodeJS.ProcessEnv): string {
  try {
    validateRuntimeConfig(env);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return '';
}

describe('integration encryption key', () => {
  it('uses the dedicated key when it is stated', () => {
    expect(
      readIntegrationEncryptionKey({
        NODE_ENV: 'production',
        [INTEGRATION_ENCRYPTION_KEY_VAR]: 'dedicated-key',
      }),
    ).toEqual({ state: 'configured', secret: 'dedicated-key' });
  });

  it('has no production fallback to the session secret', () => {
    const result = readIntegrationEncryptionKey({
      NODE_ENV: 'production',
      [SESSION_SECRET_VAR]: SHARED_SECRET,
    });

    expect(result.state).toBe('invalid');
    if (result.state !== 'invalid') return;
    expect(result.missing).toEqual([INTEGRATION_ENCRYPTION_KEY_VAR]);
    expect(result.reason).not.toContain(SHARED_SECRET);
  });

  // An unset NODE_ENV inside a container is a production process that lost its
  // label, not a developer checkout. It must not unlock the fallback.
  it('gives an unlabelled environment no fallback either', () => {
    expect(readIntegrationEncryptionKey({ [SESSION_SECRET_VAR]: SHARED_SECRET }).state).toBe(
      'invalid',
    );
  });

  it('refuses a production key that is a copy of the session secret', () => {
    const result = readIntegrationEncryptionKey({
      NODE_ENV: 'production',
      [INTEGRATION_ENCRYPTION_KEY_VAR]: SHARED_SECRET,
      [SESSION_SECRET_VAR]: SHARED_SECRET,
    });

    expect(result.state).toBe('invalid');
    if (result.state !== 'invalid') return;
    expect(result.reason).toContain(INTEGRATION_ENCRYPTION_KEY_VAR);
    expect(result.reason).toContain(SESSION_SECRET_VAR);
    expect(result.reason).not.toContain(SHARED_SECRET);
  });

  it('accepts a production key that merely coexists with a session secret', () => {
    expect(
      readIntegrationEncryptionKey({
        NODE_ENV: 'production',
        [INTEGRATION_ENCRYPTION_KEY_VAR]: 'dedicated-key',
        [SESSION_SECRET_VAR]: SHARED_SECRET,
      }),
    ).toEqual({ state: 'configured', secret: 'dedicated-key' });
  });

  it('keeps the explicit development and test fallback', () => {
    for (const NODE_ENV of ['development', 'test']) {
      expect(readIntegrationEncryptionKey({ NODE_ENV, [SESSION_SECRET_VAR]: 'local' })).toEqual({
        state: 'configured',
        secret: 'local',
      });
    }
  });

  // Locally the two variables being equal is the documented default, and must
  // stay usable: the rule is about production, not about a checkout.
  it('leaves development alone when both variables hold the same value', () => {
    expect(
      readIntegrationEncryptionKey({
        NODE_ENV: 'development',
        [INTEGRATION_ENCRYPTION_KEY_VAR]: SHARED_SECRET,
        [SESSION_SECRET_VAR]: SHARED_SECRET,
      }).state,
    ).toBe('configured');
  });

  it('treats a whitespace-only key as absent', () => {
    expect(
      readIntegrationEncryptionKey({
        NODE_ENV: 'production',
        [INTEGRATION_ENCRYPTION_KEY_VAR]: '   ',
      }).state,
    ).toBe('invalid');
  });
});

describe('production boot on the integration encryption key', () => {
  it('refuses to start when it is a copy of the session secret', () => {
    const message = bootMessage({
      ...productionEnv,
      [INTEGRATION_ENCRYPTION_KEY_VAR]: SHARED_SECRET,
      [SESSION_SECRET_VAR]: SHARED_SECRET,
    });

    expect(message).toContain(INTEGRATION_ENCRYPTION_KEY_VAR);
    expect(message).toContain(SESSION_SECRET_VAR);
    expect(message).not.toContain(SHARED_SECRET);
  });

  it('starts when the two are different', () => {
    expect(
      bootMessage({
        ...productionEnv,
        [INTEGRATION_ENCRYPTION_KEY_VAR]: 'a-dedicated-production-key',
        [SESSION_SECRET_VAR]: SHARED_SECRET,
      }),
    ).toBe('');
  });

  it('still names the variable when it is absent altogether', () => {
    expect(bootMessage(productionEnv)).toContain(INTEGRATION_ENCRYPTION_KEY_VAR);
  });
});
