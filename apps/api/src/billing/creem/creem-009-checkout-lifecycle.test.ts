import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckoutSession, Prisma } from '@prisma/client';

import { createApp } from '../../index.ts';
import { silentLogger } from '../../http/logger.ts';
import {
  deleteAccountData,
  expireAbandonedCheckoutSessions,
  runRetentionSweep,
} from '../../data-retention.ts';
import {
  createTestDb,
  seedAccountWithProfile,
  seedReachableSite,
  type SeededAccount,
  type TestDb,
} from '../../test-utils/test-db.ts';
import {
  CHECKOUT_ABANDON_GRACE_DAYS,
  CHECKOUT_SESSION_FALLBACK_TTL_DAYS,
  CHECKOUT_STATUS_REASONS,
} from '../checkout-lifecycle.ts';
import { CHECKOUT_REASON_CODES, checkoutReasonCode } from '../checkout-status-reason.ts';
import { findCheckoutStatus } from '../checkout-status.ts';
import { CHECKOUT_SESSION_STATUSES } from '../constants.ts';
import type { FetchLike } from '../fetch-like.ts';
import { WEBHOOK_OUTCOMES } from '../webhook-outcomes.ts';
import { CREEM_PROVIDER, readCreemConfig, type CreemConfigResult } from './config.ts';
import { CREEM_EVENT_TYPES } from './events.ts';
import {
  TEST_CREEM_SECRET,
  checkoutCompletedObject,
  signedCreemDelivery,
} from './test-payloads.ts';
import { handleCreemWebhook } from './webhook-handler.ts';

// CREEM-009: the life of a checkout session that is never paid, and what the
// buyer is told about one that granted nothing.
//
// Ported from the deleted fastspring-007-checkout-lifecycle.test.ts and
// fastspring-008-claim-atomicity.test.ts onto Creem. Behaviour only — both
// checkout-lifecycle.ts (the deadline, the retention sweep) and
// checkout-status-reason.ts (the buyer-facing code) are provider-neutral
// already, so nothing here is Creem-specific except how a session and an
// order are shaped. The FastSpring suite's "provider never opens a session"
// and "keeps its own deadline over the provider's" cases are dropped: Creem's
// hosted checkout has no equivalent (CREEM-004 already covers a provider
// failure closing the session), and Creem returns no deadline to override.

const CONFIG_ENV = {
  CREEM_MODE: 'test',
  CREEM_API_KEY: 'creem-api-key-value',
  CREEM_WEBHOOK_SECRET: TEST_CREEM_SECRET,
  CREEM_PRODUCT_ID_BASIC: 'prod_basic',
  CREEM_PRODUCT_ID_COMPLETE: 'prod_complete',
  FRONTEND_ORIGIN: 'http://localhost:5174',
} satisfies NodeJS.ProcessEnv;

const BASIC_PRODUCT = 'prod_basic';
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

function configured(): CreemConfigResult {
  return readCreemConfig(CONFIG_ENV);
}

/** A provider that answers with a pending hosted checkout, as the happy path does. */
function stubOpenCheckout(): FetchLike {
  return () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'chk_lifecycle',
          object: 'checkout',
          status: 'pending',
          checkout_url: 'https://www.creem.io/test/checkout/prod_basic/chk_lifecycle',
          mode: 'test',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
}

