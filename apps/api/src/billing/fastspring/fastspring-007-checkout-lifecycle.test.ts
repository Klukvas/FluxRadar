import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../index.ts';
import { silentLogger } from '../../http/logger.ts';
import {
  deleteAccountData,
  expireAbandonedCheckoutSessions,
  runRetentionSweep,
} from '../../data-retention.ts';
import { createTestDb, TEST_WEBHOOK_SECRET, type TestDb } from '../../test-utils/test-db.ts';
import {
  CHECKOUT_ABANDON_GRACE_DAYS,
  CHECKOUT_SESSION_FALLBACK_TTL_DAYS,
  CHECKOUT_STATUS_REASONS,
} from '../checkout-lifecycle.ts';
import { CHECKOUT_SESSION_STATUSES } from '../constants.ts';
import { readFastSpringConfig, type FastSpringConfigResult } from './config.ts';
import type { FetchLike } from './client.ts';
import { handleFastSpringWebhook, WEBHOOK_OUTCOMES } from './webhook-handler.ts';
import { TEST_FASTSPRING_SECRET, orderCompletedData, signedDelivery } from './test-payloads.ts';

// FASTSPRING-007: the life of a checkout session that is never paid.
//
// The row is written BEFORE FastSpring is called, so a closed tab, a provider
// timeout or a 5xx all leave a `created` session behind. That row is what
// DELETE /profiles/:id refuses on, so if it never dies the profile can never be
// deleted. What is pinned down here: a session blocks only while it can still be
// paid, a provider failure closes it immediately, the retention sweep closes an
// abandoned one WITHOUT being able to swallow a late payment, and account
// deletion still removes every session regardless of its state.

const CONFIG_ENV = {
  FASTSPRING_MODE: 'test',
  FASTSPRING_API_USERNAME: 'api-user',
  FASTSPRING_API_PASSWORD: 'api-password-value',
  FASTSPRING_WEBHOOK_SECRET: TEST_FASTSPRING_SECRET,
  FASTSPRING_STOREFRONT_URL: 'https://fluxradar.test.onfastspring.com',
  FASTSPRING_PRODUCT_PATH_BASIC: 'fluxradar-basic-scan',
  FASTSPRING_PRODUCT_PATH_COMPLETE: 'fluxradar-complete-scan',
} satisfies NodeJS.ProcessEnv;

const BASIC_PRODUCT = 'fluxradar-basic-scan';
const BASIC_PRICE = 55;
const DAY_MS = 24 * 60 * 60 * 1000;
const SCOPE = {
  includeSubdomains: false,
  maxPages: 25,
  maxDepth: 3,
  queryPolicy: 'ignore',
  respectRobots: true,
  robotsOverrideConfirmed: false,
  userAgent: 'desktop',
};

function configured(): FastSpringConfigResult {
  return readFastSpringConfig(CONFIG_ENV);
}

