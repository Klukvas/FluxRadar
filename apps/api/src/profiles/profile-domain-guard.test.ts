import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../index.ts';
import { silentLogger } from '../http/logger.ts';
import { CHECKOUT_SESSION_STATUSES } from '../billing/constants.ts';
import { FASTSPRING_PROVIDER } from '../billing/fastspring/index.ts';
import { createTestDb, type TestDb } from '../test-utils/test-db.ts';

// Domain ownership for paid scans.
//
// A paid scan is bound server-side to the buyer's own account and to a profile
// that account owns, and the scan's domain is read from that profile when the
// signed provider webhook lands — minutes after the buyer authorised the
// payment. The profile's domain was editable in that window, so the audit that
// was paid for and the audit that ran could be of two different sites, with only
// the second recorded anywhere.
//
// That window is what these tests close. Verifying that the buyer actually
// controls the domain (DNS TXT, a hosted file, a Search Console grant) is a
// separate product with its own UX and is deliberately NOT attempted here; see
// docs/DECISIONS.md.

const PASSWORD = 'sufficiently-long-password';

describe('site profile domain guard', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  async function seedAccountWithProfile() {
    const app = createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const registered = await agent
      .post('/auth/register')
      .send({ email: 'owner@example.com', password: PASSWORD });
    const profile = await agent
      .post('/profiles')
      .send({ name: 'Site', domain: 'https://owned.example.com' });
    return {
      agent,
      accountId: registered.body.data.accountId as string,
      profileId: profile.body.data.id as string,
    };
  }

  async function openCheckout(
    accountId: string,
    siteProfileId: string,
    expiresAt: Date | null,
  ): Promise<void> {
    await db.prisma.checkoutSession.create({
      data: {
        provider: FASTSPRING_PROVIDER,
        reference: `frcs_${siteProfileId}`,
        accountId,
        siteProfileId,
        plan: 'Complete',
        productPath: 'complete-audit',
        expectedAmountUsd: 199,
        liveMode: false,
        status: CHECKOUT_SESSION_STATUSES.created,
        scopeJson: JSON.stringify({ includeSubdomains: false }),
        expiresAt,
      },
    });
  }

  it('changes the domain freely when no payment is in flight', async () => {
    const { agent, profileId } = await seedAccountWithProfile();

    const response = await agent
      .patch(`/profiles/${profileId}`)
      .send({ domain: 'https://renamed.example.com' });

    expect(response.status).toBe(200);
    expect(response.body.data.domain).toBe('https://renamed.example.com');
  });

  it('refuses to move the domain while a checkout can still be paid', async () => {
    const { agent, accountId, profileId } = await seedAccountWithProfile();
    await openCheckout(accountId, profileId, new Date(Date.now() + 60 * 60 * 1000));

    const response = await agent
      .patch(`/profiles/${profileId}`)
      .send({ domain: 'https://victim.example.com' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PROFILE_HAS_OPEN_CHECKOUT');
    expect(
      (await db.prisma.siteProfile.findUniqueOrThrow({ where: { id: profileId } })).domain,
    ).toBe('https://owned.example.com');
  });

  // Blocking the domain must not freeze the whole profile: the label a customer
  // put on their own workspace has nothing to do with what was purchased.
  it('still accepts the other fields during a checkout', async () => {
    const { agent, accountId, profileId } = await seedAccountWithProfile();
    await openCheckout(accountId, profileId, new Date(Date.now() + 60 * 60 * 1000));

    const response = await agent
      .patch(`/profiles/${profileId}`)
      .send({ name: 'Renamed workspace', region: 'EU' });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('Renamed workspace');
  });

  // Sending the domain it already has is not a change and must not be refused —
  // a client that PATCHes the whole object would otherwise be stuck.
  it('accepts a no-op domain during a checkout', async () => {
    const { agent, accountId, profileId } = await seedAccountWithProfile();
    await openCheckout(accountId, profileId, new Date(Date.now() + 60 * 60 * 1000));

    const response = await agent
      .patch(`/profiles/${profileId}`)
      .send({ domain: 'https://owned.example.com', name: 'Same domain' });

    expect(response.status).toBe(200);
  });

  // An abandoned tab binds nothing chargeable. It must not make the domain
  // permanently unchangeable — the same reasoning as the deletion guard.
  it('releases the domain once the checkout deadline has passed', async () => {
    const { agent, accountId, profileId } = await seedAccountWithProfile();
    await openCheckout(accountId, profileId, new Date(Date.now() - 60 * 60 * 1000));

    const response = await agent
      .patch(`/profiles/${profileId}`)
      .send({ domain: 'https://renamed.example.com' });

    expect(response.status).toBe(200);
  });

  it('does not let one account freeze or read another account profile', async () => {
    const { accountId, profileId } = await seedAccountWithProfile();
    await openCheckout(accountId, profileId, new Date(Date.now() + 60 * 60 * 1000));
    const app = createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
    });
    const stranger = request.agent(app);
    await stranger.post('/auth/register').send({ email: 'other@example.com', password: PASSWORD });

    const response = await stranger
      .patch(`/profiles/${profileId}`)
      .send({ domain: 'https://taken.example.com' });

    // A foreign profile stays indistinguishable from one that does not exist.
    expect(response.status).toBe(404);
  });
});
