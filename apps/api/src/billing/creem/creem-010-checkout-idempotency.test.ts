import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../index.ts';
import { silentLogger } from '../../http/logger.ts';
import { createTestDb, seedReachableSite, type TestDb } from '../../test-utils/test-db.ts';
import { CHECKOUT_STATUS_REASONS } from '../checkout-lifecycle.ts';
import type { FetchLike } from '../fetch-like.ts';
import { CREEM_PROVIDER, readCreemConfig, type CreemConfigResult } from './config.ts';
import { CREEM_EVENT_TYPES } from './events.ts';
import { CREEM_SIGNATURE_HEADER } from './signature.ts';
import {
  TEST_CREEM_SECRET,
  checkoutCompletedObject,
  signedCreemDelivery,
} from './test-payloads.ts';

// CREEM-010: the idempotency contract of POST /billing/checkout-session.
//
// One key per form draft, minted by the browser and reused across retries:
// a repeat with the same key and payload must answer the stored session
// without a second provider call, a paid draft must never open a new payable
// session, a different payload under the same key is a client bug (409), and a
// dead session lets the key be adopted onto one fresh session.

const CONFIG_ENV = {
  CREEM_MODE: 'test',
  CREEM_API_KEY: 'creem-api-key-value',
  CREEM_WEBHOOK_SECRET: TEST_CREEM_SECRET,
  CREEM_PRODUCT_ID_BASIC: 'prod_basic',
  CREEM_PRODUCT_ID_COMPLETE: 'prod_complete',
  FRONTEND_ORIGIN: 'http://localhost:5174',
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

const KEY = 'a'.repeat(32);

function configured(): CreemConfigResult {
  return readCreemConfig(CONFIG_ENV);
}

interface StubCall {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

function stubCreem(response: { status?: number; body: unknown }, calls: StubCall[]): FetchLike {
  return (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as unknown });
    return Promise.resolve(
      new Response(JSON.stringify(response.body), {
        status: response.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
}

/** What Creem answers for a freshly created hosted checkout. */
function pendingCheckout(id: string): Record<string, unknown> {
  return {
    id,
    object: 'checkout',
    status: 'pending',
    checkout_url: `https://www.creem.io/test/checkout/prod_basic/${id}`,
    mode: 'test',
  };
}

describe('CREEM-010 checkout idempotency', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  function buildApp(options: { fetchImpl?: FetchLike } = {}) {
    return createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
      creem: configured(),
      optInAiProviders: [],
      ...(options.fetchImpl !== undefined ? { creemFetch: options.fetchImpl } : {}),
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

  function postWebhook(app: ReturnType<typeof buildApp>, rawBody: string, signature: string) {
    return request(app)
      .post('/webhooks/creem')
      .set('Content-Type', 'application/json')
      .set(CREEM_SIGNATURE_HEADER, signature)
      .send(rawBody);
  }

  function draft(profileId: string, overrides: Record<string, unknown> = {}) {
    return {
      siteProfileId: profileId,
      plan: 'Basic',
      scope: SCOPE,
      ...overrides,
    };
  }

  it('persists the key, hash and URL, and replays the stored view without a second provider call', async () => {
    const calls: StubCall[] = [];
    const app = buildApp({ fetchImpl: stubCreem({ body: pendingCheckout('ch_replay') }, calls) });
    const { agent, cookie, profileId } = await signIn(app, 'replay@example.com');

    const first = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .set('Idempotency-Key', KEY)
      .send(draft(profileId));
    expect(first.status).toBe(201);

    const second = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .set('Idempotency-Key', KEY)
      .send(draft(profileId));
    expect(second.status).toBe(201);
    // The stored view, verbatim — same reference, same hosted URL.
    expect(second.body.data).toEqual(first.body.data);

    expect(calls).toHaveLength(1);
    const stored = await db.prisma.checkoutSession.findFirstOrThrow();
    expect(stored.clientKey).toBe(KEY);
    expect(stored.requestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.checkoutUrl).toBe(
      'https://www.creem.io/test/checkout/prod_basic/ch_replay',
    );
    expect(stored.providerSessionId).toBe('ch_replay');
    expect(stored.status).toBe('created');
  });

  it('refuses the same key for a different draft without opening anything', async () => {
    const calls: StubCall[] = [];
    const app = buildApp({ fetchImpl: stubCreem({ body: pendingCheckout('ch_conflict') }, calls) });
    const { agent, cookie, profileId } = await signIn(app, 'conflict@example.com');

    const first = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .set('Idempotency-Key', KEY)
      .send(draft(profileId, { scope: { ...SCOPE, maxPages: 25 } }));
    expect(first.status).toBe(201);

    const different = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .set('Idempotency-Key', KEY)
      .send(draft(profileId, { scope: { ...SCOPE, maxPages: 20 } }));
    expect(different.status).toBe(409);
    expect(different.body.error.code).toBe('CHECKOUT_IDEMPOTENCY_CONFLICT');

    expect(calls).toHaveLength(1);
    expect(await db.prisma.checkoutSession.count()).toBe(1);
  });

  it('adopts a dead session onto exactly one fresh row under the same key', async () => {
    let attempt = 0;
    const calls: StubCall[] = [];
    const fetchImpl: FetchLike = (url, init) => {
      attempt += 1;
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as unknown });
      if (attempt === 1) {
        return Promise.resolve(new Response('{}', { status: 401 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(pendingCheckout('ch_adopted')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };
    const app = buildApp({ fetchImpl });
    const { agent, cookie, profileId } = await signIn(app, 'adopt@example.com');

    const failed = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .set('Idempotency-Key', KEY)
      .send(draft(profileId));
    expect(failed.status).toBe(502);

    const adopted = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .set('Idempotency-Key', KEY)
      .send(draft(profileId));
    expect(adopted.status).toBe(201);
    expect(adopted.body.data.sessionId).toBe('ch_adopted');

    // One dead row without the key, one fresh payable row carrying it.
    expect(await db.prisma.checkoutSession.count()).toBe(2);
    const dead = await db.prisma.checkoutSession.findFirstOrThrow({
      where: { status: 'rejected' },
    });
    expect(dead.clientKey).toBeNull();
    expect(dead.statusReason).toBe(CHECKOUT_STATUS_REASONS.providerUnavailable);
    const fresh = await db.prisma.checkoutSession.findFirstOrThrow({
      where: { clientKey: KEY },
    });
    expect(fresh.status).toBe('created');
    expect(fresh.providerSessionId).toBe('ch_adopted');
    expect(calls).toHaveLength(2);
  });

  it('never opens a second payable session for a draft that was already paid', async () => {
    const calls: StubCall[] = [];
    const app = buildApp({ fetchImpl: stubCreem({ body: pendingCheckout('ch_paid') }, calls) });
    const { agent, cookie, profileId } = await signIn(app, 'paid@example.com');

    const first = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .set('Idempotency-Key', KEY)
      .send(draft(profileId));
    expect(first.status).toBe(201);
    const reference = first.body.data.reference as string;

    const { rawBody, signature } = signedCreemDelivery({
      id: 'evt_010_paid',
      eventType: CREEM_EVENT_TYPES.checkoutCompleted,
      object: checkoutCompletedObject({
        checkoutId: 'ch_paid',
        orderId: 'ord_010_paid',
        reference,
        productId: 'prod_basic',
        amountCents: 3900,
      }),
    });
    const delivered = await postWebhook(app, rawBody, signature);
    expect(delivered.status).toBe(200);

    const repeated = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .set('Idempotency-Key', KEY)
      .send(draft(profileId));
    expect(repeated.status).toBe(201);
    expect(repeated.body.data).toEqual(first.body.data);

    expect(calls).toHaveLength(1);
    expect(await db.prisma.checkoutSession.count()).toBe(1);
    expect(await db.prisma.scan.count()).toBe(1);
  });

  it('leaves the headerless path unchanged: no key, no hash, URL persisted', async () => {
    const calls: StubCall[] = [];
    const app = buildApp({ fetchImpl: stubCreem({ body: pendingCheckout('ch_plain') }, calls) });
    const { agent, cookie, profileId } = await signIn(app, 'plain@example.com');

    const created = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .send(draft(profileId));
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      sessionId: 'ch_plain',
      checkoutUrl: 'https://www.creem.io/test/checkout/prod_basic/ch_plain',
    });

    expect(calls).toHaveLength(1);
    const stored = await db.prisma.checkoutSession.findFirstOrThrow();
    expect(stored.provider).toBe(CREEM_PROVIDER);
    expect(stored.clientKey).toBeNull();
    expect(stored.requestHash).toBeNull();
    expect(stored.checkoutUrl).toBe('https://www.creem.io/test/checkout/prod_basic/ch_plain');
  });

  it('refuses a malformed key at the edge, before anything is created', async () => {
    const calls: StubCall[] = [];
    const app = buildApp({ fetchImpl: stubCreem({ body: pendingCheckout('ch_never') }, calls) });
    const { agent, cookie, profileId } = await signIn(app, 'malformed@example.com');

    const refused = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'not-a-hex-key')
      .send(draft(profileId));
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('VALIDATION');

    expect(calls).toHaveLength(0);
    expect(await db.prisma.checkoutSession.count()).toBe(0);
  });

  it('answers a provider-less keyed row with a retryable coded error, and adopts it once expired', async () => {
    const calls: StubCall[] = [];
    const app = buildApp({ fetchImpl: stubCreem({ body: pendingCheckout('ch_window') }, calls) });
    const { agent, cookie, profileId } = await signIn(app, 'window@example.com');

    const first = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .set('Idempotency-Key', KEY)
      .send(draft(profileId));
    expect(first.status).toBe(201);

    // Simulate a crash between the INSERT and the provider-field update: the
    // row stays `created`, within its deadline, without a stored provider view.
    await db.prisma.checkoutSession.updateMany({
      data: { providerSessionId: null, checkoutUrl: null },
    });

    const stuck = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .set('Idempotency-Key', KEY)
      .send(draft(profileId));
    // Retryable, coded, and never a bare 500 — and the provider is not asked
    // again, because a second payable checkout may already exist for this key.
    expect(stuck.status).toBe(409);
    expect(stuck.body.error.code).toBe('CHECKOUT_STILL_OPENING');
    expect(stuck.headers['retry-after']).toBe('5');
    expect(calls).toHaveLength(1);
    expect(await db.prisma.checkoutSession.count()).toBe(1);

    // Past the deadline the row is dead enough to adopt: the key moves onto
    // exactly one fresh session.
    await db.prisma.checkoutSession.updateMany({
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const adopted = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .set('Idempotency-Key', KEY)
      .send(draft(profileId));
    expect(adopted.status).toBe(201);
    expect(calls).toHaveLength(2);
    const fresh = await db.prisma.checkoutSession.findFirstOrThrow({
      where: { clientKey: KEY, providerSessionId: { not: null } },
    });
    expect(fresh.providerSessionId).toBe('ch_window');
  });

  it('refuses a key another account already holds, without a second provider call', async () => {
    const calls: StubCall[] = [];
    const app = buildApp({ fetchImpl: stubCreem({ body: pendingCheckout('ch_owner') }, calls) });
    const owner = await signIn(app, 'owner@example.com');

    const first = await owner.agent
      .post('/billing/checkout-session')
      .set('Cookie', owner.cookie)
      .set('Idempotency-Key', KEY)
      .send(draft(owner.profileId));
    expect(first.status).toBe(201);

    const other = await signIn(app, 'other@example.com');
    const reuse = await other.agent
      .post('/billing/checkout-session')
      .set('Cookie', other.cookie)
      .set('Idempotency-Key', KEY)
      .send(draft(other.profileId));
    expect(reuse.status).toBe(409);
    expect(reuse.body.error.code).toBe('CHECKOUT_IDEMPOTENCY_CONFLICT');

    expect(calls).toHaveLength(1);
    expect(await db.prisma.checkoutSession.count()).toBe(1);
  });

  it('stays retryable when the adopted fresh create fails too', async () => {
    let attempt = 0;
    const calls: StubCall[] = [];
    const fetchImpl: FetchLike = (url, init) => {
      attempt += 1;
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) as unknown });
      if (attempt <= 2) {
        return Promise.resolve(new Response('{}', { status: 401 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(pendingCheckout('ch_third')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    };
    const app = buildApp({ fetchImpl });
    const { agent, cookie, profileId } = await signIn(app, 'retryable@example.com');

    const first = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .set('Idempotency-Key', KEY)
      .send(draft(profileId));
    expect(first.status).toBe(502);

    // Adoption onto a fresh row whose provider call also fails: the draft must
    // stay retryable, not stuck behind the dead row.
    const second = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .set('Idempotency-Key', KEY)
      .send(draft(profileId));
    expect(second.status).toBe(502);

    const third = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .set('Idempotency-Key', KEY)
      .send(draft(profileId));
    expect(third.status).toBe(201);
    expect(third.body.data.sessionId).toBe('ch_third');

    // Three provider calls, one per attempt — and exactly one row still
    // carries the key, so there is never a second live payable checkout.
    expect(calls).toHaveLength(3);
    const keyed = await db.prisma.checkoutSession.findMany({ where: { clientKey: KEY } });
    expect(keyed).toHaveLength(1);
    expect(keyed[0]?.status).toBe('created');
    expect(keyed[0]?.providerSessionId).toBe('ch_third');
  });

  it('replays an open session without re-running the reachability precondition', async () => {
    const calls: StubCall[] = [];
    const app = buildApp({ fetchImpl: stubCreem({ body: pendingCheckout('ch_precond') }, calls) });
    const { agent, cookie, profileId } = await signIn(app, 'precond@example.com');

    const first = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .set('Idempotency-Key', KEY)
      .send(draft(profileId));
    expect(first.status).toBe(201);

    // The site's probe disappears: a fresh create would now be refused, but a
    // replay answers from the stored row alone.
    await db.prisma.siteReachabilityProbe.delete({ where: { siteProfileId: profileId } });

    const replayed = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .set('Idempotency-Key', KEY)
      .send(draft(profileId));
    expect(replayed.status).toBe(201);
    expect(replayed.body.data).toEqual(first.body.data);

    expect(calls).toHaveLength(1);
    expect(await db.prisma.checkoutSession.count()).toBe(1);
  });
});
