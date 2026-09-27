import { describe, expect, it } from 'vitest';

import {
  CHECKOUT_PROVIDER_ENV,
  CHECKOUT_PROVIDER_NAMES,
  resolveCheckoutProvider,
} from './checkout-provider.ts';
import { readCreemConfig, type CreemConfigResult } from './creem/config.ts';
import { readFastSpringConfig, type FastSpringConfigResult } from './fastspring/config.ts';

// Which provider opens NEW checkouts when a deployment can have two configured.
// Nothing is guessed: one configured provider sells by itself, two need
// FLUXRADAR_CHECKOUT_PROVIDER to say which, and the variable can only name a
// provider that is actually configured.

const FASTSPRING_CONFIGURED = readFastSpringConfig({
  FASTSPRING_MODE: 'test',
  FASTSPRING_API_USERNAME: 'api-user',
  FASTSPRING_API_PASSWORD: 'api-password-value',
  FASTSPRING_WEBHOOK_SECRET: 'fastspring-webhook-secret-value',
  FASTSPRING_STOREFRONT_URL: 'https://fluxradar.test.onfastspring.com',
  FASTSPRING_PRODUCT_PATH_BASIC: 'fluxradar-basic-scan',
  FASTSPRING_PRODUCT_PATH_COMPLETE: 'fluxradar-complete-scan',
});

const CREEM_CONFIGURED = readCreemConfig({
  CREEM_MODE: 'test',
  CREEM_API_KEY: 'creem-api-key-value',
  CREEM_WEBHOOK_SECRET: 'creem-webhook-secret-value',
  CREEM_PRODUCT_ID_BASIC: 'prod_basic',
  CREEM_PRODUCT_ID_COMPLETE: 'prod_complete',
  FRONTEND_ORIGIN: 'http://localhost:5174',
});

const FASTSPRING_OFF: FastSpringConfigResult = { state: 'not_configured' };
const CREEM_OFF: CreemConfigResult = { state: 'not_configured' };

const FASTSPRING_INVALID: FastSpringConfigResult = {
  state: 'invalid',
  missing: ['FASTSPRING_WEBHOOK_SECRET'],
  reason: 'FastSpring is partially configured; missing: FASTSPRING_WEBHOOK_SECRET',
};
const CREEM_INVALID: CreemConfigResult = {
  state: 'invalid',
  missing: ['CREEM_WEBHOOK_SECRET'],
  reason: 'Creem is partially configured; missing: CREEM_WEBHOOK_SECRET',
};

