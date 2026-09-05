import { describe, expect, it } from 'vitest';

import { REQUIRED_PRODUCTION_SECRETS, validateRuntimeConfig } from './config.ts';

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
