import { describe, expect, it } from 'vitest';

import { validateRuntimeConfig } from './config.ts';

describe('runtime secret validation', () => {
  it('requires the dedicated integration key in production', () => {
    expect(() =>
      validateRuntimeConfig({ NODE_ENV: 'production', SESSION_SECRET: 'fallback' }),
    ).toThrow('INTEGRATION_ENCRYPTION_KEY is required in production');
  });

  it('allows the explicit development/test fallback', () => {
    expect(() =>
      validateRuntimeConfig({ NODE_ENV: 'development', SESSION_SECRET: 'local' }),
    ).not.toThrow();
    expect(() =>
      validateRuntimeConfig({ NODE_ENV: 'test', SESSION_SECRET: 'local' }),
    ).not.toThrow();
  });

  it('requires Resend sender configuration in production', () => {
    expect(() =>
      validateRuntimeConfig({
        NODE_ENV: 'production',
        INTEGRATION_ENCRYPTION_KEY: 'dedicated-key',
      }),
    ).toThrow('RESEND_API_KEY and RESEND_FROM_EMAIL are required in production');
    expect(() =>
      validateRuntimeConfig({
        NODE_ENV: 'production',
        INTEGRATION_ENCRYPTION_KEY: 'dedicated-key',
        RESEND_API_KEY: 'resend-test-key',
        RESEND_FROM_EMAIL: 'FluxRadar <noreply@example.com>',
      }),
    ).not.toThrow();
  });
});
