import { randomUUID } from 'node:crypto';

import { RULESET_VERSION } from '@fluxradar/contracts';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SESSION_COOKIE_NAME, createSession } from '../auth/sessions.ts';
import { silentLogger } from '../http/logger.ts';
import { createApp } from '../index.ts';
import { createTestDb, type TestDb } from '../test-utils/test-db.ts';
import { ADMIN_EMAILS_ENV } from './admin-emails.ts';

// GET /admin/stats: the owner dashboard.
//
// Two things are pinned. To anyone who is not a confirmed admin the route must
// be indistinguishable from one that does not exist — byte for byte the answer
// an unknown path gets, and before `days` is even read. And for the admin, the
// numbers must be the ones the tables hold: per UTC day, per currency, with
// test-mode orders kept out of the money.
//
// Every seeded row is younger than the shortest retention period and every open
// checkout has a future deadline, so the retention sweep createApp starts in
// the background has nothing to remove or relabel while a test reads.

const NOW = new Date('2026-09-21T15:00:00.000Z');
const ADMIN_EMAIL = 'Owner@Example.com';

let db: TestDb;
const previousAdminEmails = process.env[ADMIN_EMAILS_ENV];

beforeEach(async () => {
  db = await createTestDb();
  delete process.env[ADMIN_EMAILS_ENV];
});

afterEach(async () => {
  await db.cleanup();
  if (previousAdminEmails === undefined) delete process.env[ADMIN_EMAILS_ENV];
  else process.env[ADMIN_EMAILS_ENV] = previousAdminEmails;
});

/** The app with an explicit admin list, or the production env read when none is given. */
function appFor(adminEmails?: ReadonlySet<string>) {
  return createApp({
    prisma: db.prisma,
    autoProcess: false,
    logger: silentLogger,
    now: () => NOW,
    supportChannel: null,
    ...(adminEmails === undefined ? {} : { adminEmails }),
  });
}

const ADMINS: ReadonlySet<string> = new Set(['owner@example.com']);

interface SeededOwner {
  readonly accountId: string;
  readonly siteProfileId: string;
  readonly cookie: string;
}

async function seedAccount(
  prisma: PrismaClient,
  options: { email: string; verified: boolean; createdAt: Date },
): Promise<SeededOwner> {
  const account = await prisma.account.create({
    data: {
      email: options.email,
      passwordHash: 'test-hash',
      emailVerifiedAt: options.verified ? options.createdAt : null,
      createdAt: options.createdAt,
    },
  });
  const profile = await prisma.siteProfile.create({
    data: { accountId: account.id, name: 'Site', domain: `https://${randomUUID()}.example` },
  });
  const session = await createSession(prisma, account.id, NOW);
  return {
    accountId: account.id,
    siteProfileId: profile.id,
    cookie: `${SESSION_COOKIE_NAME}=${session.token}`,
  };
}

const at = (iso: string): Date => new Date(iso);

/** What an unmounted path answers, to compare every refusal against. */
async function unknownRouteAnswer(app: ReturnType<typeof appFor>, cookie?: string) {
  const unknown = request(app).get('/admin/unknown-route');
  const response = await (cookie === undefined ? unknown : unknown.set('Cookie', cookie));
  return { status: response.status, body: response.body as unknown };
}

