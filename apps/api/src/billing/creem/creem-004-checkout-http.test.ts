import { CURRENT_AI_PROCESSING_NOTICE_VERSION } from '@fluxradar/ai';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiProviderName } from '@fluxradar/ai';

import { createApp } from '../../index.ts';
import { silentLogger, type ApiLogger } from '../../http/logger.ts';
import type { ConfiguredEgressLocation } from '../../integrations/crawl-egress-config.ts';
import { EGRESS_LOCATIONS, egressLocation } from '../../integrations/crawl-egress-locations.ts';
import {
  createEgressLocationMonitor,
  type EgressLocationMonitor,
} from '../../integrations/crawl-egress-monitor.ts';
import { createTestDb, seedReachableSite, type TestDb } from '../../test-utils/test-db.ts';
import { CHECKOUT_STATUS_REASONS } from '../checkout-lifecycle.ts';
import { CHECKOUT_REASON_CODES } from '../checkout-status-reason.ts';
import type { FetchLike } from '../fetch-like.ts';
import { CREEM_PROVIDER, readCreemConfig, type CreemConfigResult } from './config.ts';
import { CREEM_CHECKOUT_REFERENCE_KEY, CREEM_EVENT_TYPES } from './events.ts';
import { CREEM_SIGNATURE_HEADER } from './signature.ts';
import {
  TEST_CREEM_SECRET,
  checkoutCompletedObject,
  refundCreatedObject,
  signedCreemDelivery,
} from './test-payloads.ts';

// CREEM-004: the HTTP surface of the Creem checkout.
//
// Everything below runs against supertest with a stubbed Creem fetch, so no
// credentials, no network and no real payment are involved. What it pins down:
// the endpoints require a session, the browser learns only a hosted checkout
// URL and a reference, the provider call carries the API key and the reference,
// the surface fails closed when Creem is not configured, a provider failure is
// a gateway error that closes the session row, and — most importantly — NO
// scan exists until a signed webhook arrives.

const CONFIG_ENV = {
  CREEM_MODE: 'test',
  CREEM_API_KEY: 'creem-api-key-value',
  CREEM_WEBHOOK_SECRET: TEST_CREEM_SECRET,
  CREEM_PRODUCT_ID_BASIC: 'prod_basic',
  CREEM_PRODUCT_ID_COMPLETE: 'prod_complete',
  FRONTEND_ORIGIN: 'http://localhost:5174',
} satisfies NodeJS.ProcessEnv;

interface LoggedLine {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly context: Readonly<Record<string, unknown>>;
}

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
function pendingCheckout(id: string, requestId?: string): Record<string, unknown> {
  return {
    id,
    object: 'checkout',
    status: 'pending',
    checkout_url: `https://www.creem.io/test/checkout/prod_basic/${id}`,
    mode: 'test',
    ...(requestId === undefined ? {} : { request_id: requestId }),
  };
}

