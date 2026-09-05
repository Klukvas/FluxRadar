import { describe, expect, it } from 'vitest';

import { REQUIRED_PRODUCTION_SECRETS, validateRuntimeConfig } from './config.ts';

const completeProductionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@db:5432/fluxradar',
  PADDLE_WEBHOOK_SECRET: 'paddle-secret',
  INTEGRATION_ENCRYPTION_KEY: 'dedicated-key',
  RESEND_API_KEY: 'resend-test-key',
  RESEND_FROM_EMAIL: 'FluxRadar <noreply@example.com>',
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
      INTEGRATION_ENCRYPTION_KEY: 'dedicated-key',
      RESEND_API_KEY: 'resend-test-key',
    });
    expect(message).toContain('RESEND_FROM_EMAIL');
    expect(message).not.toContain('RESEND_API_KEY');
    expect(message).not.toContain('DATABASE_URL');
  });

  it('never puts a secret value in the error message', () => {
    const message = messageFrom({
      NODE_ENV: 'production',
      INTEGRATION_ENCRYPTION_KEY: 'super-secret-value',
    });
    expect(message).toContain('RESEND_API_KEY');
    expect(message).not.toContain('super-secret-value');
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