describe('GET /admin/stats access', () => {
  it('answers a visitor with no session exactly as an unknown route', async () => {
    const app = appFor(ADMINS);
    const response = await request(app).get('/admin/stats');

    expect({ status: response.status, body: response.body }).toEqual(await unknownRouteAnswer(app));
    expect(response.status).toBe(404);
  });

  it('answers a signed-in account that is not listed exactly as an unknown route', async () => {
    const stranger = await seedAccount(db.prisma, {
      email: 'someone@example.com',
      verified: true,
      createdAt: at('2026-09-20T10:00:00Z'),
    });
    const app = appFor(ADMINS);
    const response = await request(app).get('/admin/stats').set('Cookie', stranger.cookie);

    expect(response.status).toBe(404);
    expect(response.body).toEqual((await unknownRouteAnswer(app, stranger.cookie)).body);
  });

  it('does not tell a stranger that `days` was wrong: the 404 comes first', async () => {
    const stranger = await seedAccount(db.prisma, {
      email: 'someone@example.com',
      verified: true,
      createdAt: at('2026-09-20T10:00:00Z'),
    });
    const response = await request(appFor(ADMINS))
      .get('/admin/stats?days=14')
      .set('Cookie', stranger.cookie);

    expect(response.status).toBe(404);
  });

  it('is off for everyone, the admin included, when the variable is unset', async () => {
    const owner = await seedAccount(db.prisma, {
      email: ADMIN_EMAIL,
      verified: true,
      createdAt: at('2026-09-01T08:00:00Z'),
    });
    const response = await request(appFor()).get('/admin/stats').set('Cookie', owner.cookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('refuses a listed address that was never confirmed', async () => {
    const owner = await seedAccount(db.prisma, {
      email: ADMIN_EMAIL,
      verified: false,
      createdAt: at('2026-09-01T08:00:00Z'),
    });
    const response = await request(appFor(ADMINS)).get('/admin/stats').set('Cookie', owner.cookie);

    expect(response.status).toBe(404);
  });

  it('reads the list from FLUXRADAR_ADMIN_EMAILS, trimmed and case-insensitive', async () => {
    process.env[ADMIN_EMAILS_ENV] = ' OWNER@example.com , ';
    const owner = await seedAccount(db.prisma, {
      email: ADMIN_EMAIL,
      verified: true,
      createdAt: at('2026-09-01T08:00:00Z'),
    });
    const response = await request(appFor()).get('/admin/stats').set('Cookie', owner.cookie);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    // The default window.
    expect(response.body.data.window.days).toBe(30);
    expect(response.body.data.daily).toHaveLength(30);
  });

  it.each(['14', 'abc', '', '30.0', '07'])('rejects days=%j with the usual 400', async (days) => {
    const owner = await seedAccount(db.prisma, {
      email: ADMIN_EMAIL,
      verified: true,
      createdAt: at('2026-09-01T08:00:00Z'),
    });
    const response = await request(appFor(ADMINS))
      .get('/admin/stats')
      .query({ days })
      .set('Cookie', owner.cookie);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, error: { code: 'VALIDATION' } });
  });

  it('rejects a repeated days parameter', async () => {
    const owner = await seedAccount(db.prisma, {
      email: ADMIN_EMAIL,
      verified: true,
      createdAt: at('2026-09-01T08:00:00Z'),
    });
    const response = await request(appFor(ADMINS))
      .get('/admin/stats?days=7&days=30')
      .set('Cookie', owner.cookie);

    expect(response.status).toBe(400);
  });
});

describe('GET /admin/stats figures', () => {
  it('counts the window and all time from the tables, per currency and per UTC day', async () => {
    const owner = await seedBusiness(db.prisma);
    const response = await request(appFor(ADMINS))
      .get('/admin/stats?days=7')
      .set('Cookie', owner.cookie);

    expect(response.status).toBe(200);
    const { data } = response.body;
    expect(data.window).toEqual({
      days: 7,
      from: '2026-09-15T00:00:00.000Z',
      to: NOW.toISOString(),
    });

    expect(data.period).toEqual({
      accounts: { created: 3, verified: 2 },
      freeChecks: { claimed: 2 },
      scans: {
        created: 4,
        byStatus: [
          { status: 'Completed', count: 2 },
          { status: 'Failed', count: 1 },
          { status: 'Running', count: 1 },
        ],
        byPlan: [
          { plan: 'Complete', count: 2 },
          { plan: 'Basic', count: 1 },
          { plan: 'Free', count: 1 },
        ],
      },
      checkouts: { opened: 4, completed: 2, rejected: 1, conversion: 0.5 },
      purchases: {
        completed: 3,
        byStatus: [
          { status: 'paid', count: 2 },
          { status: 'Refunded', count: 1 },
        ],
      },
      revenue: [
        { currency: 'EUR', gross: 110.5, refunded: 110.5, net: 0 },
        { currency: 'USD', gross: 110, refunded: 20, net: 90 },
      ],
      refunds: { count: 3 },
      testMode: { checkoutsOpened: 2, purchases: 1 },
    });

    expect(data.allTime).toMatchObject({
      accounts: { created: 4, verified: 3 },
      freeChecks: { claimed: 3 },
      scans: { created: 5 },
      checkouts: { opened: 5, completed: 3, rejected: 1, conversion: 0.6 },
      purchases: { completed: 4 },
      revenue: [
        { currency: 'EUR', gross: 110.5, refunded: 110.5, net: 0 },
        { currency: 'USD', gross: 165, refunded: 20, net: 145 },
        { currency: 'unrecorded', gross: 0, refunded: 5, net: -5 },
      ],
      refunds: { count: 4 },
      testMode: { checkoutsOpened: 2, purchases: 1 },
    });

    expect(data.daily).toEqual([
      { day: '2026-09-15', accounts: 0, scans: 0, purchases: 0 },
      { day: '2026-09-16', accounts: 1, scans: 0, purchases: 1 },
      { day: '2026-09-17', accounts: 0, scans: 1, purchases: 0 },
      { day: '2026-09-18', accounts: 0, scans: 1, purchases: 0 },
      { day: '2026-09-19', accounts: 0, scans: 0, purchases: 1 },
      // 23:59 UTC is still the 20th.
      { day: '2026-09-20', accounts: 1, scans: 1, purchases: 1 },
      // The test-mode purchase made today is not in the series.
      { day: '2026-09-21', accounts: 1, scans: 1, purchases: 0 },
    ]);
  });

  it('carries aggregates only — no address, domain or id of anything counted', async () => {
    const owner = await seedBusiness(db.prisma);
    const response = await request(appFor(ADMINS))
      .get('/admin/stats?days=90')
      .set('Cookie', owner.cookie);

    expect(response.status).toBe(200);
    const text = JSON.stringify(response.body);
    expect(text).not.toContain('@');
    expect(text).not.toContain('example');
    expect(text).not.toContain(owner.accountId);
    expect(text).not.toContain('ord_');
  });
});

/**
 * A small business, in the order it happened. Window = 2026-09-15 .. 2026-09-21.
 *
 * Accounts: the admin (old), buyer (in), unverified buyer (in, 23:59 on the
 * 20th), tester (in, today). Money: an old USD order refunded 20 in the window,
 * a USD order, a EUR-localised order refunded in full across two returns, a
 * legacy USD order with no checkout row (real), and a test-mode order that is
 * refunded too — none of whose money may appear.
 */
async function seedBusiness(prisma: PrismaClient): Promise<SeededOwner> {
  const owner = await seedAccount(prisma, {
    email: ADMIN_EMAIL,
    verified: true,
    createdAt: at('2026-09-01T08:00:00Z'),
  });
  const buyer = await seedAccount(prisma, {
    email: 'buyer@example.com',
    verified: true,
    createdAt: at('2026-09-16T09:00:00Z'),
  });
  const quietBuyer = await seedAccount(prisma, {
    email: 'quiet@example.com',
    verified: false,
    createdAt: at('2026-09-20T23:59:00Z'),
  });
  const tester = await seedAccount(prisma, {
    email: 'tester@example.com',
    verified: true,
    createdAt: at('2026-09-21T01:00:00Z'),
  });

  await prisma.freeCheckClaim.createMany({
    data: [
      { origin: 'https://old.example', claimedAt: at('2026-09-02T10:00:00Z') },
      { origin: 'https://a.example', claimedAt: at('2026-09-17T10:00:00Z') },
      { origin: 'https://b.example', claimedAt: at('2026-09-21T02:00:00Z') },
    ],
  });

  await seedScan(prisma, owner, 'Free', 'Completed', '2026-09-02T10:00:00Z');
  await seedScan(prisma, buyer, 'Free', 'Completed', '2026-09-17T10:00:00Z');
  await seedScan(prisma, buyer, 'Basic', 'Running', '2026-09-18T10:00:00Z');
  await seedScan(prisma, quietBuyer, 'Complete', 'Failed', '2026-09-20T10:00:00Z');
  await seedScan(prisma, tester, 'Complete', 'Completed', '2026-09-21T10:00:00Z');

  const oldOrder = await seedPurchase(prisma, buyer, { at: '2026-09-05T10:00:00Z', usd: 55 });
  await seedCheckout(prisma, buyer, {
    at: '2026-09-05T09:59:00Z',
    status: 'completed',
    purchaseId: oldOrder,
  });
  const usdOrder = await seedPurchase(prisma, buyer, { at: '2026-09-16T10:00:00Z', usd: 55 });
  await seedCheckout(prisma, buyer, {
    at: '2026-09-16T09:59:00Z',
    status: 'completed',
    purchaseId: usdOrder,
  });
  const eurOrder = await seedPurchase(prisma, quietBuyer, {
    at: '2026-09-19T10:00:00Z',
    usd: 120,
    settled: { amount: 110.5, currency: 'EUR' },
    status: 'Refunded',
  });
  await seedCheckout(prisma, quietBuyer, {
    at: '2026-09-19T09:59:00Z',
    status: 'completed',
    purchaseId: eurOrder,
  });
  await seedCheckout(prisma, quietBuyer, { at: '2026-09-19T11:00:00Z', status: 'rejected' });
  await seedCheckout(prisma, buyer, { at: '2026-09-20T11:00:00Z', status: 'created' });
  const legacyOrder = await seedPurchase(prisma, buyer, {
    at: '2026-09-20T12:00:00Z',
    usd: 55,
    provider: 'paddle',
  });
  const testOrder = await seedPurchase(prisma, tester, { at: '2026-09-21T10:00:00Z', usd: 120 });
  await seedCheckout(prisma, tester, {
    at: '2026-09-21T09:59:00Z',
    status: 'completed',
    purchaseId: testOrder,
    liveMode: false,
  });
  // An open test-mode checkout with no purchase: a NULL purchaseId must not
  // make the "not a test order" filter drop every real one.
  await seedCheckout(prisma, tester, {
    at: '2026-09-21T11:00:00Z',
    status: 'created',
    liveMode: false,
  });

  await seedRefund(prisma, eurOrder, {
    at: '2026-09-20T10:00:00Z',
    amount: 50.25,
    currency: 'EUR',
  });
  await seedRefund(prisma, eurOrder, {
    at: '2026-09-21T10:00:00Z',
    amount: 60.25,
    currency: 'EUR',
  });
  await seedRefund(prisma, oldOrder, { at: '2026-09-18T10:00:00Z', amount: 20, currency: 'USD' });
  await seedRefund(prisma, legacyOrder, { at: '2026-09-10T10:00:00Z', amount: 5, currency: null });
  await seedRefund(prisma, testOrder, { at: '2026-09-21T12:00:00Z', amount: 120, currency: 'USD' });

  return owner;
}

async function seedScan(
  prisma: PrismaClient,
  owner: SeededOwner,
  plan: 'Free' | 'Basic' | 'Complete',
  status: string,
  createdAt: string,
): Promise<void> {
  await prisma.scan.create({
    data: {
      accountId: owner.accountId,
      siteProfileId: owner.siteProfileId,
      plan,
      domain: 'https://example.com',
      status,
      scopeJson: '{}',
      rulesetVersion: RULESET_VERSION,
      createdAt: at(createdAt),
    },
  });
}

async function seedPurchase(
  prisma: PrismaClient,
  owner: SeededOwner,
  options: {
    at: string;
    usd: number;
    settled?: { amount: number; currency: string };
    status?: string;
    provider?: string;
  },
): Promise<string> {
  const purchase = await prisma.purchase.create({
    data: {
      accountId: owner.accountId,
      siteProfileId: owner.siteProfileId,
      plan: options.usd === 55 ? 'Basic' : 'Complete',
      provider: options.provider ?? 'fastspring',
      providerTransactionId: `ord_${randomUUID()}`,
      amountUsd: options.usd,
      currency: 'USD',
      settledAmount: options.settled?.amount ?? null,
      settledCurrency: options.settled?.currency ?? null,
      status: options.status ?? 'paid',
      createdAt: at(options.at),
    },
  });
  return purchase.id;
}

async function seedCheckout(
  prisma: PrismaClient,
  owner: SeededOwner,
  options: { at: string; status: string; purchaseId?: string; liveMode?: boolean },
): Promise<void> {
  await prisma.checkoutSession.create({
    data: {
      provider: 'fastspring',
      reference: randomUUID(),
      accountId: owner.accountId,
      siteProfileId: owner.siteProfileId,
      plan: 'Basic',
      productPath: 'fluxradar-basic',
      expectedAmountUsd: 55,
      liveMode: options.liveMode ?? true,
      status: options.status,
      scopeJson: '{}',
      purchaseId: options.purchaseId ?? null,
      // Far enough ahead that the retention sweep never calls it abandoned.
      expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
      createdAt: at(options.at),
    },
  });
}

async function seedRefund(
  prisma: PrismaClient,
  purchaseId: string,
  options: { at: string; amount: number; currency: string | null },
): Promise<void> {
  await prisma.providerRefund.create({
    data: {
      purchaseId,
      provider: 'fastspring',
      providerRefundId: randomUUID(),
      eventType: 'return.created',
      amountCharged: options.amount,
      amountUsd: options.amount,
      currency: options.currency,
      createdAt: at(options.at),
    },
  });
}