describe('CREEM-004 checkout HTTP surface', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  function buildApp(
    options: {
      creem?: CreemConfigResult;
      fetchImpl?: FetchLike;
      logger?: ApiLogger;
      optInAiProviders?: readonly AiProviderName[];
      egress?: EgressLocationMonitor;
    } = {},
  ) {
    return createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: options.logger ?? silentLogger,
      creem: options.creem ?? configured(),
      // A deployment with no opt-in AI key, which is what production is until
      // the owner sets one. Tests that want the choice offered say so.
      optInAiProviders: options.optInAiProviders ?? [],
      ...(options.fetchImpl !== undefined ? { creemFetch: options.fetchImpl } : {}),
      ...(options.egress !== undefined ? { egress: options.egress } : {}),
    });
  }

  /** Captures what the API logged, so "not in the response" can be told from "lost". */
  function recordingLogger(): { logger: ApiLogger; lines: LoggedLine[] } {
    const lines: LoggedLine[] = [];
    const record =
      (level: LoggedLine['level']) =>
      (message: string, context?: Readonly<Record<string, unknown>>) => {
        lines.push({ level, message, context: context ?? {} });
      };
    return {
      logger: { info: record('info'), warn: record('warn'), error: record('error') },
      lines,
    };
  }

  async function signIn(
    app: ReturnType<typeof buildApp>,
    email: string,
    options: { reachable?: boolean } = {},
  ) {
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
    // negative. These tests are about the checkout, so they state that
    // precondition instead of running a probe. A test about the precondition
    // itself opts out with `reachable: false` and seeds its own probe.
    if (options.reachable ?? true) {
      await seedReachableSite(
        db.prisma,
        registered.body.data.accountId as string,
        profile.body.data.id as string,
      );
    }
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

  it('requires a session for every checkout endpoint', async () => {
    const app = buildApp();
    expect((await request(app).get('/billing/checkout-config')).status).toBe(401);
    expect(
      (await request(app).post('/billing/checkout-session').send({ plan: 'Basic' })).status,
    ).toBe(401);
    expect((await request(app).get('/billing/checkout-session/frcs_x')).status).toBe(401);
  });

  it('describes the hosted checkout: provider, redirect flow, mode and per-plan availability', async () => {
    const app = buildApp();
    const { agent, cookie } = await signIn(app, 'config@example.com');

    const config = await agent.get('/billing/checkout-config').set('Cookie', cookie);
    expect(config.status).toBe(200);
    expect(config.body.data).toMatchObject({
      provider: CREEM_PROVIDER,
      available: true,
      mode: 'test',
      unavailableReason: null,
      optInAiProviders: [],
    });
    expect(config.body.data.plans).toEqual([
      { plan: 'Basic', priceUsd: 55, currency: 'USD', available: true },
      { plan: 'WebsiteAudit', priceUsd: 79, currency: 'USD', available: false },
      { plan: 'Complete', priceUsd: 120, currency: 'USD', available: true },
    ]);
    // Kept for one release so a tab still running the previous (FastSpring-era)
    // bundle reads a 'redirect' flow and a null popup, not a blocked popup tab
    // (see the comment on the route).
    expect(config.body.data.checkoutFlow).toBe('redirect');
    expect(config.body.data.popup).toBeNull();
    // Nothing about how the deployment is wired reaches the browser.
    expect(JSON.stringify(config.body)).not.toContain('creem-api-key-value');
    expect(JSON.stringify(config.body)).not.toContain('CREEM_');
    expect(JSON.stringify(config.body)).not.toContain('prod_basic');
  });

  it('creates a server-bound session, returns only the hosted URL, and grants nothing yet', async () => {
    const calls: StubCall[] = [];
    const app = buildApp({ fetchImpl: stubCreem({ body: pendingCheckout('ch_abc123') }, calls) });
    const { agent, cookie, profileId } = await signIn(app, 'buyer@example.com');

    const created = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .send({
        siteProfileId: profileId,
        plan: 'Basic',
        scope: SCOPE,
        aiConsent: {
          providers: ['anthropic', 'openai'],
          noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
        },
      });
    expect(created.status).toBe(201);
    const reference = created.body.data.reference as string;
    expect(reference).toMatch(/^frcs_/);
    expect(created.body.data).toMatchObject({
      sessionId: 'ch_abc123',
      checkoutUrl: 'https://www.creem.io/test/checkout/prod_basic/ch_abc123',
      plan: 'Basic',
      amount: 55,
      currency: 'USD',
      mode: 'test',
    });
    expect(created.body.data.expiresAt).toEqual(expect.any(String));
    // The browser learns nothing about credentials or internal ids.
    expect(JSON.stringify(created.body)).not.toContain('creem-api-key-value');
    expect(JSON.stringify(created.body)).not.toContain('scanId');

    // The provider call carried the API key, the product and the reference twice.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://test-api.creem.io/v1/checkouts');
    expect(calls[0]?.headers['x-api-key']).toBe('creem-api-key-value');
    expect(calls[0]?.headers['Authorization']).toBeUndefined();
    const body = calls[0]?.body as {
      product_id: string;
      request_id: string;
      success_url: string;
      metadata: Record<string, string>;
      customer: { email: string };
    };
    expect(body.product_id).toBe('prod_basic');
    expect(body.request_id).toBe(reference);
    expect(body.success_url).toBe('http://localhost:5174/checkout/return');
    expect(body.metadata[CREEM_CHECKOUT_REFERENCE_KEY]).toBe(reference);
    expect(body.customer.email).toBe('buyer@example.com');

    const stored = await db.prisma.checkoutSession.findUniqueOrThrow({ where: { reference } });
    expect(stored.provider).toBe(CREEM_PROVIDER);
    expect(stored.providerSessionId).toBe('ch_abc123');
    expect(stored.productPath).toBe('prod_basic');
    expect(stored.plan).toBe('Basic');
    expect(stored.expectedAmountUsd).toBe(55);
    expect(stored.liveMode).toBe(false);
    expect(stored.status).toBe('created');
    // Creem quotes nothing back; the tariff is the only price.
    expect(stored.quotedAmount).toBeNull();
    expect(stored.quotedCurrency).toBeNull();
    expect(stored.expiresAt).not.toBeNull();

    // No payment yet: no purchase, no entitlement, no scan.
    expect(await db.prisma.purchase.count()).toBe(0);
    expect(await db.prisma.scan.count()).toBe(0);
    const status = await agent.get(`/billing/checkout-session/${reference}`).set('Cookie', cookie);
    expect(status.status).toBe(200);
    expect(status.body.data.status).toBe('created');
    expect(status.body.data.scanId).toBeNull();
    expect(status.body.data.purchaseId).toBeNull();
  });

  it('turns the pending session into a scan only after the signed webhook lands', async () => {
    const calls: StubCall[] = [];
    const app = buildApp({ fetchImpl: stubCreem({ body: pendingCheckout('ch_flow') }, calls) });
    const { agent, cookie, profileId } = await signIn(app, 'flow@example.com');
    const created = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .send({ siteProfileId: profileId, plan: 'Basic', scope: SCOPE });
    expect(created.status).toBe(201);
    const reference = created.body.data.reference as string;

    const { rawBody, signature } = signedCreemDelivery({
      id: 'evt_http_paid',
      eventType: CREEM_EVENT_TYPES.checkoutCompleted,
      object: checkoutCompletedObject({
        checkoutId: 'ch_flow',
        orderId: 'ord_http_paid',
        reference,
        productId: 'prod_basic',
        amountCents: 5500,
      }),
    });
    const delivered = await postWebhook(app, rawBody, signature);
    expect(delivered.status).toBe(200);
    expect(delivered.body.data.received).toBe(1);
    expect(delivered.body.data.results[0]).toMatchObject({
      eventId: 'evt_http_paid',
      eventType: 'checkout.completed',
      outcome: 'processed',
      reason: null,
    });
    expect(delivered.body.data.results[0].scanId).toEqual(expect.any(String));
    // Internal ids stay inside: the webhook answer names the scan, not the purchase.
    expect(delivered.body.data.results[0].purchaseId).toBeUndefined();

    const status = await agent.get(`/billing/checkout-session/${reference}`).set('Cookie', cookie);
    expect(status.body.data.status).toBe('completed');
    expect(status.body.data.scanId).toBe(delivered.body.data.results[0].scanId);

    const scan = await agent
      .get(`/scans/${status.body.data.scanId as string}`)
      .set('Cookie', cookie);
    expect(scan.status).toBe(200);
    expect(scan.body.data.plan).toBe('Basic');
    expect(scan.body.data.scope.maxPages).toBe(25);
  });

  it('answers 400 for an unsigned webhook and creates nothing', async () => {
    const app = buildApp();
    const { rawBody } = signedCreemDelivery({
      id: 'evt_unsigned',
      eventType: CREEM_EVENT_TYPES.checkoutCompleted,
      object: checkoutCompletedObject({
        checkoutId: 'ch_unsigned',
        orderId: 'ord_unsigned',
        reference: 'frcs_x',
        productId: 'prod_basic',
        amountCents: 5500,
      }),
    });
    const forged = await postWebhook(app, rawBody, 'forged');
    expect(forged.status).toBe(400);
    expect(forged.body.error.code).toBe('INVALID_SIGNATURE');

    const missing = await request(app)
      .post('/webhooks/creem')
      .set('Content-Type', 'application/json')
      .send(rawBody);
    expect(missing.status).toBe(400);
    expect(await db.prisma.webhookEvent.count()).toBe(0);
  });

  it('answers 400 for a signed body that is not a Creem event', async () => {
    const app = buildApp();
    const { rawBody, signature } = signedCreemDelivery({
      id: 'evt_shape',
      eventType: '',
      object: {},
    });
    const response = await postWebhook(app, rawBody, signature);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('WEBHOOK_VALIDATION');
    expect(await db.prisma.webhookEvent.count()).toBe(0);
  });

  // A refund whose order has not arrived is accepted and stored, not acted on.
  // 202 says exactly that, and stays a 2xx so Creem does not retry a delivery
  // that would find the same missing order.
  it('answers 202 for a delivery whose refund has no order yet', async () => {
    const app = buildApp();
    const { rawBody, signature } = signedCreemDelivery({
      id: 'evt_http_pending_refund',
      eventType: CREEM_EVENT_TYPES.refundCreated,
      object: refundCreatedObject('ord_http_unknown', 5500),
    });

    const delivered = await postWebhook(app, rawBody, signature);

    expect(delivered.status).toBe(202);
    expect(delivered.body.data.results[0].outcome).toBe('unlinked');
    expect(await db.prisma.purchase.count()).toBe(0);
    expect(await db.prisma.webhookEvent.count()).toBe(1);
  });

  it('reports an unavailable checkout instead of pretending, when nothing is configured', async () => {
    const { logger, lines } = recordingLogger();
    const app = buildApp({ creem: { state: 'not_configured' }, logger });
    const { agent, cookie, profileId } = await signIn(app, 'unconfigured@example.com');

    const config = await agent.get('/billing/checkout-config').set('Cookie', cookie);
    expect(config.status).toBe(200);
    expect(config.body.data.available).toBe(false);
    expect(config.body.data.mode).toBeNull();
    expect(config.body.data.unavailableReason).toBe('not_configured');

    const attempt = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .send({ siteProfileId: profileId, plan: 'Basic', scope: SCOPE });
    expect(attempt.status).toBe(503);
    expect(attempt.body.error.code).toBe('BILLING_UNAVAILABLE');
    expect(await db.prisma.checkoutSession.count()).toBe(0);

    // The webhook route is mounted regardless, and fails closed the same way.
    const { rawBody, signature } = signedCreemDelivery({
      id: 'evt_unconfigured',
      eventType: CREEM_EVENT_TYPES.refundCreated,
      object: refundCreatedObject('ord_x', 5500),
    });
    const webhook = await postWebhook(app, rawBody, signature);
    expect(webhook.status).toBe(503);
    expect(webhook.body.error.code).toBe('BILLING_UNAVAILABLE');
    expect(await db.prisma.webhookEvent.count()).toBe(0);
    expect(await db.prisma.scan.count()).toBe(0);
    expect(
      lines.some(
        (line) =>
          line.level === 'info' &&
          line.message === 'paid checkout disabled: Creem is not configured',
      ),
    ).toBe(true);
  });

  // A half-configured provider is an operator's problem. Which CREEM_* variables
  // are absent describes how this deployment is wired, so it belongs in the log
  // and nowhere else.
  it('fails closed on a partial configuration without naming a variable to the client', async () => {
    const { logger, lines } = recordingLogger();
    const partial = readCreemConfig({ CREEM_MODE: 'live', CREEM_API_KEY: 'super-secret-value' });
    expect(partial.state).toBe('invalid');
    const app = buildApp({ creem: partial, logger });
    const { agent, cookie, profileId } = await signIn(app, 'partial@example.com');

    const config = await agent.get('/billing/checkout-config').set('Cookie', cookie);
    expect(config.status).toBe(200);
    expect(config.body.data.available).toBe(false);
    expect(JSON.stringify(config.body)).not.toContain('CREEM_');
    expect(JSON.stringify(config.body)).not.toContain('super-secret-value');

    const attempt = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .send({ siteProfileId: profileId, plan: 'Basic', scope: SCOPE });
    expect(attempt.status).toBe(503);
    expect(attempt.body.error.code).toBe('BILLING_UNAVAILABLE');
    expect(JSON.stringify(attempt.body)).not.toContain('CREEM_');
    expect(JSON.stringify(attempt.body)).not.toContain('super-secret-value');

    const { rawBody, signature } = signedCreemDelivery({
      id: 'evt_partial',
      eventType: CREEM_EVENT_TYPES.refundCreated,
      object: refundCreatedObject('ord_x', 5500),
    });
    const webhook = await postWebhook(app, rawBody, signature);
    expect(webhook.status).toBe(503);
    expect(JSON.stringify(webhook.body)).not.toContain('CREEM_');
    expect(await db.prisma.scan.count()).toBe(0);

    // ...and the operator still gets the names, on the server side only.
    const startup = lines.find((line) => line.message.startsWith('paid checkout disabled'));
    expect(startup?.level).toBe('error');
    expect(startup?.context.missing).toContain('CREEM_WEBHOOK_SECRET');
    expect(startup?.context.missing).toContain('CREEM_PRODUCT_ID_BASIC');
    expect(JSON.stringify(lines)).not.toContain('super-secret-value');
  });

  // Rejected API credentials are a deployment fact, not a payment fact. The
  // session row is closed so the reference can never be paid, and the buyer is
  // told the checkout is unavailable — not which of our settings is wrong.
  it('maps a rejected API key to a gateway error and closes the session row', async () => {
    const errorLog = vi.fn();
    const app = buildApp({
      logger: { info: vi.fn(), warn: vi.fn(), error: errorLog },
      fetchImpl: () => Promise.resolve(new Response('{}', { status: 401 })),
    });
    const { agent, cookie, profileId } = await signIn(app, 'badkey@example.com');
    const failed = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .send({ siteProfileId: profileId, plan: 'Basic', scope: SCOPE });

    expect(failed.status).toBe(502);
    expect(failed.body.error.code).toBe('CREEM_API');
    expect(failed.body.error.message).toBe('Paid checkout is temporarily unavailable');
    expect(JSON.stringify(failed.body)).not.toContain('creem-api-key-value');
    expect(JSON.stringify(failed.body)).not.toContain('API key');
    expect(JSON.stringify(errorLog.mock.calls)).toContain('rejected the API key');
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('creem-api-key-value');

    // The row was written before the provider call, and closed after it failed.
    const stored = await db.prisma.checkoutSession.findFirstOrThrow();
    expect(stored.status).toBe('rejected');
    expect(stored.statusReason).toBe(CHECKOUT_STATUS_REASONS.providerUnavailable);
    expect(stored.providerSessionId).toBeNull();
    const status = await agent
      .get(`/billing/checkout-session/${stored.reference}`)
      .set('Cookie', cookie);
    expect(status.body.data.status).toBe('rejected');
    expect(status.body.data.reasonCode).toBe(CHECKOUT_REASON_CODES.providerUnavailable);
    expect(await db.prisma.scan.count()).toBe(0);
  });

  it('keeps the provider message and the operator detail out of the buyer response', async () => {
    const errorLog = vi.fn();
    const app = buildApp({
      logger: { info: vi.fn(), warn: vi.fn(), error: errorLog },
      fetchImpl: () =>
        Promise.resolve(
          new Response(JSON.stringify({ message: 'product_id must be a valid id' }), {
            status: 400,
          }),
        ),
    });
    const { agent, cookie, profileId } = await signIn(app, 'apierror@example.com');
    const failed = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .send({ siteProfileId: profileId, plan: 'Complete', scope: SCOPE });

    expect(failed.status).toBe(502);
    expect(failed.body.error.code).toBe('CREEM_API');
    expect(JSON.stringify(failed.body)).not.toContain('product_id must be a valid id');
    expect(JSON.stringify(errorLog.mock.calls)).toContain('product_id must be a valid id');
    expect(await db.prisma.scan.count()).toBe(0);
  });

  // A test key answering with a live checkout is a key in the wrong variable:
  // the buyer would pay into an environment whose webhook secret we do not hold.
  it('refuses a checkout Creem opened in the other mode', async () => {
    const calls: StubCall[] = [];
    const app = buildApp({
      fetchImpl: stubCreem({ body: { ...pendingCheckout('ch_prod'), mode: 'prod' } }, calls),
    });
    const { agent, cookie, profileId } = await signIn(app, 'wrongmode@example.com');
    const failed = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .send({ siteProfileId: profileId, plan: 'Basic', scope: SCOPE });

    expect(failed.status).toBe(502);
    expect(failed.body.error.code).toBe('CREEM_API');
    expect(failed.body.error.message).toBe('Paid checkout is temporarily unavailable');
    expect(JSON.stringify(failed.body)).not.toContain('checkout_url');
    expect(calls).toHaveLength(1);
    const stored = await db.prisma.checkoutSession.findFirstOrThrow();
    expect(stored.status).toBe('rejected');
    expect(stored.statusReason).toBe(CHECKOUT_STATUS_REASONS.providerUnavailable);
    expect(await db.prisma.scan.count()).toBe(0);
  });

  // Creem echoes the product on the created checkout. A catalogue entry that
  // disagrees with the tariff — the wrong price or a non-USD currency — is
  // refused here, before a card is charged, not by the webhook after it.
  it('refuses a checkout whose expanded product is not priced at the tariff', async () => {
    for (const product of [
      { id: 'prod_basic', price: 100, currency: 'USD' },
      { id: 'prod_basic', price: 5500, currency: 'EUR' },
      { id: 'prod_other', price: 5500, currency: 'USD' },
    ]) {
      const calls: StubCall[] = [];
      const app = buildApp({
        fetchImpl: stubCreem({ body: { ...pendingCheckout('ch_price'), product } }, calls),
      });
      const label = `${product.id}/${product.price}/${product.currency}`;
      const { agent, cookie, profileId } = await signIn(
        app,
        `${label.replace(/\W/g, '')}@example.com`,
      );
      const failed = await agent
        .post('/billing/checkout-session')
        .set('Cookie', cookie)
        .send({ siteProfileId: profileId, plan: 'Basic', scope: SCOPE });
      expect(failed.status, label).toBe(502);
      expect(failed.body.error.code, label).toBe('CREEM_API');
      expect(failed.body.error.message, label).toBe('Paid checkout is temporarily unavailable');
    }
    expect(await db.prisma.checkoutSession.count({ where: { status: 'rejected' } })).toBe(3);

    // The product at the tariff, expanded, is what a working catalogue answers.
    const app = buildApp({
      fetchImpl: stubCreem(
        {
          body: {
            ...pendingCheckout('ch_priced'),
            product: { id: 'prod_basic', price: 5500, currency: 'usd' },
          },
        },
        [],
      ),
    });
    const { agent, cookie, profileId } = await signIn(app, 'priced-right@example.com');
    const created = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .send({ siteProfileId: profileId, plan: 'Basic', scope: SCOPE });
    expect(created.status).toBe(201);
  });

  it('refuses a checkout that dropped the reference or is not pending', async () => {
    for (const answer of [
      pendingCheckout('ch_other_ref', 'frcs_somebody_else'),
      { ...pendingCheckout('ch_done'), status: 'completed' },
    ]) {
      const app = buildApp({ fetchImpl: stubCreem({ body: answer }, []) });
      const { agent, cookie, profileId } = await signIn(app, `${answer.id as string}@example.com`);
      const failed = await agent
        .post('/billing/checkout-session')
        .set('Cookie', cookie)
        .send({ siteProfileId: profileId, plan: 'Basic', scope: SCOPE });
      expect(failed.status, answer.id as string).toBe(502);
      expect(failed.body.error.code).toBe('CREEM_API');
    }
    expect(await db.prisma.checkoutSession.count({ where: { status: 'rejected' } })).toBe(2);
  });

  it('refuses a plan this deployment has no Creem product for, before calling Creem', async () => {
    const calls: StubCall[] = [];
    const app = buildApp({ fetchImpl: stubCreem({ body: pendingCheckout('ch_never') }, calls) });
    const { agent, cookie, profileId } = await signIn(app, 'noproduct@example.com');
    const refused = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .send({ siteProfileId: profileId, plan: 'WebsiteAudit', scope: SCOPE });

    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('PLAN_NOT_AVAILABLE');
    expect(JSON.stringify(refused.body)).not.toContain('CREEM_');
    expect(calls).toHaveLength(0);
    expect(await db.prisma.checkoutSession.count()).toBe(0);
  });

  it('refuses another account profile and a scope beyond the plan limit', async () => {
    const calls: StubCall[] = [];
    const app = buildApp({ fetchImpl: stubCreem({ body: pendingCheckout('ch_guard') }, calls) });
    const owner = await signIn(app, 'owner@example.com');
    const stranger = await signIn(app, 'stranger@example.com');

    const foreign = await stranger.agent
      .post('/billing/checkout-session')
      .set('Cookie', stranger.cookie)
      .send({ siteProfileId: owner.profileId, plan: 'Basic', scope: SCOPE });
    expect(foreign.status).toBe(404);

    const tooWide = await owner.agent
      .post('/billing/checkout-session')
      .set('Cookie', owner.cookie)
      .send({
        siteProfileId: owner.profileId,
        plan: 'Basic',
        scope: { ...SCOPE, maxPages: 20_000 },
      });
    expect(tooWide.status).toBe(400);
    expect(tooWide.body.error.code).toBe('VALIDATION');
    expect(tooWide.body.error.message).toContain('maxPages exceeds the Basic plan limit');
    expect(calls).toHaveLength(0);
    expect(await db.prisma.checkoutSession.count()).toBe(0);
  });

  it('refuses a checkout that names an opt-in recipient this deployment cannot serve', async () => {
    const calls: StubCall[] = [];
    const app = buildApp({
      optInAiProviders: ['perplexity'],
      fetchImpl: stubCreem({ body: pendingCheckout('ch_optin') }, calls),
    });
    const { agent, cookie, profileId } = await signIn(app, 'optin@example.com');
    const config = await agent.get('/billing/checkout-config').set('Cookie', cookie);
    expect(config.body.data.optInAiProviders).toEqual(['perplexity']);

    const refused = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .send({
        siteProfileId: profileId,
        plan: 'Complete',
        scope: SCOPE,
        aiConsent: {
          providers: ['anthropic', 'openai', 'google'],
          noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
        },
      });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('VALIDATION');
    expect(refused.body.error.message).toContain('google');
    expect(calls).toHaveLength(0);
    expect(await db.prisma.checkoutSession.count()).toBe(0);
  });

  // The reachability gate itself is covered function-by-function in
  // CREEM-008; these three pin that the same refusals reach the browser
  // through the actual HTTP route, not just the function CREEM-008 calls
  // directly.
  it('refuses a site that has never been checked, over HTTP, and opens no session', async () => {
    const app = buildApp();
    const { agent, cookie, profileId } = await signIn(app, 'unchecked@example.com', {
      reachable: false,
    });

    const response = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .send({ siteProfileId: profileId, plan: 'Complete', scope: SCOPE });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('SITE_NOT_READY');
    expect(await db.prisma.checkoutSession.count()).toBe(0);
  });

  it('does not take the browser’s word for it', async () => {
    const app = buildApp();
    const { agent, cookie, accountId, profileId } = await signIn(app, 'liar@example.com', {
      reachable: false,
    });
    await db.prisma.siteReachabilityProbe.create({
      data: {
        accountId,
        siteProfileId: profileId,
        origin: `https://${'liar'}.example.com`,
        egressLocation: null,
        state: 'access-denied',
        checkedAt: new Date(),
      },
    });

    // A manipulated client claiming the check passed changes nothing: the
    // server reads its own row and never looks at the request for this.
    const response = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .send({
        siteProfileId: profileId,
        plan: 'Complete',
        scope: SCOPE,
        reachability: { state: 'reachable' },
      });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('SITE_NOT_READY');
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

    // A healthy default (kyiv) alongside frankfurt, keyed on the probed proxy's
    // host: a monitor with only frankfurt would let a dropped `egressLocation`
    // fall back to the monitor's default and still land on frankfurt, so the
    // route silently forwarding no country would go unnoticed.
    function twoCountries(frankfurtUp: boolean): EgressLocationMonitor {
      return createEgressLocationMonitor({
        locations: [kyiv, frankfurt],
        logger: silentLogger,
        probe: async (proxy) => ({
          state: proxy?.host === frankfurt.proxy.host && !frankfurtUp ? 'unreachable' : 'healthy',
          observedIp: null,
          expectedIp: null,
          latencyMs: 10,
          detail: null,
          checkedAt: new Date(),
        }),
      });
    }

    it('sells a scan from the country the site was checked from, and records it', async () => {
      const app = buildApp({
        egress: twoCountries(true),
        fetchImpl: stubCreem({ body: pendingCheckout('ch_de') }, []),
      });
      const { agent, cookie, accountId, profileId } = await signIn(app, 'de-site@example.com', {
        reachable: false,
      });
      await db.prisma.siteReachabilityProbe.create({
        data: {
          accountId,
          siteProfileId: profileId,
          origin: `https://${'de-site'}.example.com`,
          egressLocation: 'de',
          state: 'reachable',
          checkedAt: new Date(),
        },
      });

      const response = await agent
        .post('/billing/checkout-session')
        .set('Cookie', cookie)
        .send({
          siteProfileId: profileId,
          plan: 'Complete',
          scope: { ...SCOPE, egressLocation: 'de' },
        });

      expect(response.status).toBe(201);
      const row = await db.prisma.checkoutSession.findFirstOrThrow();
      expect(JSON.parse(row.scopeJson)).toMatchObject({ egressLocation: 'de' });
      expect(JSON.parse(row.executionConfigJson ?? '{}')).toMatchObject({
        scope: { egressLocation: 'de' },
      });
    });

    it('opens no checkout for a country whose egress network is down', async () => {
      const app = buildApp({ egress: twoCountries(false) });
      const { agent, cookie, accountId, profileId } = await signIn(app, 'downstream@example.com', {
        reachable: false,
      });
      await db.prisma.siteReachabilityProbe.create({
        data: {
          accountId,
          siteProfileId: profileId,
          origin: `https://${'downstream'}.example.com`,
          egressLocation: 'de',
          state: 'reachable',
          checkedAt: new Date(),
        },
      });

      const response = await agent
        .post('/billing/checkout-session')
        .set('Cookie', cookie)
        .send({
          siteProfileId: profileId,
          plan: 'Complete',
          scope: { ...SCOPE, egressLocation: 'de' },
        });

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('EGRESS_LOCATION_UNAVAILABLE');
      expect(await db.prisma.checkoutSession.count()).toBe(0);
    });
  });
});
