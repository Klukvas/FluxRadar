import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../index.ts';
import { silentLogger } from '../../http/logger.ts';
import { REACHABILITY_PROBE_TTL_MS } from '../../profiles/reachability-routes.ts';
import { createTestDb, TEST_WEBHOOK_SECRET, type TestDb } from '../../test-utils/test-db.ts';
import type { FetchLike } from './client.ts';
import { readFastSpringConfig } from './config.ts';
import { TEST_FASTSPRING_SECRET } from './test-payloads.ts';

// FASTSPRING-009: a scan of a site we cannot read is not for sale.
//
// A customer could buy a $120 audit of a site behind a WAF that refuses our
// crawler, wait for the scan to run, and receive a refund instead of a report.
// Nothing before the pay button had ever tried to fetch the site.
//
// The reachability panel in the browser explains the refusal in advance; this
// is the refusal itself, and it lives on the server because a browser can be
// told anything. Every test here therefore writes the probe row directly and
// checks what the checkout does with it — the browser is never consulted.

const CONFIG_ENV = {
  FASTSPRING_MODE: 'test',
  FASTSPRING_API_USERNAME: 'api-user',
  FASTSPRING_API_PASSWORD: 'api-password-value',
  FASTSPRING_WEBHOOK_SECRET: TEST_FASTSPRING_SECRET,
  FASTSPRING_STOREFRONT_URL: 'https://fluxradar.test.onfastspring.com',
  FASTSPRING_PRODUCT_PATH_BASIC: 'fluxradar-basic-scan',
  FASTSPRING_PRODUCT_PATH_COMPLETE: 'fluxradar-complete-scan',
} satisfies NodeJS.ProcessEnv;

const SCOPE = {
  includeSubdomains: false,
  maxPages: 25,
  maxDepth: 3,
  queryPolicy: 'ignore',
  respectRobots: true,
  robotsOverrideConfirmed: false,
  userAgent: 'desktop',
};

const NOW = new Date('2026-09-21T12:00:00.000Z');

function stubFastSpring(): FetchLike {
  return () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'sess_test',
          url: 'https://fluxradar.test.onfastspring.com/session/sess_test',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
}