describe('CREEM-009 checkout session lifecycle', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  function buildApp(fetchImpl: FetchLike = stubOpenCheckout()) {
    return createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
      creem: configured(),
      optInAiProviders: [],
      creemFetch: fetchImpl,
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
    // The checkout refuses a site whose last reachability probe is missing or
    // negative (CREEM-008). These tests are about the checkout, so they state
    // that precondition instead of running a probe.
    await seedReachableSite(
      db.prisma,
      registered.body.data.accountId as string,
      profile.body.data.id as string,
    );
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
        provider: CREEM_PROVIDER,
        reference: overrides.reference ?? `frcs_${Math.random().toString(36).slice(2)}`,
        accountId,
        siteProfileId,
        plan: 'Basic',
        productPath: BASIC_PRODUCT,
        expectedAmountUsd: BASIC_PRICE,
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

  it('opens the session with a deadline', async () => {
    const app = buildApp();
    const { agent, cookie, profileId } = await signIn(app, 'deadline@example.com');

    const created = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .send({ siteProfileId: profileId, plan: 'Basic', scope: SCOPE });

    expect(created.status).toBe(201);
    expect(created.body.data.expiresAt).not.toBeNull();
    const [session] = await db.prisma.checkoutSession.findMany();
    expect(session?.expiresAt).not.toBeNull();
    expect(session?.expiresAt?.getTime() ?? 0).toBeGreaterThan(Date.now());
    // And the fresh checkout still blocks the profile, as an open one must.
    const blocked = await agent.delete(`/profiles/${profileId}`).set('Cookie', cookie);
    expect(blocked.status).toBe(409);
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

      const orderId = `ord_${randomUUID()}`;
      const checkoutId = `chk_${randomUUID()}`;
      const { rawBody, signature } = signedCreemDelivery(
        {
          id: `evt_${randomUUID()}`,
          eventType: CREEM_EVENT_TYPES.checkoutCompleted,
          object: checkoutCompletedObject({
            checkoutId,
            orderId,
            reference,
            productId: BASIC_PRODUCT,
            amountCents: BASIC_PRICE * 100,
          }),
        },
        TEST_CREEM_SECRET,
      );
      const result = await handleCreemWebhook(db.prisma, rawBody, signature, {
        secret: TEST_CREEM_SECRET,
        expectLive: false,
      });

      expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
      expect(await db.prisma.purchase.count({ where: { accountId } })).toBe(1);
      const settled = await db.prisma.checkoutSession.findUniqueOrThrow({ where: { reference } });
      expect(settled.status).toBe(CHECKOUT_SESSION_STATUSES.completed);

      // And only once: a second order quoting the same reference buys nothing.
      const second = signedCreemDelivery(
        {
          id: `evt_${randomUUID()}`,
          eventType: CREEM_EVENT_TYPES.checkoutCompleted,
          object: checkoutCompletedObject({
            checkoutId: `chk_${randomUUID()}`,
            orderId: `ord_${randomUUID()}`,
            reference,
            productId: BASIC_PRODUCT,
            amountCents: BASIC_PRICE * 100,
          }),
        },
        TEST_CREEM_SECRET,
      );
      const replay = await handleCreemWebhook(db.prisma, second.rawBody, second.signature, {
        secret: TEST_CREEM_SECRET,
        expectLive: false,
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

  describe('claim atomicity and buyer-facing status', () => {
    let account: SeededAccount;

    beforeEach(async () => {
      account = await seedAccountWithProfile(db.prisma);
    });

    async function seedCheckoutSession(
      overrides: Partial<Prisma.CheckoutSessionUncheckedCreateInput> = {},
    ): Promise<CheckoutSession> {
      return db.prisma.checkoutSession.create({
        data: {
          provider: CREEM_PROVIDER,
          reference: `frcs_${randomUUID()}`,
          accountId: account.accountId,
          siteProfileId: account.siteProfileId,
          plan: 'Basic',
          productPath: BASIC_PRODUCT,
          expectedAmountUsd: BASIC_PRICE,
          liveMode: false,
          scopeJson: JSON.stringify({ includeSubdomains: false }),
          ...overrides,
        },
      });
    }

    function paidOrder(reference: string) {
      return signedCreemDelivery(
        {
          id: `evt_${randomUUID()}`,
          eventType: CREEM_EVENT_TYPES.checkoutCompleted,
          object: checkoutCompletedObject({
            checkoutId: `chk_${randomUUID()}`,
            orderId: `ord_${randomUUID()}`,
            reference,
            productId: BASIC_PRODUCT,
            amountCents: BASIC_PRICE * 100,
          }),
        },
        TEST_CREEM_SECRET,
      );
    }

    const deliver = (rawBody: string, signature: string) =>
      handleCreemWebhook(db.prisma, rawBody, signature, {
        secret: TEST_CREEM_SECRET,
        expectLive: false,
      });

    // The grant itself fails: the session names a site profile that belongs to
    // someone else, which createPaidScan refuses. The claim and the grant are
    // one unit, so a rejection after the claim must not leave a session that
    // reads `completed` with no purchase behind it.
    it('never leaves a session completed when the paid scan could not be created', async () => {
      const stranger = await seedAccountWithProfile(db.prisma);
      const session = await seedCheckoutSession({ siteProfileId: stranger.siteProfileId });
      const { rawBody, signature } = paidOrder(session.reference);

      const result = await deliver(rawBody, signature);

      expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
      expect(result.results[0]?.reason).toMatch(/site profile/);
      expect(await db.prisma.purchase.count()).toBe(0);
      expect(await db.prisma.scan.count()).toBe(0);
      expect(await db.prisma.entitlement.count()).toBe(0);

      const stored = await db.prisma.checkoutSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      expect(stored.status).toBe(CHECKOUT_SESSION_STATUSES.rejected);
      expect(stored.purchaseId).toBeNull();
    });

    // The rolled-back transaction takes the dedup row with it, so the delivery
    // has to be recorded again afterwards — otherwise the same payload would be
    // reprocessed forever and the rejection would be invisible to support.
    it('still records the rejected delivery after the rollback', async () => {
      const stranger = await seedAccountWithProfile(db.prisma);
      const session = await seedCheckoutSession({ siteProfileId: stranger.siteProfileId });
      const { rawBody, signature } = paidOrder(session.reference);

      await deliver(rawBody, signature);

      const event = await db.prisma.webhookEvent.findFirstOrThrow();
      expect(event.outcome).toBe(WEBHOOK_OUTCOMES.rejected);
      expect(event.outcomeReason).toMatch(/site profile/);
      expect(event.accountId).toBe(account.accountId);
      expect(event.providerTransactionId).not.toBeNull();

      // And a redelivery of the same event is deduplicated rather than retried.
      const again = await deliver(rawBody, signature);
      expect(again.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.deduplicated);
      expect(await db.prisma.webhookEvent.count()).toBe(1);
    });

    it('grants normally when nothing fails after the claim', async () => {
      const session = await seedCheckoutSession();
      const { rawBody, signature } = paidOrder(session.reference);

      const result = await deliver(rawBody, signature);

      expect(result.results[0]?.outcome).toBe(WEBHOOK_OUTCOMES.processed);
      const stored = await db.prisma.checkoutSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      expect(stored.status).toBe(CHECKOUT_SESSION_STATUSES.completed);
      expect(stored.purchaseId).not.toBeNull();
      expect(await db.prisma.scan.count()).toBe(1);
    });

    describe('what the buyer is told', () => {
      // The stored reason is written for us: it quotes amounts, product ids and
      // the internal vocabulary of the webhook handler. The browser gets a code.
      it('answers a rejected checkout with a code, never the internal reason', async () => {
        const stranger = await seedAccountWithProfile(db.prisma);
        const session = await seedCheckoutSession({ siteProfileId: stranger.siteProfileId });
        const { rawBody, signature } = paidOrder(session.reference);
        await deliver(rawBody, signature);

        const view = await findCheckoutStatus(db.prisma, account.accountId, session.reference);

        expect(view.status).toBe(CHECKOUT_SESSION_STATUSES.rejected);
        expect(view.reasonCode).toBe(CHECKOUT_REASON_CODES.paymentNotVerified);
        expect(JSON.stringify(view)).not.toMatch(/site profile/);

        // Support still has the detail, in the database where it belongs.
        const stored = await db.prisma.checkoutSession.findUniqueOrThrow({
          where: { id: session.id },
        });
        expect(stored.statusReason).toMatch(/site profile/);
      });

      it('says nothing about a checkout that is still open or already paid', async () => {
        const session = await seedCheckoutSession();
        const open = await findCheckoutStatus(db.prisma, account.accountId, session.reference);
        expect(open.reasonCode).toBeNull();

        const { rawBody, signature } = paidOrder(session.reference);
        await deliver(rawBody, signature);
        const paid = await findCheckoutStatus(db.prisma, account.accountId, session.reference);
        expect(paid.status).toBe(CHECKOUT_SESSION_STATUSES.completed);
        expect(paid.reasonCode).toBeNull();
        expect(paid.scanId).not.toBeNull();
      });

      it('maps the housekeeping and provider reasons to their own codes', () => {
        const rejected = CHECKOUT_SESSION_STATUSES.rejected;
        expect(checkoutReasonCode(rejected, CHECKOUT_STATUS_REASONS.abandoned)).toBe(
          CHECKOUT_REASON_CODES.expired,
        );
        expect(checkoutReasonCode(rejected, CHECKOUT_STATUS_REASONS.providerUnavailable)).toBe(
          CHECKOUT_REASON_CODES.providerUnavailable,
        );
        // A reason added later must not reach the browser by being forgotten here.
        expect(checkoutReasonCode(rejected, 'order amount 1 does not match the quoted 120')).toBe(
          CHECKOUT_REASON_CODES.paymentNotVerified,
        );
        expect(checkoutReasonCode(rejected, null)).toBeNull();
      });
    });
  });
});
