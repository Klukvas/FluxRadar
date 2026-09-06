import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../index.ts';
import { silentLogger } from '../../http/logger.ts';
import { createTestDb, TEST_WEBHOOK_SECRET, type TestDb } from '../../test-utils/test-db.ts';
import { FASTSPRING_ENV_VARS, readFastSpringConfig } from './config.ts';
import { TEST_FASTSPRING_SECRET } from './test-payloads.ts';

// FASTSPRING-017: the popup storefront.
//
// The browser opens FastSpring's popup checkout with the Store Builder Library,
// which needs one value we cannot derive from anything else: the `data-storefront`
// of the popup checkout configured in the FastSpring app. It is the origin the
// buyer types their card number into, so it is validated at boot rather than
// trusted, and it must agree with FASTSPRING_MODE — a session created in one mode
// can never be paid on the other mode's storefront.

const V2_ENV = {
  FASTSPRING_MODE: 'test',
  FASTSPRING_API_USERNAME: 'api-user',
  FASTSPRING_API_PASSWORD: 'api-password-value',
  FASTSPRING_WEBHOOK_SECRET: TEST_FASTSPRING_SECRET,
  FASTSPRING_SESSION_API: 'v2',
  FASTSPRING_CHECKOUT_PATH: 'fluxradar/popup-checkout',
  FASTSPRING_POPUP_STOREFRONT: 'fluxradar.test.onfastspring.com/popup-checkout',
  FASTSPRING_PRODUCT_PATH_BASIC: 'fluxradar-basic-scan',
  FASTSPRING_PRODUCT_PATH_COMPLETE: 'fluxradar-complete-scan',
} satisfies NodeJS.ProcessEnv;

const LIVE_ENV = {
  ...V2_ENV,
  FASTSPRING_MODE: 'live',
  FASTSPRING_STORE_VERIFIED: 'verified',
  FASTSPRING_POPUP_STOREFRONT: 'fluxradar.onfastspring.com/popup-checkout',
} satisfies NodeJS.ProcessEnv;

/** The reason a rejected storefront produced, or null when it was accepted. */
function rejection(env: NodeJS.ProcessEnv): string | null {
  const result = readFastSpringConfig(env);
  if (result.state !== 'invalid') return null;
  expect(result.missing).toContain(FASTSPRING_ENV_VARS.popupStorefront);
  return result.reason;
}

