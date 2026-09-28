import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { silentLogger } from '../../http/logger.ts';
import type { ConfiguredEgressLocation } from '../../integrations/crawl-egress-config.ts';
import { EGRESS_LOCATIONS, egressLocation } from '../../integrations/crawl-egress-locations.ts';
import {
  createEgressLocationMonitor,
  type EgressLocationMonitor,
} from '../../integrations/crawl-egress-monitor.ts';
import { resolveLaunchEgressLocation } from '../../scans/launch-egress.ts';
import {
  createTestDb,
  seedAccountWithProfile,
  type SeededAccount,
  type TestDb,
} from '../../test-utils/test-db.ts';
import { SitePreconditionError } from '../errors.ts';
import type { FetchLike } from '../fetch-like.ts';
import { planPriceUsd } from '../plans.ts';
import { createCreemCheckoutSession } from './checkout-session.ts';
import { readCreemConfig, type CreemConfig } from './config.ts';

// CREEM-008: a scan of a site we cannot read is not for sale.
//
// A customer could buy a $120 audit of a site behind a WAF that refuses our
// crawler, wait for the scan to run, and receive a refund instead of a report.
// Nothing before the pay button had ever tried to fetch the site.
//
// The reachability panel in the browser explains the refusal in advance; this
// is the refusal itself, and it lives on the server because a browser can be
// told anything. Every test here therefore writes the probe row directly and
// calls `createCreemCheckoutSession` — the same function the checkout route
// calls — so what is under test is the gate, not the HTTP layer around it
// (CREEM-004 covers that).
//
// Ported from the deleted fastspring-009-reachability-gate.test.ts onto Creem.

const DIRECT_EGRESS = createEgressLocationMonitor({ locations: [], logger: silentLogger });

const SCOPE = {
  includeSubdomains: false,
  renderJs: false,
  maxPages: 25,
  maxDepth: 3,
  queryPolicy: 'ignore' as const,
  respectRobots: true,
  robotsOverrideConfirmed: false,
  userAgent: 'desktop' as const,
};

const NOW = new Date('2026-09-28T12:00:00.000Z');

const REACHABILITY_PROBE_TTL_MS = 15 * 60 * 1000;

function testCheckoutConfig(): CreemConfig {
  const result = readCreemConfig({
    CREEM_MODE: 'test',
    CREEM_API_KEY: 'creem-api-key-value',
    CREEM_WEBHOOK_SECRET: 'a'.repeat(32),
    FRONTEND_ORIGIN: 'https://fluxradar.test',
    CREEM_PRODUCT_ID_BASIC: 'prod_basic',
    CREEM_PRODUCT_ID_COMPLETE: 'prod_complete',
    CREEM_PRODUCT_ID_WEBSITE_AUDIT: 'prod_website_audit',
  });
  if (result.state !== 'configured') {
    throw new Error(`creem-008: the test Creem config is ${result.state}`);
  }
  return result.config;
}

/** Creem's Checkout API, answering with a checkout at the plan's list price. */
function checkoutPricedAt(config: CreemConfig, plan: 'Complete'): FetchLike {
  const productId = config.productIds[plan];
  if (productId === undefined) {
    throw new Error(`creem-008: the test Creem config has no product for ${plan}`);
  }
  const body = JSON.stringify({
    id: `chk_${randomUUID()}`,
    checkout_url: 'https://test-checkout.creem.io/session/stub',
    status: 'pending',
    mode: 'test',
    product: { id: productId, price: Math.round(planPriceUsd(plan) * 100), currency: 'USD' },
  });
  return () =>
    Promise.resolve(
      new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
    );
}

