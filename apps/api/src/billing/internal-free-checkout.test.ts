import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../index.ts';
import { silentLogger } from '../http/logger.ts';
import { createTestDb, type TestDb } from '../test-utils/test-db.ts';

// Who may run a paid plan without paying.
//
// Since D-229 `POST /billing/dev-checkout` is the only way to a Basic/Complete
// scan that does not go through a signed FastSpring order, and the one thing in
// front of it is the FLUXRADAR_INTERNAL_FREE_EMAILS allowlist. An account the
// allowlist does not name must be refused and leave nothing behind — no scan,
// no purchase, no entitlement — whatever NODE_ENV says: the rule it replaced was
// a NODE_ENV check, which a deployment that never set the variable got wrong.

const INTERNAL_EMAIL = 'internal@fluxradar.test';
const OUTSIDER_EMAIL = 'buyer@example.com';

describe('internal free checkout access', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.cleanup();
  });

  async function devCheckout(email: string, internalFreeEmails?: ReadonlySet<string>) {
    const app = createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
      ...(internalFreeEmails === undefined ? {} : { internalFreeEmails }),
    });
    const agent = request.agent(app);
    const registered = await agent
      .post('/auth/register')
      .send({ email, password: 'correct-horse-1' });
    expect(registered.status).toBe(201);
    // Set by hand: a production session cookie is Secure, and supertest speaks http.
    const cookie = registered.headers['set-cookie']?.[0]?.split(';', 1)[0] ?? '';
    const profile = await agent
      .post('/profiles')
      .set('Cookie', cookie)
      .send({ name: 'Fixture Site', domain: 'https://buyer.example.com' });
    expect(profile.status).toBe(201);
    return agent
      .post('/billing/dev-checkout')
      .set('Cookie', cookie)
      .send({
        siteProfileId: profile.body.data.id,
        plan: 'Complete',
        scope: { includeSubdomains: false, maxPages: 15 },
      });
  }

  async function paidRecords() {
    return {
      scans: await db.prisma.scan.count(),
      purchases: await db.prisma.purchase.count(),
      entitlements: await db.prisma.entitlement.count(),
    };
  }

  it.each(['production', 'development', 'test'])(
    'refuses an account the allowlist does not name, with NODE_ENV=%s',
    async (nodeEnv) => {
      vi.stubEnv('NODE_ENV', nodeEnv);

      const response = await devCheckout(OUTSIDER_EMAIL, new Set([INTERNAL_EMAIL]));

      expect(response.status).toBe(402);
      expect(response.body.error.code).toBe('PAYMENT_REQUIRED');
      expect(await paidRecords()).toEqual({ scans: 0, purchases: 0, entitlements: 0 });
    },
  );

  // Fails closed: a deployment that never set the variable has no internal account.
  it('refuses every account when the allowlist is unset', async () => {
    vi.stubEnv('FLUXRADAR_INTERNAL_FREE_EMAILS', undefined);

    const response = await devCheckout(INTERNAL_EMAIL);

    expect(response.status).toBe(402);
    expect(await paidRecords()).toEqual({ scans: 0, purchases: 0, entitlements: 0 });
  });

  // The control: the refusals above are the allowlist's, not a broken fixture's.
  it('runs the plan for the named account, still without a purchase', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = await devCheckout(INTERNAL_EMAIL, new Set([INTERNAL_EMAIL]));

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ billing: 'internal-free', plan: 'Complete' });
    expect(await paidRecords()).toEqual({ scans: 1, purchases: 0, entitlements: 0 });
  });
});
