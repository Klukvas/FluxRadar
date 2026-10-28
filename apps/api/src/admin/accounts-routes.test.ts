import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, type TestDb } from '../test-utils/test-db.ts';
import { ACCOUNTS_PAGE_SIZE, readAccountList } from './accounts.ts';
import { ADMIN_EMAILS_ENV } from './admin-emails.ts';
import {
  ADMIN_EMAIL,
  ADMINS,
  adminTestApp,
  at,
  seedAccount,
  seedCheckout,
  seedPurchase,
  seedScan,
  unknownRouteAnswer,
  type SeededOwner,
} from '../test-utils/admin-fixtures.ts';

// GET /admin/accounts: the Accounts list on the owner dashboard.
//
// The same door as /admin/stats — to anyone who is not a confirmed admin it is
// an unknown route, before `page` or `q` is read. Behind it, every row carries
// exactly the documented fields: the list hands out email addresses, so a field
// that slipped in (an id, a hash) would be a leak, and the key list pins it.

const ROW_KEYS = [
  'createdAt',
  'email',
  'emailVerified',
  'freeCheckUsedAt',
  'lastActivityAt',
  'purchases',
  'scans',
  'testAccount',
  'tutorial',
].sort();

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

const appFor = () => adminTestApp(db.prisma, ADMINS);

function seedOwner(): Promise<SeededOwner> {
  return seedAccount(db.prisma, {
    email: ADMIN_EMAIL,
    verified: true,
    createdAt: at('2026-09-01T08:00:00Z'),
  });
}

function seedStranger(): Promise<SeededOwner> {
  return seedAccount(db.prisma, {
    email: 'someone@example.com',
    verified: true,
    createdAt: at('2026-09-20T10:00:00Z'),
  });
}

function getAccounts(cookie: string, search = '') {
  return request(appFor()).get(`/admin/accounts${search}`).set('Cookie', cookie);
}

describe('GET /admin/accounts access', () => {
  it('answers a visitor with no session exactly as an unknown route', async () => {
    const app = appFor();
    const response = await request(app).get('/admin/accounts');

    expect({ status: response.status, body: response.body }).toEqual(await unknownRouteAnswer(app));
    expect(response.status).toBe(404);
  });

  it('answers a signed-in account that is not listed exactly as an unknown route', async () => {
    const stranger = await seedStranger();
    const app = appFor();
    const response = await request(app).get('/admin/accounts').set('Cookie', stranger.cookie);

    expect({ status: response.status, body: response.body }).toEqual(
      await unknownRouteAnswer(app, stranger.cookie),
    );
    expect(response.status).toBe(404);
  });

  it.each(['?page=0', '?page=abc', '?page=1&page=2', '?q=a&q=b', `?q=${'a'.repeat(255)}`])(
    'does not tell a stranger that %s was wrong: the 404 comes first',
    async (search) => {
      const stranger = await seedStranger();
      const app = appFor();
      const response = await request(app)
        .get(`/admin/accounts${search}`)
        .set('Cookie', stranger.cookie);

      expect({ status: response.status, body: response.body }).toEqual(
        await unknownRouteAnswer(app, stranger.cookie),
      );
      expect(response.status).toBe(404);
    },
  );

  it('refuses a listed address that was never confirmed', async () => {
    const owner = await seedAccount(db.prisma, {
      email: ADMIN_EMAIL,
      verified: false,
      createdAt: at('2026-09-01T08:00:00Z'),
    });
    const response = await getAccounts(owner.cookie);

    expect(response.status).toBe(404);
  });

  it.each(['?page=0', '?page=-1', '?page=1.5', '?page=01', '?page=1234567', '?page=1&page=2'])(
    'rejects %s from the admin with the usual 400',
    async (search) => {
      const owner = await seedOwner();
      const response = await getAccounts(owner.cookie, search);

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ success: false, error: { code: 'VALIDATION' } });
    },
  );

  it('rejects a search longer than an email address can be', async () => {
    const owner = await seedOwner();
    const response = await getAccounts(owner.cookie, `?q=${'a'.repeat(255)}`);

    expect(response.status).toBe(400);
  });

  it('rejects a repeated q parameter', async () => {
    const owner = await seedOwner();
    const response = await getAccounts(owner.cookie, '?q=a&q=b');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, error: { code: 'VALIDATION' } });
  });
});