describe('FASTSPRING-017 popup storefront', () => {
  it('requires a popup storefront for the v2 Sessions API', () => {
    const result = readFastSpringConfig({ ...V2_ENV, FASTSPRING_POPUP_STOREFRONT: '' });

    expect(result.state).toBe('invalid');
    if (result.state !== 'invalid') return;
    expect(result.missing).toContain(FASTSPRING_ENV_VARS.popupStorefront);
  });

  it('accepts the value FastSpring prints in the popup checkout snippet', () => {
    const result = readFastSpringConfig(V2_ENV);

    expect(result.state).toBe('configured');
    if (result.state !== 'configured') return;
    expect(result.config.popupStorefront).toBe('fluxradar.test.onfastspring.com/popup-checkout');
  });

  it('lowercases the host and leaves the checkout path alone', () => {
    const result = readFastSpringConfig({
      ...V2_ENV,
      FASTSPRING_POPUP_STOREFRONT: 'FluxRadar.Test.OnFastSpring.com/Popup-Checkout',
    });

    expect(result.state).toBe('configured');
    if (result.state !== 'configured') return;
    // Hostnames are case-insensitive; a URL path segment is not.
    expect(result.config.popupStorefront).toBe('fluxradar.test.onfastspring.com/Popup-Checkout');
  });

  // Everything here would send a buyer somewhere other than our own FastSpring
  // checkout, so each one stops the boot instead of surfacing as a blank overlay.
  it('refuses anything that is not a FastSpring checkout', () => {
    expect(
      rejection({ ...V2_ENV, FASTSPRING_POPUP_STOREFRONT: 'checkout.evil.example/popup' }),
    ).toContain('.onfastspring.com');
    expect(
      rejection({
        ...V2_ENV,
        FASTSPRING_POPUP_STOREFRONT: 'fluxradar.test.onfastspring.com.evil.example/popup',
      }),
    ).toContain('.onfastspring.com');
    // The host alone is not a checkout — the SBL would have nothing to open.
    expect(
      rejection({ ...V2_ENV, FASTSPRING_POPUP_STOREFRONT: 'fluxradar.test.onfastspring.com' }),
    ).toContain('{store}.onfastspring.com/{checkout}');
    expect(
      rejection({
        ...V2_ENV,
        FASTSPRING_POPUP_STOREFRONT: 'https://fluxradar.test.onfastspring.com/popup',
      }),
    ).toContain('no https:// prefix');
    for (const stray of [
      'fluxradar.test.onfastspring.com//popup',
      'fluxradar.test.onfastspring.com/popup/',
      'fluxradar.test.onfastspring.com/popup?coupon=free',
    ]) {
      expect(rejection({ ...V2_ENV, FASTSPRING_POPUP_STOREFRONT: stray })).not.toBeNull();
    }
  });

  // The two storefronts are different stores. A live session pushed into the test
  // storefront (or the reverse) is a checkout the buyer can never complete, and
  // the mismatch is invisible at a glance in an environment file.
  it('refuses a storefront from the other mode', () => {
    expect(
      rejection({
        ...LIVE_ENV,
        FASTSPRING_POPUP_STOREFRONT: 'fluxradar.test.onfastspring.com/popup-checkout',
      }),
    ).toContain('FASTSPRING_MODE=live');
    expect(
      rejection({
        ...V2_ENV,
        FASTSPRING_POPUP_STOREFRONT: 'fluxradar.onfastspring.com/popup-checkout',
      }),
    ).toContain('FASTSPRING_MODE=test');

    const live = readFastSpringConfig(LIVE_ENV);
    expect(live.state).toBe('configured');
  });

  it('never lets a rejected storefront put its value in the reason', () => {
    const reason = rejection({
      ...V2_ENV,
      FASTSPRING_POPUP_STOREFRONT: 'checkout.evil.example/coupon-secret',
    });

    expect(reason).not.toBeNull();
    expect(reason).not.toContain('coupon-secret');
    expect(reason).not.toContain('evil.example');
  });

  describe('what the browser is told', () => {
    let db: TestDb;
    let emailCounter = 0;
    const nextEmailSuffix = (): string => {
      emailCounter += 1;
      return String(emailCounter);
    };

    beforeEach(async () => {
      db = await createTestDb();
    });

    afterEach(async () => {
      await db.cleanup();
    });

    async function checkoutConfig(env: NodeJS.ProcessEnv): Promise<Record<string, unknown>> {
      const app = createApp({
        prisma: db.prisma,
        logger: silentLogger,
        webhookSecret: TEST_WEBHOOK_SECRET,
        autoProcess: false,
        fastSpring: readFastSpringConfig(env),
      });
      const agent = request.agent(app);
      const email = `popup-${nextEmailSuffix()}@example.com`;
      const registered = await agent
        .post('/auth/register')
        .send({ email, password: 'correct-horse-1' });
      expect(registered.status).toBe(201);
      const cookie = registered.headers['set-cookie']?.[0]?.split(';', 1)[0] ?? '';
      const response = await agent.get('/billing/checkout-config').set('Cookie', cookie);
      expect(response.status).toBe(200);
      return response.body.data as Record<string, unknown>;
    }

    // The storefront is the one FastSpring value that is meant to reach a browser
    // — it is in a public script tag on every site that sells through FastSpring.
    // Nothing else may travel with it.
    it('serves the storefront and no credential', async () => {
      const data = await checkoutConfig(V2_ENV);

      expect(data.popup).toEqual({ storefront: 'fluxradar.test.onfastspring.com/popup-checkout' });
      const serialised = JSON.stringify(data);
      expect(serialised).not.toContain('api-password-value');
      expect(serialised).not.toContain('api-user');
      expect(serialised).not.toContain(TEST_FASTSPRING_SECRET);
      expect(serialised).not.toContain('FASTSPRING_');
    });

    // Without a popup checkout the UI keeps the provider-hosted flow rather than
    // inventing a storefront to open.
    it('reports no popup for a deployment that has none', async () => {
      const data = await checkoutConfig({
        FASTSPRING_MODE: 'test',
        FASTSPRING_API_USERNAME: 'api-user',
        FASTSPRING_API_PASSWORD: 'api-password-value',
        FASTSPRING_WEBHOOK_SECRET: TEST_FASTSPRING_SECRET,
        FASTSPRING_STOREFRONT_URL: 'https://fluxradar.test.onfastspring.com',
        FASTSPRING_PRODUCT_PATH_BASIC: 'fluxradar-basic-scan',
        FASTSPRING_PRODUCT_PATH_COMPLETE: 'fluxradar-complete-scan',
      });

      expect(data.available).toBe(true);
      expect(data.popup).toBeNull();
    });

    it('reports no popup when paid checkout is off entirely', async () => {
      const data = await checkoutConfig({ DATABASE_URL: 'postgresql://x' });

      expect(data.available).toBe(false);
      expect(data.popup).toBeNull();
    });
  });
});
