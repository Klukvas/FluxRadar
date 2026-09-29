import { describe, expect, it } from 'vitest';

import { validateRuntimeConfig } from '../../integrations/config.ts';
import {
  CREEM_ENV_VARS,
  CREEM_STORE_VERIFIED_VALUE,
  FRONTEND_ORIGIN_ENV,
  OPTIONAL_CREEM_ENV_VARS,
  creemPlanForProductId,
  isCreemPlanPurchasable,
  readCreemConfig,
} from './config.ts';

// CREEM-002: configuration is fail-closed. Nothing set at all means paid
// checkout through Creem is simply off; a half-set environment is an operator
// error that must stop a production boot, and no value may ever reach an error
// message. The return URL is derived from FRONTEND_ORIGIN unless stated, and
// live mode insists on https for it.

const COMPLETE_ENV = {
  CREEM_MODE: 'test',
  CREEM_API_KEY: 'creem-api-key-value',
  CREEM_WEBHOOK_SECRET: 'webhook-secret-value',
  CREEM_PRODUCT_ID_BASIC: 'prod_basic',
  CREEM_PRODUCT_ID_COMPLETE: 'prod_complete',
  FRONTEND_ORIGIN: 'http://localhost:5174',
} satisfies NodeJS.ProcessEnv;

const LIVE_ENV = {
  ...COMPLETE_ENV,
  CREEM_MODE: 'live',
  CREEM_STORE_VERIFIED: CREEM_STORE_VERIFIED_VALUE,
  FRONTEND_ORIGIN: 'https://fluxradar.net',
} satisfies NodeJS.ProcessEnv;

