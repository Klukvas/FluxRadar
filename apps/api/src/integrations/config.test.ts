import { describe, expect, it } from 'vitest';

import { REQUIRED_PRODUCTION_SECRETS, validateRuntimeConfig } from './config.ts';
import { OAUTH_ENV_VARS } from './oauth-config.ts';
import { OBJECT_STORAGE_ENV_VARS } from './object-storage-config.ts';

const completeProductionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@db:5432/fluxradar',
  PADDLE_WEBHOOK_SECRET: 'paddle-secret',
  INTEGRATION_ENCRYPTION_KEY: 'dedicated-key',
} satisfies NodeJS.ProcessEnv;

function messageFrom(env: NodeJS.ProcessEnv): string {
  try {
    validateRuntimeConfig(env);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return '';
}

describe('runtime secret validation', () => {
  it('reports every missing required secret in production at once', () => {
    const message = messageFrom({ NODE_ENV: 'production' });
    for (const name of REQUIRED_PRODUCTION_SECRETS) {
      expect(message).toContain(name);
    }
  });

  it('names only the still-missing secret when the rest are present', () => {
    const message = messageFrom({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@db:5432/fluxradar',
      PADDLE_WEBHOOK_SECRET: 'paddle-secret',
    });
    expect(message).toContain('INTEGRATION_ENCRYPTION_KEY');
    expect(message).not.toContain('PADDLE_WEBHOOK_SECRET');
    expect(message).not.toContain('DATABASE_URL');
  });

  it('never puts a secret value in the error message', () => {
    const message = messageFrom({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@db:5432/fluxradar',
      PADDLE_WEBHOOK_SECRET: 'super-secret-value',
    });
    expect(message).toContain('INTEGRATION_ENCRYPTION_KEY');
    expect(message).not.toContain('super-secret-value');
  });

  it('treats Resend as optional and boots production without it', () => {
    expect(() => validateRuntimeConfig(completeProductionEnv)).not.toThrow();
    for (const name of REQUIRED_PRODUCTION_SECRETS) {
      expect(name).not.toMatch(/^RESEND_/);
    }
    expect(
      messageFrom({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@db:5432/fluxradar',
        PADDLE_WEBHOOK_SECRET: 'paddle-secret',
        INTEGRATION_ENCRYPTION_KEY: 'dedicated-key',
        // RESEND_API_KEY / RESEND_FROM_EMAIL intentionally absent.
      }),
    ).toBe('');
  });

  it('allows the explicit development/test fallback', () => {
    expect(() =>
      validateRuntimeConfig({ NODE_ENV: 'development', SESSION_SECRET: 'local' }),
    ).not.toThrow();
    expect(() =>
      validateRuntimeConfig({ NODE_ENV: 'test', SESSION_SECRET: 'local' }),
    ).not.toThrow();
  });

  it('passes when every required secret is present in production', () => {
    expect(() => validateRuntimeConfig(completeProductionEnv)).not.toThrow();
  });
});

describe('production fail-closed integration checks', () => {
  it('refuses to boot with OAuth credentials but no production callback', () => {
    const message = messageFrom({
      ...completeProductionEnv,
      [OAUTH_ENV_VARS.google.clientId]: 'client-id',
      [OAUTH_ENV_VARS.google.clientSecret]: 'client-secret',
    });

    expect(message).toContain(OAUTH_ENV_VARS.google.redirectUri);
    expect(message).not.toContain('client-secret');
  });

  it('refuses to boot with an OAuth callback on localhost', () => {
    const message = messageFrom({
      ...completeProductionEnv,
      [OAUTH_ENV_VARS.bing.clientId]: 'client-id',
      [OAUTH_ENV_VARS.bing.clientSecret]: 'client-secret',
      [OAUTH_ENV_VARS.bing.redirectUri]: 'http://localhost:3310/integrations/bing/callback',
    });

    expect(message).toContain(OAUTH_ENV_VARS.bing.redirectUri);
  });

  it('boots with a complete HTTPS OAuth configuration', () => {
    expect(
      messageFrom({
        ...completeProductionEnv,
        [OAUTH_ENV_VARS.google.clientId]: 'client-id',
        [OAUTH_ENV_VARS.google.clientSecret]: 'client-secret',
        [OAUTH_ENV_VARS.google.redirectUri]:
          'https://fluxradar.net/api/integrations/google/callback',
      }),
    ).toBe('');
  });

  it('refuses to boot with a half-configured object store', () => {
    const message = messageFrom({
      ...completeProductionEnv,
      [OBJECT_STORAGE_ENV_VARS.bucket]: 'fluxradar-reports',
      [OBJECT_STORAGE_ENV_VARS.accessKey]: 'super-secret-value',
    });

    expect(message).toContain(OBJECT_STORAGE_ENV_VARS.secretKey);
    expect(message).toContain(OBJECT_STORAGE_ENV_VARS.endpoint);
    expect(message).not.toContain('super-secret-value');
  });

  it('boots with no object store at all', () => {
    expect(messageFrom(completeProductionEnv)).toBe('');
  });

  it('refuses to boot on a retired Anthropic model once a key is present', () => {
    const message = messageFrom({
      ...completeProductionEnv,
      ANTHROPIC_API_KEY: 'super-secret-value',
      ANTHROPIC_MODEL: 'claude-sonnet-4',
    });

    expect(message).toContain('ANTHROPIC_MODEL');
    expect(message).toContain('claude-sonnet-5');
    expect(message).not.toContain('super-secret-value');
  });

  it('aggregates every misconfigured integration into one error', () => {
    const message = messageFrom({
      ...completeProductionEnv,
      [OAUTH_ENV_VARS.google.clientId]: 'client-id',
      [OBJECT_STORAGE_ENV_VARS.bucket]: 'fluxradar-reports',
    });

    expect(message).toContain(OAUTH_ENV_VARS.google.clientSecret);
    expect(message).toContain(OBJECT_STORAGE_ENV_VARS.endpoint);
  });
});