describe('GET /admin/accounts rows', () => {
  it('lists every account, newest first, with its own activity', async () => {
    const owner = await seedSmallBusiness();
    const response = await getAccounts(owner.cookie);

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body.data).toEqual({
      page: 1,
      pageSize: 50,
      total: 3,
      rows: [
        {
          email: 'quiet@Example.org',
          createdAt: '2026-09-20T23:59:00.000Z',
          emailVerified: false,
          freeCheckUsedAt: null,
          scans: 0,
          purchases: 0,
          lastActivityAt: '2026-09-20T23:59:00.000Z',
          tutorial: 'pending',
          testAccount: false,
        },
        {
          email: 'buyer@example.com',
          createdAt: '2026-09-16T09:00:00.000Z',
          emailVerified: true,
          freeCheckUsedAt: '2026-09-17T10:00:00.000Z',
          scans: 2,
          // Paid, refunded and a legacy order with no checkout; not the test order.
          purchases: 3,
          // The legacy order, not the later test-mode one.
          lastActivityAt: '2026-09-20T12:00:00.000Z',
          tutorial: 'pending',
          testAccount: false,
        },
        {
          email: ADMIN_EMAIL,
          createdAt: '2026-09-01T08:00:00.000Z',
          emailVerified: true,
          freeCheckUsedAt: null,
          scans: 1,
          purchases: 0,
          lastActivityAt: '2026-09-02T10:00:00.000Z',
          tutorial: 'pending',
          testAccount: false,
        },
      ],
    });
  });

  it('carries exactly the documented fields — no id, hash or session', async () => {
    const owner = await seedSmallBusiness();
    const response = await getAccounts(owner.cookie);

    expect(response.status).toBe(200);
    expect(Object.keys(response.body.data).sort()).toEqual(['page', 'pageSize', 'rows', 'total']);
    for (const row of response.body.data.rows) {
      expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
    }
    const text = JSON.stringify(response.body);
    expect(text).not.toContain(owner.accountId);
    expect(text).not.toContain('test-hash');
  });

  it('filters by a case-insensitive part of the address, and counts the filtered list', async () => {
    const owner = await seedSmallBusiness();

    const company = await getAccounts(owner.cookie, '?q=EXAMPLE.COM');
    expect(company.body.data.total).toBe(2);
    expect(company.body.data.rows.map((row: { email: string }) => row.email)).toEqual([
      'buyer@example.com',
      ADMIN_EMAIL,
    ]);

    const quiet = await getAccounts(owner.cookie, `?q=${encodeURIComponent('  Quiet@ ')}`);
    expect(quiet.body.data.total).toBe(1);
    expect(quiet.body.data.rows[0].email).toBe('quiet@Example.org');

    const nobody = await getAccounts(owner.cookie, '?q=nobody');
    expect(nobody.body.data).toEqual({ page: 1, pageSize: 50, total: 0, rows: [] });
  });

  it.each([
    ['_', 'under_score@example.net'],
    ['%', 'per%cent@example.net'],
    ['\\', 'back\\slash@example.net'],
  ])('searches for %s literally, not as a LIKE pattern', async (query, match) => {
    const owner = await seedOwner();
    await db.prisma.account.createMany({
      data: ['under_score@example.net', 'per%cent@example.net', 'back\\slash@example.net'].map(
        (email) => ({ email, passwordHash: 'test-hash', createdAt: at('2026-09-10T10:00:00Z') }),
      ),
    });
    const response = await getAccounts(owner.cookie, `?q=${encodeURIComponent(query)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
    expect(response.body.data.rows.map((row: { email: string }) => row.email)).toEqual([match]);
  });

  it('treats a blank search as no search', async () => {
    const owner = await seedSmallBusiness();
    const response = await getAccounts(owner.cookie, '?q=%20%20');

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(3);
  });

  it('reads a page in four statements however many accounts it holds, and an empty one in two', async () => {
    await seedSmallBusiness();
    // A client of its own: the shared one does not emit query events.
    const counted = new PrismaClient({
      datasourceUrl: db.databaseUrl,
      log: [{ emit: 'event', level: 'query' }],
    });
    let statements = 0;
    counted.$on('query', () => {
      statements += 1;
    });
    try {
      await counted.$connect();
      await readAccountList(counted, { page: 1, query: null });
      const fullPage = statements;
      statements = 0;
      await readAccountList(counted, { page: 1, query: 'nobody' });

      expect({ fullPage, emptyPage: statements }).toEqual({ fullPage: 4, emptyPage: 2 });
    } finally {
      await counted.$disconnect();
    }
  });

  it('pages 50 at a time, ties broken by address', async () => {
    const owner = await seedOwner();
    const bulkEmails = Array.from(
      { length: 52 },
      (_, index) => `bulk-${String(index).padStart(2, '0')}@example.net`,
    );
    await db.prisma.account.createMany({
      data: bulkEmails.map((email) => ({
        email,
        passwordHash: 'test-hash',
        createdAt: at('2026-09-10T10:00:00Z'),
      })),
    });

    const first = await getAccounts(owner.cookie);
    const second = await getAccounts(owner.cookie, '?page=2');
    const beyond = await getAccounts(owner.cookie, '?page=3');

    expect(first.body.data.total).toBe(53);
    expect(first.body.data.rows).toHaveLength(ACCOUNTS_PAGE_SIZE);
    expect(second.body.data).toMatchObject({ page: 2, pageSize: 50, total: 53 });
    const emailsOf = (rows: readonly { email: string }[]) => rows.map((row) => row.email);
    expect([...emailsOf(first.body.data.rows), ...emailsOf(second.body.data.rows)]).toEqual([
      ...bulkEmails,
      ADMIN_EMAIL,
    ]);
    expect(beyond.body.data).toEqual({ page: 3, pageSize: 50, total: 53, rows: [] });
  });
});

describe('GET /admin/accounts tutorial status', () => {
  it('reports completed, skipped and pending from the onboarding timestamps', async () => {
    const owner = await seedOwner();
    await db.prisma.account.createMany({
      data: [
        {
          email: 'done@example.com',
          passwordHash: 'test-hash',
          onboardingCompletedAt: at('2026-09-10T10:00:00Z'),
          createdAt: at('2026-09-10T09:00:00Z'),
        },
        {
          email: 'skipped@example.com',
          passwordHash: 'test-hash',
          onboardingSkippedAt: at('2026-09-10T10:00:00Z'),
          createdAt: at('2026-09-10T09:00:00Z'),
        },
        {
          email: 'pending@example.com',
          passwordHash: 'test-hash',
          createdAt: at('2026-09-10T09:00:00Z'),
        },
      ],
    });

    const response = await getAccounts(owner.cookie, '?q=example.com');
    const tutorials = Object.fromEntries(
      response.body.data.rows.map((row: { email: string; tutorial: string }) => [
        row.email,
        row.tutorial,
      ]),
    );

    expect(tutorials).toMatchObject({
      'done@example.com': 'completed',
      'skipped@example.com': 'skipped',
      'pending@example.com': 'pending',
    });
  });
});

describe('PATCH /admin/accounts/test-account', () => {
  it('answers a visitor with no session exactly as an unknown route', async () => {
    const app = appFor();
    const response = await request(app)
      .patch('/admin/accounts/test-account')
      .send({ email: ADMIN_EMAIL, testAccount: true });

    expect({ status: response.status, body: response.body }).toEqual(await unknownRouteAnswer(app));
    expect(response.status).toBe(404);
  });

  it('answers a signed-in account that is not listed exactly as an unknown route', async () => {
    const stranger = await seedStranger();
    const app = appFor();
    const response = await request(app)
      .patch('/admin/accounts/test-account')
      .set('Cookie', stranger.cookie)
      .send({ email: ADMIN_EMAIL, testAccount: true });

    expect({ status: response.status, body: response.body }).toEqual(
      await unknownRouteAnswer(app, stranger.cookie),
    );
    expect(response.status).toBe(404);
  });

  it('does not tell a stranger the body was wrong: the 404 comes first', async () => {
    const stranger = await seedStranger();
    const response = await request(appFor())
      .patch('/admin/accounts/test-account')
      .set('Cookie', stranger.cookie)
      .send({ email: 'x', testAccount: 'yes' });

    expect(response.status).toBe(404);
  });

  it.each([
    {},
    { email: ADMIN_EMAIL },
    { testAccount: true },
    { email: '', testAccount: true },
    { email: 'a'.repeat(255), testAccount: true },
    { email: ADMIN_EMAIL, testAccount: 'yes' },
  ])('rejects %j with the usual 400', async (body) => {
    const owner = await seedOwner();
    const response = await request(appFor())
      .patch('/admin/accounts/test-account')
      .set('Cookie', owner.cookie)
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ success: false, error: { code: 'VALIDATION' } });
  });

  it('marks and unmarks an account, and the list shows the flag', async () => {
    const owner = await seedOwner();
    const buyer = await db.prisma.account.create({
      data: {
        email: 'buyer@example.com',
        passwordHash: 'test-hash',
        createdAt: at('2026-09-16T09:00:00Z'),
      },
    });

    const mark = await request(appFor())
      .patch('/admin/accounts/test-account')
      .set('Cookie', owner.cookie)
      .send({ email: 'buyer@example.com', testAccount: true });
    expect(mark.status).toBe(200);
    expect(mark.body).toEqual({
      success: true,
      data: { email: 'buyer@example.com', testAccount: true },
      error: null,
    });

    const listed = await getAccounts(owner.cookie, '?q=buyer');
    expect(listed.body.data.rows[0]).toMatchObject({
      email: 'buyer@example.com',
      testAccount: true,
    });

    const unmark = await request(appFor())
      .patch('/admin/accounts/test-account')
      .set('Cookie', owner.cookie)
      .send({ email: 'buyer@example.com', testAccount: false });
    expect(unmark.status).toBe(200);
    expect((await getAccounts(owner.cookie, '?q=buyer')).body.data.rows[0].testAccount).toBe(false);

    // The flag is the only thing the call changed.
    expect(
      await db.prisma.account.findUnique({ where: { id: buyer.id }, select: { email: true } }),
    ).toEqual({ email: 'buyer@example.com' });
  });

  it('answers an address the tables do not hold with 404 NOT_FOUND', async () => {
    const owner = await seedOwner();
    const response = await request(appFor())
      .patch('/admin/accounts/test-account')
      .set('Cookie', owner.cookie)
      .send({ email: 'nobody@example.com', testAccount: true });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('matches the exact address the list showed, not a different case', async () => {
    const owner = await seedOwner();
    await db.prisma.account.create({
      data: {
        email: 'Buyer@example.com',
        passwordHash: 'test-hash',
        createdAt: at('2026-09-16T09:00:00Z'),
      },
    });
    const response = await request(appFor())
      .patch('/admin/accounts/test-account')
      .set('Cookie', owner.cookie)
      .send({ email: 'buyer@example.com', testAccount: true });

    expect(response.status).toBe(404);
  });
});

/**
 * Three accounts: the admin (one old scan), a buyer (a free check, two scans,
 * a paid order, a refunded one, a legacy one with no checkout and a test-mode
 * one), and an unconfirmed sign-up with nothing yet.
 */
async function seedSmallBusiness(): Promise<SeededOwner> {
  const prisma = db.prisma;
  const owner = await seedOwner();
  const buyer = await seedAccount(prisma, {
    email: 'buyer@example.com',
    verified: true,
    createdAt: at('2026-09-16T09:00:00Z'),
  });
  await seedAccount(prisma, {
    email: 'quiet@Example.org',
    verified: false,
    createdAt: at('2026-09-20T23:59:00Z'),
  });
  await prisma.account.update({
    where: { id: buyer.accountId },
    data: { freeCheckUsedAt: at('2026-09-17T10:00:00Z') },
  });

  await seedScan(prisma, owner, 'Free', 'Completed', '2026-09-02T10:00:00Z');
  await seedScan(prisma, buyer, 'Free', 'Completed', '2026-09-17T10:00:00Z');
  await seedScan(prisma, buyer, 'Basic', 'Running', '2026-09-18T10:00:00Z');

  const paid = await seedPurchase(prisma, buyer, { at: '2026-09-16T10:00:00Z', usd: 55 });
  await seedCheckout(prisma, buyer, {
    at: '2026-09-16T09:59:00Z',
    status: 'completed',
    purchaseId: paid,
  });
  const refunded = await seedPurchase(prisma, buyer, {
    at: '2026-09-19T10:00:00Z',
    usd: 120,
    status: 'Refunded',
  });
  await seedCheckout(prisma, buyer, {
    at: '2026-09-19T09:59:00Z',
    status: 'completed',
    purchaseId: refunded,
  });
  await seedPurchase(prisma, buyer, { at: '2026-09-20T12:00:00Z', usd: 55, provider: 'paddle' });
  const testOrder = await seedPurchase(prisma, buyer, { at: '2026-09-21T10:00:00Z', usd: 120 });
  await seedCheckout(prisma, buyer, {
    at: '2026-09-21T09:59:00Z',
    status: 'completed',
    purchaseId: testOrder,
    liveMode: false,
  });

  return owner;
}