describe('FASTSPRING-009 a blocked site cannot be bought', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  function buildApp() {
    return createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
      now: () => NOW,
      fastSpring: readFastSpringConfig(CONFIG_ENV),
      fastSpringFetch: stubFastSpring(),
    });
  }

  async function signIn(app: ReturnType<typeof buildApp>) {
    const agent = request.agent(app);
    const registered = await agent
      .post('/auth/register')
      .send({ email: 'buyer@example.com', password: 'correct-horse-1' });
    const cookie = registered.headers['set-cookie']?.[0]?.split(';', 1)[0] ?? '';
    const profile = await agent
      .post('/profiles')
      .set('Cookie', cookie)
      .send({ name: 'Fixture Site', domain: 'https://buyer.example.com' });
    return {
      agent,
      cookie,
      accountId: registered.body.data.accountId as string,
      profileId: profile.body.data.id as string,
    };
  }

  /** Probes the profile's own domain unless a test deliberately says otherwise. */
  async function seedProbe(
    accountId: string,
    siteProfileId: string,
    state: string,
    checkedAt = NOW,
  ): Promise<void> {
    const profile = await db.prisma.siteProfile.findUniqueOrThrow({
      where: { id: siteProfileId },
    });
    await db.prisma.siteReachabilityProbe.create({
      data: { accountId, siteProfileId, origin: profile.domain, state, checkedAt },
    });
  }

  function checkout(session: Awaited<ReturnType<typeof signIn>>): request.Test {
    return session.agent
      .post('/billing/checkout-session')
      .set('Cookie', session.cookie)
      .send({ siteProfileId: session.profileId, plan: 'Complete', scope: SCOPE });
  }

  it('opens the checkout when a fresh probe says the site can be read', async () => {
    const session = await signIn(buildApp());
    await seedProbe(session.accountId, session.profileId, 'reachable');

    const response = await checkout(session);

    expect(response.status).toBe(201);
    expect(await db.prisma.checkoutSession.count()).toBe(1);
  });

  it('refuses a site that has never been checked, and opens no session', async () => {
    const session = await signIn(buildApp());

    const response = await checkout(session);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('SITE_NOT_READY');
    // Nothing was reserved, so nothing has to be cleaned up afterwards.
    expect(await db.prisma.checkoutSession.count()).toBe(0);
    expect(await db.prisma.purchase.count()).toBe(0);
  });

  it.each(['access-denied', 'blocked-by-robots', 'unreachable', 'bad-response'])(
    'refuses a site whose last check came back %s',
    async (state) => {
      const session = await signIn(buildApp());
      await seedProbe(session.accountId, session.profileId, state);

      const response = await checkout(session);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('SITE_NOT_READY');
      expect(await db.prisma.checkoutSession.count()).toBe(0);
    },
  );

  it('refuses a probe that has gone out of date rather than trusting an old yes', async () => {
    const session = await signIn(buildApp());
    await seedProbe(
      session.accountId,
      session.profileId,
      'reachable',
      new Date(NOW.getTime() - REACHABILITY_PROBE_TTL_MS - 1000),
    );

    const response = await checkout(session);

    // A site reachable an hour ago may be behind a challenge now, and the whole
    // point of the gate is that the answer is current.
    expect(response.status).toBe(409);
    expect(await db.prisma.checkoutSession.count()).toBe(0);
  });

  it('accepts a probe taken just inside the window', async () => {
    const session = await signIn(buildApp());
    await seedProbe(
      session.accountId,
      session.profileId,
      'reachable',
      new Date(NOW.getTime() - REACHABILITY_PROBE_TTL_MS + 1000),
    );

    expect((await checkout(session)).status).toBe(201);
  });

  it('does not take the browser’s word for it', async () => {
    const session = await signIn(buildApp());
    await seedProbe(session.accountId, session.profileId, 'access-denied');

    // A manipulated client claiming the check passed changes nothing: the server
    // reads its own row and never looks at the request for this.
    const response = await session.agent
      .post('/billing/checkout-session')
      .set('Cookie', session.cookie)
      .send({
        siteProfileId: session.profileId,
        plan: 'Complete',
        scope: SCOPE,
        reachability: { state: 'reachable', canPurchase: true },
      });

    expect(response.status).toBe(409);
    expect(await db.prisma.checkoutSession.count()).toBe(0);
  });

  it('refuses a probe taken for a domain the profile no longer points at', async () => {
    // The gate is only worth anything if it is about the site being bought.
    // A probe row keyed by profile alone says "this profile was reachable",
    // and a profile's domain can be changed while no checkout is open — so
    // probing an easy site, repointing the profile and paying would buy a scan
    // of a site nobody checked.
    const app = buildApp();
    const session = await signIn(app);
    await seedProbe(session.accountId, session.profileId, 'reachable');

    const moved = await session.agent
      .patch(`/profiles/${session.profileId}`)
      .set('Cookie', session.cookie)
      .send({ domain: 'https://somewhere-else.example.com' });
    expect(moved.status).toBe(200);

    const response = await checkout(session);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('SITE_NOT_READY');
    expect(await db.prisma.checkoutSession.count()).toBe(0);
  });

  it("refuses another account's probe for the same profile id", async () => {
    const app = buildApp();
    const session = await signIn(app);
    // A probe row exists, but for nobody: the profile lookup is account-scoped
    // and answers 404 before the gate is ever consulted.
    const response = await session.agent
      .post('/billing/checkout-session')
      .set('Cookie', session.cookie)
      .send({ siteProfileId: 'some-other-profile', plan: 'Complete', scope: SCOPE });

    expect(response.status).toBe(404);
  });
});