describe('CREEM-002 configuration', () => {
  it('reports not_configured when no CREEM_ variable is present', () => {
    expect(
      readCreemConfig({ DATABASE_URL: 'postgresql://x', FRONTEND_ORIGIN: 'http://localhost' }),
    ).toEqual({ state: 'not_configured' });
  });

  it('reads a complete test-mode configuration and derives the return URL', () => {
    const result = readCreemConfig(COMPLETE_ENV);
    expect(result.state).toBe('configured');
    if (result.state !== 'configured') return;
    expect(result.config.mode).toBe('test');
    expect(result.config.liveMode).toBe(false);
    expect(result.config.apiBaseUrl).toBe('https://test-api.creem.io');
    expect(result.config.apiKey).toBe('creem-api-key-value');
    expect(result.config.webhookSecret).toBe('webhook-secret-value');
    expect(result.config.productIds.Basic).toBe('prod_basic');
    expect(result.config.productIds.Complete).toBe('prod_complete');
    expect(result.config.returnUrl).toBe('http://localhost:5174/checkout/return');
  });

  it('strips a trailing slash off FRONTEND_ORIGIN before appending the return path', () => {
    const result = readCreemConfig({ ...COMPLETE_ENV, FRONTEND_ORIGIN: 'http://localhost:5174/' });
    expect(result.state).toBe('configured');
    if (result.state !== 'configured') return;
    expect(result.config.returnUrl).toBe('http://localhost:5174/checkout/return');
  });

  // Test mode and live mode are two separate Creem environments, so the mode
  // decides the API host rather than a flag on the request.
  it('addresses the live API in live mode and honours a stated base URL', () => {
    const live = readCreemConfig(LIVE_ENV);
    expect(live.state).toBe('configured');
    if (live.state !== 'configured') return;
    expect(live.config.liveMode).toBe(true);
    expect(live.config.apiBaseUrl).toBe('https://api.creem.io');
    expect(live.config.returnUrl).toBe('https://fluxradar.net/checkout/return');

    const overridden = readCreemConfig({
      ...COMPLETE_ENV,
      CREEM_API_BASE_URL: 'http://127.0.0.1:4010/',
    });
    expect(overridden.state).toBe('configured');
    if (overridden.state !== 'configured') return;
    expect(overridden.config.apiBaseUrl).toBe('http://127.0.0.1:4010');
  });

  // A plan whose product does not exist at the provider yet must not take the
  // deployment — or the plans that do exist — down with it.
  describe('an optional product id', () => {
    it('boots, and keeps selling the existing plans, without the Website Audit product', () => {
      const result = readCreemConfig(COMPLETE_ENV);
      expect(result.state).toBe('configured');
      if (result.state !== 'configured') return;
      expect(result.config.productIds.WebsiteAudit).toBeUndefined();
      expect(isCreemPlanPurchasable(result.config, 'Basic')).toBe(true);
      expect(isCreemPlanPurchasable(result.config, 'Complete')).toBe(true);
      expect(isCreemPlanPurchasable(result.config, 'WebsiteAudit')).toBe(false);
      expect(OPTIONAL_CREEM_ENV_VARS).toContain(CREEM_ENV_VARS.productIdWebsiteAudit);
      expect(OPTIONAL_CREEM_ENV_VARS).toContain(CREEM_ENV_VARS.returnUrl);
    });

    it('never resolves an unmapped plan from a foreign or empty product id', () => {
      const result = readCreemConfig(COMPLETE_ENV);
      if (result.state !== 'configured') throw new Error('expected a configured environment');
      // The bug this guards: `config.productIds.WebsiteAudit` is `undefined`,
      // and an order that names no product would match it by `=== undefined`.
      expect(creemPlanForProductId(result.config, '')).toBeNull();
      expect(creemPlanForProductId(result.config, '   ')).toBeNull();
      expect(creemPlanForProductId(result.config, 'prod_someone_elses')).toBeNull();
    });

    it('sells the plan once the product id is configured', () => {
      const result = readCreemConfig({
        ...COMPLETE_ENV,
        CREEM_PRODUCT_ID_WEBSITE_AUDIT: 'prod_website_audit',
      });
      expect(result.state).toBe('configured');
      if (result.state !== 'configured') return;
      expect(isCreemPlanPurchasable(result.config, 'WebsiteAudit')).toBe(true);
      expect(creemPlanForProductId(result.config, 'prod_website_audit')).toBe('WebsiteAudit');
    });

    it('still refuses a half-set environment that omits a required product', () => {
      const result = readCreemConfig({
        ...COMPLETE_ENV,
        CREEM_PRODUCT_ID_COMPLETE: '',
        CREEM_PRODUCT_ID_WEBSITE_AUDIT: 'prod_website_audit',
      });
      expect(result.state).toBe('invalid');
      if (result.state !== 'invalid') return;
      expect(result.missing).toEqual([CREEM_ENV_VARS.productIdComplete]);
    });
  });

  it('names every missing variable when the set is incomplete, and no values', () => {
    const result = readCreemConfig({
      CREEM_MODE: 'live',
      CREEM_API_KEY: 'creem-api-key-value',
      FRONTEND_ORIGIN: 'https://fluxradar.net',
    });
    expect(result.state).toBe('invalid');
    if (result.state !== 'invalid') return;
    expect(result.missing).toContain(CREEM_ENV_VARS.webhookSecret);
    expect(result.missing).toContain(CREEM_ENV_VARS.productIdBasic);
    expect(result.missing).toContain(CREEM_ENV_VARS.productIdComplete);
    expect(result.missing).not.toContain(CREEM_ENV_VARS.productIdWebsiteAudit);
    expect(result.missing).not.toContain(CREEM_ENV_VARS.returnUrl);
    expect(result.reason).not.toContain('creem-api-key-value');
    expect(result.reason).toContain(CREEM_ENV_VARS.webhookSecret);
  });

  it('rejects an unknown mode and names only the mode variable', () => {
    const result = readCreemConfig({ ...COMPLETE_ENV, CREEM_MODE: 'sandbox' });
    expect(result).toMatchObject({ state: 'invalid', missing: [CREEM_ENV_VARS.mode] });
    if (result.state !== 'invalid') return;
    expect(result.reason).not.toContain('creem-api-key-value');
    expect(result.reason).not.toContain('webhook-secret-value');
  });

  it('maps a product id back to its plan and refuses a foreign product', () => {
    const result = readCreemConfig(COMPLETE_ENV);
    if (result.state !== 'configured') throw new Error('expected a configured environment');
    expect(creemPlanForProductId(result.config, 'prod_basic')).toBe('Basic');
    expect(creemPlanForProductId(result.config, 'prod_complete')).toBe('Complete');
    expect(creemPlanForProductId(result.config, 'prod_someone_elses')).toBeNull();
  });

  // The live webhook endpoint, its events, its secret and the live product prices
  // all live in the Creem dashboard, where this process cannot see them. Live
  // mode therefore stays off until an operator states that they were checked.
  it('refuses live mode until the store has been verified, and names only the variable', () => {
    const unverified = { ...LIVE_ENV, CREEM_STORE_VERIFIED: '' } satisfies NodeJS.ProcessEnv;
    const result = readCreemConfig(unverified);
    expect(result.state).toBe('invalid');
    if (result.state !== 'invalid') return;
    expect(result.missing).toEqual([CREEM_ENV_VARS.storeVerified]);
    expect(result.reason).not.toContain('webhook-secret-value');
    expect(result.reason).not.toContain('creem-api-key-value');

    expect(readCreemConfig({ ...LIVE_ENV, CREEM_STORE_VERIFIED: 'maybe' }).state).toBe('invalid');
    expect(readCreemConfig(LIVE_ENV).state).toBe('configured');
    // Test mode never needs the confirmation.
    expect(readCreemConfig(COMPLETE_ENV).state).toBe('configured');
  });

  describe('the return URL', () => {
    // A payment return page on plain http would carry a checkout id and an
    // order id in the clear.
    it('refuses a plain-http return page in live mode and accepts it in test mode', () => {
      const liveHttp = readCreemConfig({ ...LIVE_ENV, FRONTEND_ORIGIN: 'http://fluxradar.net' });
      expect(liveHttp).toMatchObject({ state: 'invalid', missing: [CREEM_ENV_VARS.returnUrl] });
      if (liveHttp.state === 'invalid') {
        expect(liveHttp.reason).toContain('https');
      }
      expect(
        readCreemConfig({ ...COMPLETE_ENV, FRONTEND_ORIGIN: 'http://localhost:5174' }).state,
      ).toBe('configured');
    });

    it('takes a stated CREEM_RETURN_URL over the one derived from FRONTEND_ORIGIN', () => {
      const result = readCreemConfig({
        ...COMPLETE_ENV,
        CREEM_RETURN_URL: 'https://app.fluxradar.net/pay/back',
      });
      expect(result.state).toBe('configured');
      if (result.state !== 'configured') return;
      expect(result.config.returnUrl).toBe('https://app.fluxradar.net/pay/back');
    });

    it('refuses to boot with neither a return URL nor a frontend origin', () => {
      const result = readCreemConfig({ ...COMPLETE_ENV, FRONTEND_ORIGIN: '' });
      expect(result).toMatchObject({ state: 'invalid', missing: [CREEM_ENV_VARS.returnUrl] });
      if (result.state !== 'invalid') return;
      expect(result.reason).toContain(FRONTEND_ORIGIN_ENV);
      expect(result.reason).toContain(CREEM_ENV_VARS.returnUrl);
    });

    it('refuses a return URL that is not an absolute http(s) URL', () => {
      expect(
        readCreemConfig({ ...COMPLETE_ENV, CREEM_RETURN_URL: '/checkout/return' }),
      ).toMatchObject({ state: 'invalid', missing: [CREEM_ENV_VARS.returnUrl] });
      expect(readCreemConfig({ ...COMPLETE_ENV, FRONTEND_ORIGIN: 'localhost:5174' })).toMatchObject(
        {
          state: 'invalid',
          missing: [CREEM_ENV_VARS.returnUrl],
        },
      );
      expect(
        readCreemConfig({ ...COMPLETE_ENV, CREEM_RETURN_URL: 'ftp://fluxradar.net/return' }),
      ).toMatchObject({ state: 'invalid', missing: [CREEM_ENV_VARS.returnUrl] });
    });
  });

  describe('a production boot', () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@db:5432/fluxradar',
      INTEGRATION_ENCRYPTION_KEY: 'dedicated-key',
    } satisfies NodeJS.ProcessEnv;

    it('boots without Creem, and with a complete Creem, but not with a partial one', () => {
      expect(() => validateRuntimeConfig(base)).not.toThrow();
      expect(() => validateRuntimeConfig({ ...base, ...COMPLETE_ENV })).not.toThrow();
      expect(() =>
        validateRuntimeConfig({ ...base, CREEM_MODE: 'test', CREEM_API_KEY: 'k' }),
      ).toThrow(/CREEM_WEBHOOK_SECRET/);
      expect(() =>
        validateRuntimeConfig({ ...base, CREEM_MODE: 'test', CREEM_API_KEY: 'k' }),
      ).toThrow(/CREEM_PRODUCT_ID_BASIC/);
      // Unverified live mode is fatal for a production boot too, not just for the
      // HTTP layer: an unattended deploy must not switch real payments on.
      expect(() =>
        validateRuntimeConfig({ ...base, ...LIVE_ENV, CREEM_STORE_VERIFIED: '' }),
      ).toThrow(/CREEM_STORE_VERIFIED/);
    });
  });
});
