import { describe, expect, it } from 'vitest';

import {
  FASTSPRING_ENV_VARS,
  FASTSPRING_STORE_VERIFIED_VALUE,
  planForProductPath,
  readFastSpringConfig,
} from './config.ts';
import { validateRuntimeConfig } from '../../integrations/config.ts';

// FASTSPRING-002: configuration is fail-closed. Nothing set at all means paid
// checkout is simply off; a half-set environment is an operator error that must
// stop a production boot, and no value may ever reach an error message.

const COMPLETE_ENV = {
  FASTSPRING_MODE: 'test',
  FASTSPRING_API_USERNAME: 'api-user',
  FASTSPRING_API_PASSWORD: 'api-password-value',
  FASTSPRING_WEBHOOK_SECRET: 'webhook-secret-value',
  FASTSPRING_STOREFRONT_URL: 'https://fluxradar.test.onfastspring.com/',
  FASTSPRING_PRODUCT_PATH_BASIC: 'fluxradar-basic-scan',
  FASTSPRING_PRODUCT_PATH_COMPLETE: 'fluxradar-complete-scan',
} satisfies NodeJS.ProcessEnv;

describe('FASTSPRING-002 configuration', () => {
  it('reports not_configured when no FASTSPRING_ variable is present', () => {
    expect(readFastSpringConfig({ DATABASE_URL: 'postgresql://x' })).toEqual({
      state: 'not_configured',
    });
  });

  it('reads a complete test-mode configuration and normalises the storefront URL', () => {
    const result = readFastSpringConfig(COMPLETE_ENV);
    expect(result.state).toBe('configured');
    if (result.state !== 'configured') return;
    expect(result.config.mode).toBe('test');
    expect(result.config.liveMode).toBe(false);
    expect(result.config.storefrontUrl).toBe('https://fluxradar.test.onfastspring.com');
    expect(result.config.apiBaseUrl).toBe('https://api.fastspring.com');
    expect(result.config.sessionApi).toBe('v1');
    expect(result.config.productPaths.Basic).toBe('fluxradar-basic-scan');
  });

  it('names every missing variable when the set is incomplete, and no values', () => {
    const result = readFastSpringConfig({
      FASTSPRING_MODE: 'live',
      FASTSPRING_API_USERNAME: 'api-user',
      FASTSPRING_API_PASSWORD: 'api-password-value',
    });
    expect(result.state).toBe('invalid');
    if (result.state !== 'invalid') return;
    expect(result.missing).toContain(FASTSPRING_ENV_VARS.webhookSecret);
    expect(result.missing).toContain(FASTSPRING_ENV_VARS.productPathBasic);
    expect(result.missing).toContain(FASTSPRING_ENV_VARS.productPathComplete);
    expect(result.missing).toContain(FASTSPRING_ENV_VARS.storefrontUrl);
    expect(result.reason).not.toContain('api-password-value');
    expect(result.reason).not.toContain('api-user');
  });

  it('rejects an unknown mode and an out-of-range session expiration', () => {
    expect(readFastSpringConfig({ ...COMPLETE_ENV, FASTSPRING_MODE: 'sandbox' }).state).toBe(
      'invalid',
    );
    expect(
      readFastSpringConfig({ ...COMPLETE_ENV, FASTSPRING_SESSION_EXPIRATION_DAYS: '30' }).state,
    ).toBe('invalid');
  });

  it('requires the checkout path for the v2 Sessions API, not the storefront URL', () => {
    const withoutStorefront = { ...COMPLETE_ENV, FASTSPRING_STOREFRONT_URL: '' };
    const missingPath = readFastSpringConfig({
      ...withoutStorefront,
      FASTSPRING_SESSION_API: 'v2',
    });
    expect(missingPath.state).toBe('invalid');
    if (missingPath.state === 'invalid') {
      expect(missingPath.missing).toContain(FASTSPRING_ENV_VARS.checkoutPath);
    }
    // FastSpring documents the checkout path as `{storeId}/{checkoutId}`; both
    // halves are URL path segments of the Sessions v2 endpoint.
    const withPath = readFastSpringConfig({
      ...withoutStorefront,
      FASTSPRING_SESSION_API: 'v2',
      FASTSPRING_CHECKOUT_PATH: 'fluxradar/web-checkout',
      FASTSPRING_POPUP_STOREFRONT: 'fluxradar.test.onfastspring.com/popup-checkout',
    });
    expect(withPath.state).toBe('configured');
    if (withPath.state === 'configured') {
      expect(withPath.config.checkoutPath).toBe('fluxradar/web-checkout');
    }
  });

  // A stray slash produces an empty URL path segment, and therefore a request
  // for a checkout that does not exist. Better refused at boot than at the first
  // buyer's click.
  it('refuses a checkout path with an empty segment', () => {
    for (const checkoutPath of ['/fluxradar/web-checkout', 'fluxradar/web-checkout/', 'a//b']) {
      const result = readFastSpringConfig({
        ...COMPLETE_ENV,
        FASTSPRING_STOREFRONT_URL: '',
        FASTSPRING_SESSION_API: 'v2',
        FASTSPRING_CHECKOUT_PATH: checkoutPath,
        FASTSPRING_POPUP_STOREFRONT: 'fluxradar.test.onfastspring.com/popup-checkout',
      });
      expect(result.state).toBe('invalid');
      if (result.state !== 'invalid') return;
      expect(result.missing).toContain(FASTSPRING_ENV_VARS.checkoutPath);
      expect(result.reason).toContain('{storeId}/{checkoutId}');
    }
  });

  it('maps a product path back to its plan and refuses a foreign product', () => {
    const result = readFastSpringConfig(COMPLETE_ENV);
    if (result.state !== 'configured') throw new Error('expected a configured environment');
    expect(planForProductPath(result.config, 'fluxradar-complete-scan')).toBe('Complete');
    expect(planForProductPath(result.config, 'someone-elses-product')).toBeNull();
  });

  it('defaults the currency policy to strict and rejects an unknown one', () => {
    const result = readFastSpringConfig(COMPLETE_ENV);
    expect(result.state).toBe('configured');
    if (result.state !== 'configured') return;
    expect(result.config.currencyPolicy).toBe('strict');

    const wrong = readFastSpringConfig({
      ...COMPLETE_ENV,
      FASTSPRING_CURRENCY_POLICY: 'whatever',
    });
    expect(wrong.state).toBe('invalid');
    if (wrong.state !== 'invalid') return;
    expect(wrong.missing).toContain(FASTSPRING_ENV_VARS.currencyPolicy);
  });

  // Two live-mode preconditions live in the FastSpring app, not here: order tags
  // must reach the webhook, and the storefront's currency behaviour must match
  // the configured policy. Neither is observable from this process, so live mode
  // stays off until an operator states that both were checked.
  it('refuses live mode until the store has been verified, and names only the variable', () => {
    const live = { ...COMPLETE_ENV, FASTSPRING_MODE: 'live' } satisfies NodeJS.ProcessEnv;
    const result = readFastSpringConfig(live);
    expect(result.state).toBe('invalid');
    if (result.state !== 'invalid') return;
    expect(result.missing).toEqual([FASTSPRING_ENV_VARS.storeVerified]);
    expect(result.reason).not.toContain('webhook-secret-value');
    expect(result.reason).not.toContain('api-password-value');

    expect(readFastSpringConfig({ ...live, FASTSPRING_STORE_VERIFIED: 'maybe' }).state).toBe(
      'invalid',
    );
    const verified = readFastSpringConfig({
      ...live,
      FASTSPRING_STORE_VERIFIED: FASTSPRING_STORE_VERIFIED_VALUE,
    });
    expect(verified.state).toBe('configured');
    // Test mode never needs the confirmation.
    expect(readFastSpringConfig(COMPLETE_ENV).state).toBe('configured');
  });

  it('lets production boot without FastSpring but not with a partial FastSpring', () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@db:5432/fluxradar',
      INTEGRATION_ENCRYPTION_KEY: 'dedicated-key',
    } satisfies NodeJS.ProcessEnv;
    expect(() => validateRuntimeConfig(base)).not.toThrow();
    expect(() => validateRuntimeConfig({ ...base, ...COMPLETE_ENV })).not.toThrow();
    expect(() =>
      validateRuntimeConfig({ ...base, FASTSPRING_MODE: 'live', FASTSPRING_API_USERNAME: 'u' }),
    ).toThrow(/FASTSPRING_WEBHOOK_SECRET/);
    // Unverified live mode is fatal for a production boot too, not just for the
    // HTTP layer: an unattended deploy must not switch real payments on.
    expect(() =>
      validateRuntimeConfig({ ...base, ...COMPLETE_ENV, FASTSPRING_MODE: 'live' }),
    ).toThrow(/FASTSPRING_STORE_VERIFIED/);
  });
});
