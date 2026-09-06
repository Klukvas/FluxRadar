import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../index.ts';
import { silentLogger, type ApiLogger } from '../../http/logger.ts';
import { createTestDb, TEST_WEBHOOK_SECRET, type TestDb } from '../../test-utils/test-db.ts';
import { readFastSpringConfig, type FastSpringConfigResult } from './config.ts';
import type { FetchLike } from './client.ts';
import {
  TEST_FASTSPRING_SECRET,
  orderCompletedData,
  returnCreatedData,
  signedDelivery,
} from './test-payloads.ts';

// FASTSPRING-004: the HTTP surface of the checkout.
//
// Everything below runs against supertest with a stubbed FastSpring fetch, so no
// credentials, no network and no real payment are involved. What it pins down:
// the endpoint requires a session, refuses another account's profile, fails
// closed when the provider is not configured, surfaces a provider error as a
// gateway error, and — most importantly — creates NO scan until a signed webhook
// arrives.

const CONFIG_ENV = {
  FASTSPRING_MODE: 'test',
  FASTSPRING_API_USERNAME: 'api-user',
  FASTSPRING_API_PASSWORD: 'api-password-value',
  FASTSPRING_WEBHOOK_SECRET: TEST_FASTSPRING_SECRET,
  FASTSPRING_STOREFRONT_URL: 'https://fluxradar.test.onfastspring.com',
  FASTSPRING_PRODUCT_PATH_BASIC: 'fluxradar-basic-scan',
  FASTSPRING_PRODUCT_PATH_COMPLETE: 'fluxradar-complete-scan',
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

function configured(): FastSpringConfigResult {
  return readFastSpringConfig(CONFIG_ENV);
}

interface StubCall {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

function stubFastSpring(
  response: { status?: number; body: unknown },
  calls: StubCall[],
): FetchLike {
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

describe('FASTSPRING-004 checkout HTTP surface', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  function buildApp(
    options: {
      fastSpring?: FastSpringConfigResult;
      fetchImpl?: FetchLike;
      logger?: ApiLogger;
    } = {},
  ) {
    return createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: options.logger ?? silentLogger,
      fastSpring: options.fastSpring ?? configured(),
      ...(options.fetchImpl !== undefined ? { fastSpringFetch: options.fetchImpl } : {}),
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
    return { agent, cookie, profileId: profile.body.data.id as string };
  }

  it('requires a session for every checkout endpoint', async () => {
    const app = buildApp();
    expect((await request(app).get('/billing/checkout-config')).status).toBe(401);
    expect(
      (await request(app).post('/billing/checkout-session').send({ plan: 'Basic' })).status,
    ).toBe(401);
    expect((await request(app).get('/billing/checkout-session/frcs_x')).status).toBe(401);
  });

  it('reports an unavailable checkout instead of pretending, when unconfigured', async () => {
    const app = buildApp({ fastSpring: { state: 'not_configured' } });
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
    expect(await db.prisma.scan.count()).toBe(0);
  });

  // A half-configured provider is an operator's problem. Which FASTSPRING_*
  // variables are absent describes how this deployment is wired — a map for
  // anyone probing the checkout, and meaningless to the buyer — so it belongs in
  // the log and nowhere else. Neither endpoint may name one.
  it('fails closed on a partial configuration without naming a variable to the client', async () => {
    const { logger, lines } = recordingLogger();
    const partial = readFastSpringConfig({
      FASTSPRING_MODE: 'live',
      FASTSPRING_API_PASSWORD: 'super-secret-value',
    });
    const app = buildApp({ fastSpring: partial, logger });
    const { agent, cookie, profileId } = await signIn(app, 'partial@example.com');

    const config = await agent.get('/billing/checkout-config').set('Cookie', cookie);
    expect(config.status).toBe(200);
    expect(config.body.data.available).toBe(false);
    // A closed machine state, not the reason string the config layer built.
    expect(config.body.data.unavailableReason).toBe('misconfigured');
    expect(JSON.stringify(config.body)).not.toContain('FASTSPRING_');

    const attempt = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .send({ siteProfileId: profileId, plan: 'Basic', scope: SCOPE });
    expect(attempt.status).toBe(503);
    expect(attempt.body.error.code).toBe('BILLING_UNAVAILABLE');
    expect(JSON.stringify(attempt.body)).not.toContain('FASTSPRING_');
    expect(attempt.body.error.message).not.toContain('super-secret-value');
    expect(await db.prisma.scan.count()).toBe(0);

    // ...and the operator still gets the names, on the server side only.
    const logged = JSON.stringify(lines);
    expect(logged).toContain('FASTSPRING_API_USERNAME');
    expect(logged).not.toContain('super-secret-value');
  });

  it('logs the missing variable names once at startup, values never', async () => {
    const { logger, lines } = recordingLogger();
    buildApp({
      fastSpring: readFastSpringConfig({
        FASTSPRING_MODE: 'live',
        FASTSPRING_API_PASSWORD: 'super-secret-value',
      }),
      logger,
    });
    const startup = lines.find((line) => line.message.startsWith('paid checkout disabled'));
    expect(startup?.level).toBe('error');
    expect(startup?.context.missing).toContain('FASTSPRING_API_USERNAME');
    expect(JSON.stringify(startup)).not.toContain('super-secret-value');
  });

  it('states that paid checkout is off when nothing is configured', async () => {
    const { logger, lines } = recordingLogger();
    buildApp({ fastSpring: { state: 'not_configured' }, logger });
    expect(
      lines.some(
        (line) =>
          line.level === 'info' &&
          line.message === 'paid checkout disabled: provider is not configured',
      ),
    ).toBe(true);
  });

  it('creates a server-bound session, returns only a URL, and grants nothing yet', async () => {
    const calls: StubCall[] = [];
    const app = buildApp({
      fetchImpl: stubFastSpring(
        { body: { id: 'sess_abc123', currency: 'USD', subtotal: 55, expires: 1767225600000 } },
        calls,
      ),
    });
    const { agent, cookie, profileId } = await signIn(app, 'buyer@example.com');

    const created = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .send({
        siteProfileId: profileId,
        plan: 'Basic',
        scope: SCOPE,
        aiConsent: { providers: ['anthropic'], noticeVersion: 'v1' },
      });
    expect(created.status).toBe(201);
    expect(created.body.data.checkoutUrl).toBe(
      'https://fluxradar.test.onfastspring.com/session/sess_abc123',
    );
    expect(created.body.data.sessionId).toBe('sess_abc123');
    expect(created.body.data.mode).toBe('test');
    // The browser learns nothing about credentials or internal ids.
    expect(JSON.stringify(created.body)).not.toContain('api-password-value');
    expect(JSON.stringify(created.body)).not.toContain('scanId');

    // The provider call carried Basic auth and the reference, and only that.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.fastspring.com/sessions');
    expect(calls[0]?.headers['Authorization']).toBe(
      `Basic ${Buffer.from('api-user:api-password-value').toString('base64')}`,
    );
    const body = calls[0]?.body as { tags: Record<string, string>; items: { product: string }[] };
    expect(body.items[0]?.product).toBe('fluxradar-basic-scan');
    expect(Object.values(body.tags)).toContain(created.body.data.reference as string);

    // No payment yet: no purchase, no entitlement, no scan.
    expect(await db.prisma.purchase.count()).toBe(0);
    expect(await db.prisma.scan.count()).toBe(0);
    const status = await agent
      .get(`/billing/checkout-session/${created.body.data.reference as string}`)
      .set('Cookie', cookie);
    expect(status.status).toBe(200);
    expect(status.body.data.status).toBe('created');
    expect(status.body.data.scanId).toBeNull();
  });

  it('turns the pending session into a scan only after the signed webhook lands', async () => {
    const calls: StubCall[] = [];
    const app = buildApp({
      fetchImpl: stubFastSpring(
        { body: { id: 'sess_flow', currency: 'USD', subtotal: 55 } },
        calls,
      ),
    });
    const { agent, cookie, profileId } = await signIn(app, 'flow@example.com');
    const created = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .send({ siteProfileId: profileId, plan: 'Basic', scope: SCOPE });
    const reference = created.body.data.reference as string;

    const { rawBody, signature } = signedDelivery([
      {
        id: 'evt_http_paid',
        type: 'order.completed',
        data: orderCompletedData({
          orderId: 'ord_http_paid',
          reference,
          productPath: 'fluxradar-basic-scan',
          amount: 55,
        }),
      },
    ]);
    const delivered = await request(app)
      .post('/webhooks/fastspring')
      .set('Content-Type', 'application/json')
      .set('X-FS-Signature', signature)
      .send(rawBody);
    expect(delivered.status).toBe(200);
    expect(delivered.body.data.results[0].outcome).toBe('processed');

    const status = await agent.get(`/billing/checkout-session/${reference}`).set('Cookie', cookie);
    expect(status.body.data.status).toBe('completed');
    expect(status.body.data.scanId).toEqual(expect.any(String));

    const scan = await agent
      .get(`/scans/${status.body.data.scanId as string}`)
      .set('Cookie', cookie);
    expect(scan.status).toBe(200);
    expect(scan.body.data.plan).toBe('Basic');
    expect(scan.body.data.scope.maxPages).toBe(25);
  });

  // A refund whose order has not arrived is accepted and stored, not acted on.
  // 202 says exactly that, and stays a 2xx so FastSpring does not retry a
  // delivery that would find the same missing order: the stored event is
  // replayed the moment its order.completed lands.
  it('answers 202 for a delivery whose refund has no order yet', async () => {
    const app = buildApp();
    const { rawBody, signature } = signedDelivery([
      {
        id: 'evt_http_pending_return',
        type: 'return.created',
        data: returnCreatedData('ord_http_unknown', 55),
      },
    ]);

    const delivered = await request(app)
      .post('/webhooks/fastspring')
      .set('Content-Type', 'application/json')
      .set('X-FS-Signature', signature)
      .send(rawBody);

    expect(delivered.status).toBe(202);
    expect(delivered.body.data.results[0].outcome).toBe('unlinked');
    expect(await db.prisma.purchase.count()).toBe(0);
  });

  it('answers 400 for an unsigned webhook and creates nothing', async () => {
    const app = buildApp();
    const { rawBody } = signedDelivery([
      {
        id: 'evt_unsigned',
        type: 'order.completed',
        data: orderCompletedData({
          orderId: 'ord_unsigned',
          reference: 'frcs_x',
          productPath: 'fluxradar-basic-scan',
          amount: 55,
        }),
      },
    ]);
    const response = await request(app)
      .post('/webhooks/fastspring')
      .set('Content-Type', 'application/json')
      .set('X-FS-Signature', 'forged')
      .send(rawBody);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_SIGNATURE');
    expect(await db.prisma.webhookEvent.count()).toBe(0);
  });

  it('refuses another account profile and a scope beyond the plan limit', async () => {
    const calls: StubCall[] = [];
    const app = buildApp({
      fetchImpl: stubFastSpring(
        { body: { id: 'sess_guard', currency: 'USD', subtotal: 55 } },
        calls,
      ),
    });
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
        scope: { ...SCOPE, maxPages: 999_999 },
      });
    expect(tooWide.status).toBe(400);
    expect(calls).toHaveLength(0);
    expect(await db.prisma.checkoutSession.count()).toBe(0);
  });

  it('maps a FastSpring failure to a gateway error without leaking credentials', async () => {
    const errorLog = vi.fn();
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: { info: vi.fn(), warn: vi.fn(), error: errorLog },
      fastSpring: configured(),
      fastSpringFetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ message: 'invalid product path' }), { status: 400 }),
        ),
    });
    const { agent, cookie, profileId } = await signIn(app, 'apierror@example.com');
    const failed = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .send({ siteProfileId: profileId, plan: 'Complete', scope: SCOPE });

    expect(failed.status).toBe(502);
    expect(failed.body.error.code).toBe('FASTSPRING_API');
    expect(JSON.stringify(failed.body)).not.toContain('api-password-value');
    // FastSpring's own words describe our catalogue wiring and can echo the
    // request back, so they stay on the server; the buyer gets a sentence about
    // their checkout, and the operator gets the provider's message in the log.
    expect(JSON.stringify(failed.body)).not.toContain('invalid product path');
    expect(JSON.stringify(errorLog.mock.calls)).toContain('invalid product path');
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('api-password-value');
    expect(await db.prisma.scan.count()).toBe(0);
  });

  // Rejected API credentials are a deployment fact, not a payment fact. Telling
  // a buyer which of our provider settings is wrong describes the setup and
  // gives them nothing to act on.
  it('does not tell the buyer that the provider rejected our credentials', async () => {
    const errorLog = vi.fn();
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: { info: vi.fn(), warn: vi.fn(), error: errorLog },
      fastSpring: configured(),
      fastSpringFetch: () => Promise.resolve(new Response('{}', { status: 401 })),
    });
    const { agent, cookie, profileId } = await signIn(app, 'badcreds@example.com');
    const failed = await agent
      .post('/billing/checkout-session')
      .set('Cookie', cookie)
      .send({ siteProfileId: profileId, plan: 'Basic', scope: SCOPE });

    expect(failed.status).toBe(502);
    expect(failed.body.error.message).toBe('Paid checkout is temporarily unavailable');
    expect(JSON.stringify(failed.body)).not.toContain('credential');
    expect(JSON.stringify(errorLog.mock.calls)).toContain('credentials');
    expect(await db.prisma.scan.count()).toBe(0);
  });
});