describe('resolveCheckoutProvider', () => {
  it('lists the two provider names the variable may carry', () => {
    expect(CHECKOUT_PROVIDER_NAMES).toEqual(['fastspring', 'creem']);
    expect(CHECKOUT_PROVIDER_ENV).toBe('FLUXRADAR_CHECKOUT_PROVIDER');
  });

  it('reports none when neither provider is configured and nothing is requested', () => {
    expect(resolveCheckoutProvider(FASTSPRING_OFF, CREEM_OFF, {})).toEqual({ state: 'none' });
    expect(
      resolveCheckoutProvider(FASTSPRING_OFF, CREEM_OFF, { [CHECKOUT_PROVIDER_ENV]: '' }),
    ).toEqual({ state: 'none' });
    expect(
      resolveCheckoutProvider(FASTSPRING_OFF, CREEM_OFF, { [CHECKOUT_PROVIDER_ENV]: '   ' }),
    ).toEqual({ state: 'none' });
  });

  it('sells through the one provider that is configured, named or not', () => {
    expect(resolveCheckoutProvider(FASTSPRING_CONFIGURED, CREEM_OFF, {})).toEqual({
      state: 'selected',
      provider: 'fastspring',
    });
    expect(resolveCheckoutProvider(FASTSPRING_OFF, CREEM_CONFIGURED, {})).toEqual({
      state: 'selected',
      provider: 'creem',
    });
    expect(
      resolveCheckoutProvider(FASTSPRING_OFF, CREEM_CONFIGURED, {
        [CHECKOUT_PROVIDER_ENV]: 'creem',
      }),
    ).toEqual({ state: 'selected', provider: 'creem' });
    expect(
      resolveCheckoutProvider(FASTSPRING_CONFIGURED, CREEM_OFF, {
        [CHECKOUT_PROVIDER_ENV]: 'fastspring',
      }),
    ).toEqual({ state: 'selected', provider: 'fastspring' });
  });

  it('refuses two configured providers until the variable names one', () => {
    const both = resolveCheckoutProvider(FASTSPRING_CONFIGURED, CREEM_CONFIGURED, {});
    expect(both.state).toBe('invalid');
    if (both.state !== 'invalid') return;
    expect(both.reason).toContain(CHECKOUT_PROVIDER_ENV);
    expect(both.reason).toContain('both FastSpring and Creem are configured');

    expect(
      resolveCheckoutProvider(FASTSPRING_CONFIGURED, CREEM_CONFIGURED, {
        [CHECKOUT_PROVIDER_ENV]: 'creem',
      }),
    ).toEqual({ state: 'selected', provider: 'creem' });
    expect(
      resolveCheckoutProvider(FASTSPRING_CONFIGURED, CREEM_CONFIGURED, {
        [CHECKOUT_PROVIDER_ENV]: 'fastspring',
      }),
    ).toEqual({ state: 'selected', provider: 'fastspring' });
  });

  it('trims the variable before reading it', () => {
    expect(
      resolveCheckoutProvider(FASTSPRING_CONFIGURED, CREEM_CONFIGURED, {
        [CHECKOUT_PROVIDER_ENV]: '  creem ',
      }),
    ).toEqual({ state: 'selected', provider: 'creem' });
  });

  it('refuses a variable naming a provider that is not configured', () => {
    const creemRequested = resolveCheckoutProvider(FASTSPRING_CONFIGURED, CREEM_OFF, {
      [CHECKOUT_PROVIDER_ENV]: 'creem',
    });
    expect(creemRequested).toMatchObject({ state: 'invalid' });
    if (creemRequested.state === 'invalid') {
      expect(creemRequested.reason).toContain(`${CHECKOUT_PROVIDER_ENV}=creem`);
      expect(creemRequested.reason).toContain('not configured');
    }
    expect(
      resolveCheckoutProvider(FASTSPRING_OFF, CREEM_CONFIGURED, {
        [CHECKOUT_PROVIDER_ENV]: 'fastspring',
      }),
    ).toMatchObject({ state: 'invalid' });
    // Nothing configured at all, but something asked for: still an operator
    // error rather than a silent "off".
    expect(
      resolveCheckoutProvider(FASTSPRING_OFF, CREEM_OFF, { [CHECKOUT_PROVIDER_ENV]: 'creem' }),
    ).toMatchObject({ state: 'invalid' });
  });

  it('refuses a variable that names no known provider, whatever is configured', () => {
    for (const value of ['paddle', 'Creem', 'CREEM', 'fast-spring']) {
      const result = resolveCheckoutProvider(FASTSPRING_CONFIGURED, CREEM_CONFIGURED, {
        [CHECKOUT_PROVIDER_ENV]: value,
      });
      expect(result.state, value).toBe('invalid');
      if (result.state !== 'invalid') continue;
      expect(result.reason).toContain(`${CHECKOUT_PROVIDER_ENV} must be one of fastspring, creem`);
    }
    expect(
      resolveCheckoutProvider(FASTSPRING_OFF, CREEM_OFF, { [CHECKOUT_PROVIDER_ENV]: 'paddle' }),
    ).toMatchObject({ state: 'invalid' });
  });

  // A provider whose own reader says `invalid` already fails the boot with the
  // missing names; this must not add a second, vaguer reason on top, and it
  // must not count as a configured provider either.
  it('treats a partially configured provider as not configured', () => {
    expect(resolveCheckoutProvider(FASTSPRING_INVALID, CREEM_CONFIGURED, {})).toEqual({
      state: 'selected',
      provider: 'creem',
    });
    expect(resolveCheckoutProvider(FASTSPRING_CONFIGURED, CREEM_INVALID, {})).toEqual({
      state: 'selected',
      provider: 'fastspring',
    });
    expect(resolveCheckoutProvider(FASTSPRING_INVALID, CREEM_INVALID, {})).toEqual({
      state: 'none',
    });
    expect(
      resolveCheckoutProvider(FASTSPRING_INVALID, CREEM_CONFIGURED, {
        [CHECKOUT_PROVIDER_ENV]: 'fastspring',
      }),
    ).toMatchObject({ state: 'invalid' });
  });

  it('reads process.env when no environment is passed', () => {
    const previous = process.env[CHECKOUT_PROVIDER_ENV];
    try {
      process.env[CHECKOUT_PROVIDER_ENV] = 'creem';
      expect(resolveCheckoutProvider(FASTSPRING_CONFIGURED, CREEM_CONFIGURED)).toEqual({
        state: 'selected',
        provider: 'creem',
      });
      delete process.env[CHECKOUT_PROVIDER_ENV];
      expect(resolveCheckoutProvider(FASTSPRING_CONFIGURED, CREEM_CONFIGURED).state).toBe(
        'invalid',
      );
    } finally {
      if (previous === undefined) {
        delete process.env[CHECKOUT_PROVIDER_ENV];
      } else {
        process.env[CHECKOUT_PROVIDER_ENV] = previous;
      }
    }
  });
});