describe('CREEM-008 a blocked site cannot be bought', () => {
  let db: TestDb;
  let account: SeededAccount;
  const config = testCheckoutConfig();

  beforeEach(async () => {
    db = await createTestDb();
    account = await seedAccountWithProfile(db.prisma);
  });

  afterEach(async () => {
    await db.cleanup();
  });

  /** Probes the profile's own domain unless a test deliberately says otherwise. */
  async function seedProbe(
    state: string,
    checkedAt = NOW,
    egressLocationId: string | null = null,
    origin: string = account.domain,
  ): Promise<void> {
    await db.prisma.siteReachabilityProbe.create({
      data: {
        accountId: account.accountId,
        siteProfileId: account.siteProfileId,
        origin,
        egressLocation: egressLocationId,
        state,
        checkedAt,
      },
    });
  }

  async function attemptCheckout(): Promise<{ status: number; code: string | null }> {
    try {
      await createCreemCheckoutSession(
        {
          prisma: db.prisma,
          config,
          now: () => NOW,
          fetchImpl: checkoutPricedAt(config, 'Complete'),
        },
        {
          accountId: account.accountId,
          siteProfileId: account.siteProfileId,
          plan: 'Complete',
          scope: SCOPE,
          egress: await resolveLaunchEgressLocation(DIRECT_EGRESS, undefined),
        },
      );
      return { status: 201, code: null };
    } catch (error) {
      if (error instanceof SitePreconditionError) {
        return { status: 409, code: error.code };
      }
      throw error;
    }
  }

  it('opens the checkout when a fresh probe says the site can be read', async () => {
    await seedProbe('reachable');

    const result = await attemptCheckout();

    expect(result.status).toBe(201);
    expect(await db.prisma.checkoutSession.count()).toBe(1);
  });

  it('refuses a site that has never been checked, and opens no session', async () => {
    const result = await attemptCheckout();

    expect(result.status).toBe(409);
    expect(result.code).toBe('SITE_NOT_READY');
    // Nothing was reserved, so nothing has to be cleaned up afterwards.
    expect(await db.prisma.checkoutSession.count()).toBe(0);
    expect(await db.prisma.purchase.count()).toBe(0);
  });

  it.each(['access-denied', 'blocked-by-robots', 'unreachable', 'bad-response'])(
    'refuses a site whose last check came back %s',
    async (state) => {
      await seedProbe(state);

      const result = await attemptCheckout();

      expect(result.status).toBe(409);
      expect(result.code).toBe('SITE_NOT_READY');
      expect(await db.prisma.checkoutSession.count()).toBe(0);
    },
  );

  it('refuses a probe that has gone out of date rather than trusting an old yes', async () => {
    await seedProbe('reachable', new Date(NOW.getTime() - REACHABILITY_PROBE_TTL_MS - 1000));

    const result = await attemptCheckout();

    // A site reachable an hour ago may be behind a challenge now, and the whole
    // point of the gate is that the answer is current.
    expect(result.status).toBe(409);
    expect(await db.prisma.checkoutSession.count()).toBe(0);
  });

  it('accepts a probe taken just inside the window', async () => {
    await seedProbe('reachable', new Date(NOW.getTime() - REACHABILITY_PROBE_TTL_MS + 1000));

    expect((await attemptCheckout()).status).toBe(201);
  });

  it('refuses a probe taken for a domain the profile no longer points at', async () => {
    // The gate is only worth anything if it is about the site being bought.
    // A probe row keyed by profile alone says "this profile was reachable",
    // and a profile's domain can be changed while no checkout is open — so
    // probing an easy site, repointing the profile and paying would buy a scan
    // of a site nobody checked.
    await seedProbe('reachable');
    await db.prisma.siteProfile.update({
      where: { id: account.siteProfileId },
      data: { domain: 'https://somewhere-else.example.com' },
    });

    const result = await attemptCheckout();

    expect(result.status).toBe(409);
    expect(result.code).toBe('SITE_NOT_READY');
    expect(await db.prisma.checkoutSession.count()).toBe(0);
  });

  describe('with a choice of egress locations (D-228)', () => {
    const kyiv: ConfiguredEgressLocation = {
      location: EGRESS_LOCATIONS[0]!,
      proxy: { host: '203.0.113.10', port: 13128, credentials: null },
      expectedIp: null,
    };
    const frankfurt: ConfiguredEgressLocation = {
      location: egressLocation({
        id: 'de',
        countryCode: 'DE',
        city: 'Frankfurt',
        label: { en: 'Germany, Frankfurt', uk: 'Німеччина, Франкфурт' },
      }),
      proxy: { host: '198.51.100.20', port: 3128, credentials: null },
      expectedIp: null,
    };

    function twoCountries(frankfurtUp: boolean): EgressLocationMonitor {
      return createEgressLocationMonitor({
        locations: [kyiv, frankfurt],
        logger: silentLogger,
        now: () => NOW,
        probe: async (proxy) => ({
          state: proxy?.host === frankfurt.proxy.host && !frankfurtUp ? 'unreachable' : 'healthy',
          observedIp: null,
          expectedIp: null,
          latencyMs: 10,
          detail: null,
          checkedAt: NOW,
        }),
      });
    }

    async function attemptCheckoutFrom(
      monitor: EgressLocationMonitor,
      location: string,
    ): Promise<{ status: number; code: string | null }> {
      try {
        const session = await createCreemCheckoutSession(
          {
            prisma: db.prisma,
            config,
            now: () => NOW,
            fetchImpl: checkoutPricedAt(config, 'Complete'),
          },
          {
            accountId: account.accountId,
            siteProfileId: account.siteProfileId,
            plan: 'Complete',
            scope: { ...SCOPE, egressLocation: location },
            egress: await resolveLaunchEgressLocation(monitor, location),
          },
        );
        return { status: 201, code: session.reference };
      } catch (error) {
        if (error instanceof SitePreconditionError) return { status: 409, code: error.code };
        // EGRESS_LOCATION_UNAVAILABLE and EGRESS_LOCATION_UNKNOWN are ApiError,
        // thrown by resolveLaunchEgressLocation before the gate is reached.
        const apiError = error as { status?: number; code?: string };
        if (typeof apiError.status === 'number' && typeof apiError.code === 'string') {
          return { status: apiError.status, code: apiError.code };
        }
        throw error;
      }
    }

    it('sells a scan from the country the site was checked from, and records it', async () => {
      await seedProbe('reachable', NOW, 'de');

      const result = await attemptCheckoutFrom(twoCountries(true), 'de');

      expect(result.status).toBe(201);
      const row = await db.prisma.checkoutSession.findFirstOrThrow();
      expect(JSON.parse(row.scopeJson)).toMatchObject({ egressLocation: 'de' });
      expect(JSON.parse(row.executionConfigJson ?? '{}')).toMatchObject({
        scope: { egressLocation: 'de' },
      });
    });

    it('refuses a yes from Kyiv as evidence about Frankfurt', async () => {
      // A site can let one country in and refuse another; the gate is about the
      // crawl being bought, and that crawl leaves from Frankfurt.
      await seedProbe('reachable', NOW, 'ua');

      const result = await attemptCheckoutFrom(twoCountries(true), 'de');

      expect(result.status).toBe(409);
      expect(result.code).toBe('SITE_NOT_READY');
      expect(await db.prisma.checkoutSession.count()).toBe(0);
    });

    it('opens no checkout for a country whose network is down', async () => {
      await seedProbe('reachable', NOW, 'de');

      const result = await attemptCheckoutFrom(twoCountries(false), 'de');

      expect(result.status).toBe(503);
      expect(result.code).toBe('EGRESS_LOCATION_UNAVAILABLE');
      expect(await db.prisma.checkoutSession.count()).toBe(0);
    });
  });

  it("refuses another account's probe for the same profile id", async () => {
    // A probe row exists, but for nobody: the profile lookup is account-scoped,
    // so an unowned siteProfileId is a NOT_FOUND before the gate is consulted.
    const other = await seedAccountWithProfile(db.prisma);
    await seedProbe('reachable');

    await expect(
      createCreemCheckoutSession(
        {
          prisma: db.prisma,
          config,
          now: () => NOW,
          fetchImpl: checkoutPricedAt(config, 'Complete'),
        },
        {
          accountId: other.accountId,
          siteProfileId: account.siteProfileId,
          plan: 'Complete',
          scope: SCOPE,
          egress: await resolveLaunchEgressLocation(DIRECT_EGRESS, undefined),
        },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
