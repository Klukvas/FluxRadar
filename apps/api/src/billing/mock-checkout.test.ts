import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../index.ts';
import { silentLogger } from '../http/logger.ts';
import { createTestDb, type TestDb, TEST_WEBHOOK_SECRET } from '../test-utils/test-db.ts';
import { isMockCheckoutEnabled } from './mock-checkout.ts';

// Who may obtain a paid scan without paying, and on what.
//
// The rule used to be `NODE_ENV !== 'production'`, which reads as "off in
// production" but really means "on everywhere the variable is not literally the
// string production". These tests state the replacement: an explicit opt-in for
// the mock surface, and the named-account allowlist that is independent of both.

const PASSWORD = 'sufficiently-long-password';
const INTERNAL_EMAIL = 'internal@fluxradar.test';

describe('mock checkout flag', () => {
  it('is on only for an explicit true', () => {
    expect(isMockCheckoutEnabled({ FLUXRADAR_ENABLE_MOCK_CHECKOUT: 'true' })).toBe(true);
    expect(isMockCheckoutEnabled({ FLUXRADAR_ENABLE_MOCK_CHECKOUT: ' TRUE ' })).toBe(true);
  });

  it.each([
    ['unset', {}],
    ['empty', { FLUXRADAR_ENABLE_MOCK_CHECKOUT: '' }],
    ['a near miss', { FLUXRADAR_ENABLE_MOCK_CHECKOUT: '1' }],
    ['a friendly yes', { FLUXRADAR_ENABLE_MOCK_CHECKOUT: 'yes' }],
    ['a typo', { FLUXRADAR_ENABLE_MOCK_CHECKOUT: 'ture' }],
  ])('is off for %s', (_case, env) => {
    expect(isMockCheckoutEnabled(env)).toBe(false);
  });

  // The point of the change: a deployment that never set NODE_ENV must not get
  // the free path by accident.
  it('does not read NODE_ENV at all', () => {
    expect(isMockCheckoutEnabled({ NODE_ENV: 'development' })).toBe(false);
    expect(isMockCheckoutEnabled({ NODE_ENV: 'staging' })).toBe(false);
    expect(isMockCheckoutEnabled({ NODE_ENV: 'test' })).toBe(false);
  });
});

describe('paid access without a payment', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  async function checkout(options: {
    readonly email: string;
    readonly mockCheckoutEnabled: boolean;
    readonly internalFreeEmails?: ReadonlySet<string>;
  }) {
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
      mockCheckoutEnabled: options.mockCheckoutEnabled,
      internalFreeEmails: options.internalFreeEmails ?? new Set(),
    });
    const agent = request.agent(app);
    await agent.post('/auth/register').send({ email: options.email, password: PASSWORD });
    const profile = await agent
      .post('/profiles')
      .send({ name: 'Site', domain: `https://${options.email.split('@')[0]}.example.com` });
    const response = await agent.post('/billing/dev-checkout').send({
      siteProfileId: profile.body.data.id,
      plan: 'Complete',
      scope: { includeSubdomains: false, maxPages: 15 },
    });
    return { agent, app, response };
  }

  it('refuses an ordinary account when the mock surface is off', async () => {
    const { response } = await checkout({
      email: 'buyer@example.com',
      mockCheckoutEnabled: false,
    });

    expect(response.status).toBe(402);
    expect(response.body.error.code).toBe('PAYMENT_REQUIRED');
    expect(await db.prisma.purchase.count()).toBe(0);
    expect(await db.prisma.scan.count()).toBe(0);
  });

  it('mints a simulated purchase only where the mock surface was asked for', async () => {
    const { response } = await checkout({
      email: 'buyer@example.com',
      mockCheckoutEnabled: true,
    });

    expect(response.status).toBe(201);
    expect(await db.prisma.purchase.count()).toBe(1);
  });

  // The allowlist is a production feature and stands on its own: it does not
  // need the mock surface, and turning the mock surface off does not touch it.
  it('keeps the internal allowlist working with the mock surface off', async () => {
    const { response } = await checkout({
      email: INTERNAL_EMAIL,
      mockCheckoutEnabled: false,
      internalFreeEmails: new Set([INTERNAL_EMAIL]),
    });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      billing: 'internal-free',
      plan: 'Complete',
      purchaseId: null,
      entitlementId: null,
    });
    expect(await db.prisma.purchase.count()).toBe(0);
    expect(await db.prisma.scan.count({ where: { plan: 'Complete' } })).toBe(1);
  });

  it('grants nothing to an account that is not on the allowlist', async () => {
    const { response } = await checkout({
      email: 'nearly@example.com',
      mockCheckoutEnabled: false,
      internalFreeEmails: new Set([INTERNAL_EMAIL]),
    });

    expect(response.status).toBe(402);
  });

  // The MockPaddle webhook is the same free path from the outside; it must be
  // absent, not merely unusable, wherever the mock surface is off.
  it('does not mount the mock webhook when the mock surface is off', async () => {
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
      mockCheckoutEnabled: false,
    });

    const response = await request(app)
      .post('/webhooks/paddle')
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('mounts the mock webhook where the mock surface is on', async () => {
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
      mockCheckoutEnabled: true,
    });

    const response = await request(app)
      .post('/webhooks/paddle')
      .set('Content-Type', 'application/json')
      .send('{}');

    // Reached the handler: it rejects the unsigned body rather than the route.
    expect(response.status).not.toBe(404);
  });
});
