// The Bing binding against a real database: the tenant boundary, and the two
// deletions it must never block.
//
// The binding is a pointer at a provider resource. That makes two failure modes
// worth a database test rather than a unit one, because both are enforced by the
// schema and by the deletion paths rather than by the route:
//
//   * one account must not be able to read, write or clear another account's
//     binding, even holding the profile id — the queries are all scoped by
//     accountId, and this proves it end to end;
//   * an optional integration must never be able to refuse a GDPR erasure. A
//     RESTRICT foreign key here would let one Bing row block account deletion
//     with an opaque constraint error in the middle of a transaction.

import express from 'express';
import request, { type Test } from 'supertest';
import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest';

import { deleteAccountData } from '../../data-retention.ts';
import { errorHandler } from '../../http/error-handler.ts';
import { silentLogger } from '../../http/logger.ts';
import { deleteSiteProfileData } from '../../profiles/profile-deletion.ts';
import {
  createTestDb,
  describeDb,
  seedAccountWithProfile,
  type TestDb,
} from '../../test-utils/test-db.ts';
import { bingIntegrationRouter } from './routes.ts';

const NOW = new Date('2026-09-22T12:00:00.000Z');

describeDb('the Bing binding in the database', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.cleanup();
  });

  beforeEach(async () => {
    await db.prisma.siteBingBinding.deleteMany({});
  });

  /**
   * The router with a session for `accountId`, and a Bing client that answers the
   * site list from a fake transport. Nothing here reaches Bing.
   */
  function appFor(accountId: string, sites: readonly { Url: string; IsVerified: boolean }[]) {
    const app = express();
    app.use(express.json());
    const prisma = db.prisma;
    // requireAuth reads the session row; the token value is irrelevant.
    const sessionFindUnique = vi
      .fn()
      .mockResolvedValue({ accountId, expiresAt: new Date('2099-01-01') });
    const proxied = new Proxy(prisma, {
      get(target, property) {
        if (property === 'session') return { findUnique: sessionFindUnique };
        return Reflect.get(target, property) as unknown;
      },
    });
    app.use(
      bingIntegrationRouter({
        prisma: proxied as typeof prisma,
        now: () => NOW,
        requestOptions: {
          fetcher: vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify({ d: sites }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          ),
        },
      }),
    );
    app.use(errorHandler(silentLogger));
    return app;
  }

  function authed(req: Test): Test {
    return req.set('Cookie', 'fluxradar_session=test-token-00000000000000000000000000000000');
  }

  async function connectBing(accountId: string): Promise<void> {
    await db.prisma.integrationConnection.create({
      data: {
        accountId,
        provider: 'bing',
        status: 'connected',
        // The token payloads are encrypted blobs in production; the resolver
        // decrypts them, so they are written through the same helper here.
        accessTokenEncrypted: (await import('../crypto.ts')).encryptIntegrationSecret('token'),
        refreshTokenEncrypted: null,
        tokenExpiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
        scopesJson: JSON.stringify(['webmaster.read']),
      },
    });
  }

  it('binds a site the connected account can read, and reads it back', async () => {
    const account = await seedAccountWithProfile(db.prisma);
    await connectBing(account.accountId);
    const app = appFor(account.accountId, [{ Url: 'https://example.com/', IsVerified: true }]);

    const saved = await authed(
      request(app).put(`/profiles/${account.siteProfileId}/bing-binding`),
    ).send({ siteUrl: 'https://example.com/' });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({
      siteUrl: 'https://example.com/',
      verifiedAtSelection: true,
    });

    const read = await authed(request(app).get(`/profiles/${account.siteProfileId}/bing-binding`));
    expect(read.body.data.siteUrl).toBe('https://example.com/');
  });

  it('refuses a site the connected Bing account cannot read', async () => {
    const account = await seedAccountWithProfile(db.prisma);
    await connectBing(account.accountId);
    const app = appFor(account.accountId, [{ Url: 'https://other.example/', IsVerified: true }]);

    const response = await authed(
      request(app).put(`/profiles/${account.siteProfileId}/bing-binding`),
    ).send({ siteUrl: 'https://example.com/' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('BING_SITE_NOT_AVAILABLE');
    expect(await db.prisma.siteBingBinding.count()).toBe(0);
  });

  it('keeps one account out of another account’s binding', async () => {
    const owner = await seedAccountWithProfile(db.prisma);
    const stranger = await seedAccountWithProfile(db.prisma);
    await connectBing(owner.accountId);
    await connectBing(stranger.accountId);
    await db.prisma.siteBingBinding.create({
      data: {
        accountId: owner.accountId,
        siteProfileId: owner.siteProfileId,
        siteUrl: 'https://example.com/',
        verifiedAtSelection: true,
      },
    });

    const asStranger = appFor(stranger.accountId, [
      { Url: 'https://attacker.example/', IsVerified: true },
    ]);

    // Read, write and clear, all with the owner's profile id in hand.
    expect(
      (await authed(request(asStranger).get(`/profiles/${owner.siteProfileId}/bing-binding`)))
        .status,
    ).toBe(404);
    expect(
      (
        await authed(request(asStranger).put(`/profiles/${owner.siteProfileId}/bing-binding`)).send(
          {
            siteUrl: 'https://attacker.example/',
          },
        )
      ).status,
    ).toBe(404);
    expect(
      (await authed(request(asStranger).delete(`/profiles/${owner.siteProfileId}/bing-binding`)))
        .status,
    ).toBe(404);

    const stored = await db.prisma.siteBingBinding.findUnique({
      where: { siteProfileId: owner.siteProfileId },
    });
    expect(stored?.siteUrl).toBe('https://example.com/');

    const listed = await authed(request(asStranger).get('/integrations/bing/bindings'));
    expect(listed.body.data).toEqual([]);
  });

  it('does not block account deletion', async () => {
    const account = await seedAccountWithProfile(db.prisma);
    await db.prisma.siteBingBinding.create({
      data: {
        accountId: account.accountId,
        siteProfileId: account.siteProfileId,
        siteUrl: 'https://example.com/',
        verifiedAtSelection: false,
      },
    });

    // No object store: the deletion path must not need one to remove rows.
    await deleteAccountData(db.prisma, account.accountId, null);

    expect(await db.prisma.siteBingBinding.count()).toBe(0);
    expect(await db.prisma.account.count({ where: { id: account.accountId } })).toBe(0);
  });

  it('does not block deletion of the site profile it points at', async () => {
    const account = await seedAccountWithProfile(db.prisma);
    await db.prisma.siteBingBinding.create({
      data: {
        accountId: account.accountId,
        siteProfileId: account.siteProfileId,
        siteUrl: 'https://example.com/',
        verifiedAtSelection: false,
      },
    });

    const result = await deleteSiteProfileData(
      db.prisma,
      { accountId: account.accountId, profileId: account.siteProfileId, now: NOW },
      null,
    );

    expect(result.kind).toBe('deleted');
    expect(await db.prisma.siteBingBinding.count()).toBe(0);
  });

  it('cascades from the database as well, for a path that forgets to delete it', async () => {
    const account = await seedAccountWithProfile(db.prisma);
    await db.prisma.siteBingBinding.create({
      data: {
        accountId: account.accountId,
        siteProfileId: account.siteProfileId,
        siteUrl: 'https://example.com/',
        verifiedAtSelection: false,
      },
    });

    // No application-level delete first: the foreign keys are what is under test.
    await db.prisma.siteProfile.delete({ where: { id: account.siteProfileId } });

    expect(await db.prisma.siteBingBinding.count()).toBe(0);
  });
});