/** A provider that answers with an open session, as the happy path does. */
function stubOpenSession(): FetchLike {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify({ id: 'sess_lifecycle', currency: 'USD', subtotal: 55 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
}

describe('FASTSPRING-007 checkout session lifecycle', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  function buildApp(fetchImpl: FetchLike = stubOpenSession()) {
    return createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
      fastSpring: configured(),
      fastSpringFetch: fetchImpl,
    });
  }

  async function signIn(app: ReturnType<typeof buildApp>, email: string) {
    const agent = request.agent(app);
    const registered = await agent
      .post('/auth/register')
      .send({ email, password: 'correct-horse-1' });
    expect(registered.status).toBe(201);
    const cookie = registered.headers['set-cookie']?.[0]?.split(';', 1)[0] ?? '';
    const profile = await agent
      .post('/profiles')
      .set('Cookie', cookie)
      .send({ name: 'Fixture Site', domain: `https://${email.split('@')[0]}.example.com` });
    expect(profile.status).toBe(201);
    return {
      agent,
      cookie,
      accountId: registered.body.data.accountId as string,
      profileId: profile.body.data.id as string,
    };
  }

  async function seedSession(
    accountId: string,
    siteProfileId: string,
    overrides: { expiresAt?: Date | null; createdAt?: Date; reference?: string } = {},
  ) {
    return db.prisma.checkoutSession.create({
      data: {
        provider: 'fastspring',
        reference: overrides.reference ?? `frcs_${Math.random().toString(36).slice(2)}`,
        accountId,
        siteProfileId,
        plan: 'Basic',
        productPath: BASIC_PRODUCT,
        expectedAmountUsd: BASIC_PRICE,
        quotedAmount: BASIC_PRICE,
        quotedCurrency: 'USD',
        liveMode: false,
        scopeJson: JSON.stringify({ includeSubdomains: false }),
        createdAt: overrides.createdAt ?? new Date(),
        expiresAt:
          overrides.expiresAt === undefined ? new Date(Date.now() + DAY_MS) : overrides.expiresAt,
      },
    });
  }

  it('blocks a profile deletion while the checkout can still be paid', async () => {
    const app = buildApp();
    const { agent, cookie, accountId, profileId } = await signIn(app, 'open@example.com');
    await seedSession(accountId, profileId, { expiresAt: new Date(Date.now() + DAY_MS) });

    const blocked = await agent.delete(`/profiles/${profileId}`).set('Cookie', cookie);

    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PROFILE_HAS_OPEN_CHECKOUT');
    expect(await db.prisma.siteProfile.count({ where: { id: profileId } })).toBe(1);
  });

  // The bug this pins down: the row stayed `created` forever, so an abandoned
  // tab made the profile permanently undeletable.
  it('lets a profile go once its checkout deadline has passed', async () => {
    const app = buildApp();
    const { agent, cookie, accountId, profileId } = await signIn(app, 'expired@example.com');
    await seedSession(accountId, profileId, { expiresAt: new Date(Date.now() - 60_000) });

    const deleted = await agent.delete(`/profiles/${profileId}`).set('Cookie', cookie);

    expect(deleted.status).toBe(200);
    expect(await db.prisma.siteProfile.count({ where: { id: profileId } })).toBe(0);
    expect(await db.prisma.checkoutSession.count({ where: { siteProfileId: profileId } })).toBe(0);
  });

  // A row that never received a deadline (created before this rule, or a process
  // that died between the INSERT and the provider response) ages out instead.
  it('treats a session with no deadline as open only for the fallback window', async () => {
    const app = buildApp();
    const { agent, cookie, accountId, profileId } = await signIn(app, 'nodeadline@example.com');
    const fresh = await seedSession(accountId, profileId, { expiresAt: null });

    const blocked = await agent.delete(`/profiles/${profileId}`).set('Cookie', cookie);
    expect(blocked.status).toBe(409);

    await db.prisma.checkoutSession.update({
      where: { id: fresh.id },
      data: {
        createdAt: new Date(Date.now() - (CHECKOUT_SESSION_FALLBACK_TTL_DAYS + 1) * DAY_MS),
      },
    });
    const deleted = await agent.delete(`/profiles/${profileId}`).set('Cookie', cookie);
    expect(deleted.status).toBe(200);
  });

  it('closes the session when FastSpring never opens a checkout', async () => {
    const app = buildApp(() =>
      Promise.resolve(new Response('{"message":"upstream down"}', { status: 503 })),
    );
    const { agent, cookie, profileId } = await signIn(app, 'providerdown@example.com');

    const failed = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .send({ siteProfileId: profileId, plan: 'Basic', scope: SCOPE });
    expect(failed.status).toBe(502);

    const [session] = await db.prisma.checkoutSession.findMany();
    expect(session?.status).toBe(CHECKOUT_SESSION_STATUSES.rejected);
    expect(session?.statusReason).toBe(CHECKOUT_STATUS_REASONS.providerUnavailable);
    // The failed attempt must leave nothing behind that blocks the buyer's next
    // move — neither a retry nor deleting the profile.
    const deleted = await agent.delete(`/profiles/${profileId}`).set('Cookie', cookie);
    expect(deleted.status).toBe(200);
  });

  it('keeps its own deadline when the provider reports one already in the past', async () => {
    const app = buildApp(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ id: 'sess_stale', currency: 'USD', subtotal: 55, expires: 1_000 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    const { agent, cookie, profileId } = await signIn(app, 'staledeadline@example.com');

    const created = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .send({ siteProfileId: profileId, plan: 'Basic', scope: SCOPE });
    expect(created.status).toBe(201);

    const [session] = await db.prisma.checkoutSession.findMany();
    expect(session?.expiresAt?.getTime() ?? 0).toBeGreaterThan(Date.now());
    // And the fresh checkout still blocks the profile, as an open one must.
    const blocked = await agent.delete(`/profiles/${profileId}`).set('Cookie', cookie);
    expect(blocked.status).toBe(409);
  });

  it('opens the session with a deadline even when the provider reports none', async () => {
    const app = buildApp();
    const { agent, cookie, profileId } = await signIn(app, 'nodeadlinefromprovider@example.com');

    const created = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .send({ siteProfileId: profileId, plan: 'Basic', scope: SCOPE });

    expect(created.status).toBe(201);
    expect(created.body.data.expiresAt).not.toBeNull();
    const [session] = await db.prisma.checkoutSession.findMany();
    expect(session?.expiresAt).not.toBeNull();
    expect(session?.expiresAt?.getTime() ?? 0).toBeGreaterThan(Date.now());
  });

  describe('retention sweep', () => {
    it('closes only sessions abandoned past the grace period', async () => {
      const app = buildApp();
      const { accountId, profileId } = await signIn(app, 'sweep@example.com');
      const recent = await seedSession(accountId, profileId, {
        expiresAt: new Date(Date.now() - DAY_MS),
      });
      const abandoned = await seedSession(accountId, profileId, {
        expiresAt: new Date(Date.now() - (CHECKOUT_ABANDON_GRACE_DAYS + 1) * DAY_MS),
      });

      expect(await expireAbandonedCheckoutSessions(db.prisma, new Date())).toBe(1);

      const stillCreated = await db.prisma.checkoutSession.findUniqueOrThrow({
        where: { id: recent.id },
      });
      expect(stillCreated.status).toBe(CHECKOUT_SESSION_STATUSES.created);
      const closed = await db.prisma.checkoutSession.findUniqueOrThrow({
        where: { id: abandoned.id },
      });
      expect(closed.status).toBe(CHECKOUT_SESSION_STATUSES.rejected);
      expect(closed.statusReason).toBe(CHECKOUT_STATUS_REASONS.abandoned);
    });

    it('runs as part of the scheduled retention sweep', async () => {
      const app = buildApp();
      const { accountId, profileId } = await signIn(app, 'sweepwired@example.com');
      await seedSession(accountId, profileId, {
        expiresAt: new Date(Date.now() - (CHECKOUT_ABANDON_GRACE_DAYS + 1) * DAY_MS),
      });

      const result = await runRetentionSweep(db.prisma, new Date());

      expect(result.expiredCheckoutSessionCount).toBe(1);
    });

    // Housekeeping may never cost a buyer their scan: an order that lands against
    // a session the sweep already closed still grants exactly one purchase.
    it('still honours a payment that arrives after the session was closed', async () => {
      const app = buildApp();
      const { accountId, profileId } = await signIn(app, 'latepayment@example.com');
      const reference = 'frcs_late_payment';
      await seedSession(accountId, profileId, {
        reference,
        expiresAt: new Date(Date.now() - (CHECKOUT_ABANDON_GRACE_DAYS + 1) * DAY_MS),
      });
      expect(await expireAbandonedCheckoutSessions(db.prisma, new Date())).toBe(1);

      const { rawBody, signature } = signedDelivery([
        {
          id: 'evt_late',
          type: 'order.completed',
          data: orderCompletedData({
            orderId: 'ord_late',
            reference,
            productPath: BASIC_PRODUCT,
            amount: BASIC_PRICE,
          }),
        },
      ]);
      const result = await handleFastSpringWebhook(db.prisma, rawBody, signature, {
        secret: TEST_FASTSPRING_SECRET,
        expectLive: false,
        currencyPolicy: 'strict',
      });

      expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
      expect(await db.prisma.purchase.count({ where: { accountId } })).toBe(1);
      const settled = await db.prisma.checkoutSession.findUniqueOrThrow({ where: { reference } });
      expect(settled.status).toBe(CHECKOUT_SESSION_STATUSES.completed);

      // And only once: a second order quoting the same reference buys nothing.
      const second = signedDelivery([
        {
          id: 'evt_late_2',
          type: 'order.completed',
          data: orderCompletedData({
            orderId: 'ord_late_2',
            reference,
            productPath: BASIC_PRODUCT,
            amount: BASIC_PRICE,
          }),
        },
      ]);
      const replay = await handleFastSpringWebhook(db.prisma, second.rawBody, second.signature, {
        secret: TEST_FASTSPRING_SECRET,
        expectLive: false,
        currencyPolicy: 'strict',
      });
      expect(replay.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
      expect(await db.prisma.purchase.count({ where: { accountId } })).toBe(1);
    });
  });

  it('removes every checkout session when the account is deleted', async () => {
    const app = buildApp();
    const { accountId, profileId } = await signIn(app, 'erasure@example.com');
    await seedSession(accountId, profileId, { expiresAt: new Date(Date.now() + DAY_MS) });
    await seedSession(accountId, profileId, { expiresAt: new Date(Date.now() - DAY_MS) });

    await deleteAccountData(db.prisma, accountId, null);

    expect(await db.prisma.checkoutSession.count({ where: { accountId } })).toBe(0);
    expect(await db.prisma.account.count({ where: { id: accountId } })).toBe(0);
  });
});
