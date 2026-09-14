// Route-level contract for the Google data flow. Requires the disposable
// PostgreSQL database the repository's `pnpm test` provisions.

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../index.ts';
import { silentLogger } from '../../http/logger.ts';
import { createTestDb, TEST_WEBHOOK_SECRET, type TestDb } from '../../test-utils/test-db.ts';
import { encryptIntegrationSecret } from '../crypto.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('google integration routes', () => {
  let db: TestDb;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await db.cleanup();
  });

  const appFor = () =>
    createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
    });

  // The supertest agent keeps the session cookie for subsequent requests.
  async function register(agent: ReturnType<typeof request.agent>, email: string): Promise<void> {
    await agent.post('/auth/register').send({ email, password: 'Sup3rSecret!pass' });
  }

  async function connectGoogle(accountId: string, scopes: readonly string[]) {
    await db.prisma.integrationConnection.create({
      data: {
        accountId,
        provider: 'google',
        status: 'connected',
        accessTokenEncrypted: encryptIntegrationSecret('access-token'),
        refreshTokenEncrypted: encryptIntegrationSecret('refresh-token'),
        tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        scopesJson: JSON.stringify(scopes),
      },
    });
  }

  const BOTH_SCOPES = [
    'https://www.googleapis.com/auth/webmasters.readonly',
    'https://www.googleapis.com/auth/analytics.readonly',
  ];

  it('allows the browser to preflight the binding PUT', async () => {
    // Saving a property selection is the only PUT in the product. A preflight
    // that omits it makes the whole selection step unreachable from the SPA,
    // which supertest's same-process requests cannot detect on their own.
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
      corsOrigin: 'https://app.example.test',
    });
    const response = await request(app)
      .options('/profiles/some-profile/google-binding')
      .set('Origin', 'https://app.example.test')
      .set('Access-Control-Request-Method', 'PUT');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-methods']).toContain('PUT');
    expect(response.headers['access-control-allow-origin']).toBe('https://app.example.test');
  });

  it('reports not_connected for an account that never authorized Google', async () => {
    const agent = request.agent(appFor());
    await register(agent, 'google-none@example.com');

    const response = await agent.get('/integrations/google/properties');

    expect(response.status).toBe(200);
    expect(response.body.data.connection.state).toBe('not_connected');
    expect(response.body.data.searchConsole.items).toEqual([]);
  });

  it('lists readable properties for a connected account', async () => {
    const app = appFor();
    const agent = request.agent(app);
    await register(agent, 'google-list@example.com');
    const row = await db.prisma.account.findFirstOrThrow({
      where: { email: 'google-list@example.com' },
    });
    await connectGoogle(row.id, BOTH_SCOPES);
    globalThis.fetch = vi.fn(async (url: unknown) =>
      String(url).includes('webmasters')
        ? json({ siteEntry: [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }] })
        : json({
            accountSummaries: [
              {
                displayName: 'Acme',
                propertySummaries: [{ property: 'properties/999', displayName: 'Acme Web' }],
              },
            ],
          }),
    ) as unknown as typeof fetch;

    const response = await agent.get('/integrations/google/properties');

    expect(response.body.data.searchConsole.items).toEqual([
      { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
    ]);
    expect(response.body.data.analytics.items[0].propertyId).toBe('999');
  });

  it('explains a refused Analytics listing without calling it a selected property', async () => {
    const agent = request.agent(appFor());
    await register(agent, 'google-denied@example.com');
    const row = await db.prisma.account.findFirstOrThrow({
      where: { email: 'google-denied@example.com' },
    });
    await connectGoogle(row.id, BOTH_SCOPES);
    globalThis.fetch = vi.fn(async (url: unknown) =>
      String(url).includes('webmasters')
        ? json({ siteEntry: [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }] })
        : json(
            {
              error: {
                code: 403,
                status: 'PERMISSION_DENIED',
                details: [{ reason: 'SERVICE_DISABLED' }],
              },
            },
            403,
          ),
    ) as unknown as typeof fetch;

    const response = await agent.get('/integrations/google/properties');

    expect(response.body.data.searchConsole.state).toBe('connected');
    expect(response.body.data.analytics).toMatchObject({
      state: 'no_access',
      reason: null,
      items: [],
    });
    // Nothing is selected while the list is being loaded.
    expect(response.body.data.analytics.detail).not.toMatch(/selected property/);
  });

  it('tells a grant without the Analytics scope apart from a refusal', async () => {
    const agent = request.agent(appFor());
    await register(agent, 'google-scope@example.com');
    const row = await db.prisma.account.findFirstOrThrow({
      where: { email: 'google-scope@example.com' },
    });
    await connectGoogle(row.id, BOTH_SCOPES.slice(0, 1));
    globalThis.fetch = vi.fn(async () =>
      json({ siteEntry: [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }] }),
    ) as unknown as typeof fetch;

    const response = await agent.get('/integrations/google/properties');

    expect(response.body.data.analytics).toMatchObject({
      state: 'no_access',
      reason: 'missing_scope',
    });
    expect(response.body.data.searchConsole.reason).toBeNull();
  });

  it('explains a revoked grant instead of returning a technical error', async () => {
    const app = appFor();
    const agent = request.agent(app);
    await register(agent, 'google-revoked@example.com');
    const row = await db.prisma.account.findFirstOrThrow({
      where: { email: 'google-revoked@example.com' },
    });
    await db.prisma.integrationConnection.create({
      data: {
        accountId: row.id,
        provider: 'google',
        status: 'connected',
        accessTokenEncrypted: encryptIntegrationSecret('expired'),
        refreshTokenEncrypted: encryptIntegrationSecret('refresh'),
        // Already expired: the request must go through the refresh path.
        tokenExpiresAt: new Date(Date.now() - 1000),
        scopesJson: JSON.stringify(BOTH_SCOPES),
      },
    });
    globalThis.fetch = vi.fn(async () =>
      json({ error: 'invalid_grant' }, 400),
    ) as unknown as typeof fetch;

    const response = await agent.get('/integrations/google/properties');

    expect(response.body.data.connection.state).toBe('needs_reconnect');
    expect(response.body.data.connection.detail).not.toMatch(/400|invalid_grant/);
    const stored = await db.prisma.integrationConnection.findFirstOrThrow({
      where: { accountId: row.id },
    });
    expect(stored.status).toBe('needs_reconnect');
  });

  it('rejects a property the connected Google account cannot read', async () => {
    const app = appFor();
    const agent = request.agent(app);
    await register(agent, 'google-bind@example.com');
    const row = await db.prisma.account.findFirstOrThrow({
      where: { email: 'google-bind@example.com' },
    });
    await connectGoogle(row.id, BOTH_SCOPES);
    const profile = await agent
      .post('/profiles')
      .send({ name: 'Example', domain: 'https://example.com' });
    globalThis.fetch = vi.fn(async () => json({ siteEntry: [] })) as unknown as typeof fetch;

    const response = await agent
      .put(`/profiles/${profile.body.data.id}/google-binding`)
      .send({ searchConsoleSiteUrl: 'sc-domain:someone-else.com' });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('GOOGLE_PROPERTY_NOT_AVAILABLE');
    expect(await db.prisma.siteGoogleBinding.count()).toBe(0);
  });

  it('stores a validated selection and returns it for the owning account only', async () => {
    const app = appFor();
    const owner = request.agent(app);
    await register(owner, 'google-owner@example.com');
    const ownerRow = await db.prisma.account.findFirstOrThrow({
      where: { email: 'google-owner@example.com' },
    });
    await connectGoogle(ownerRow.id, BOTH_SCOPES);
    const profile = await owner
      .post('/profiles')
      .send({ name: 'Example', domain: 'https://example.com' });
    globalThis.fetch = vi.fn(async (url: unknown) =>
      String(url).includes('webmasters')
        ? json({ siteEntry: [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }] })
        : json({
            accountSummaries: [
              {
                displayName: 'Acme',
                propertySummaries: [{ property: 'properties/999', displayName: 'Acme Web' }],
              },
            ],
          }),
    ) as unknown as typeof fetch;

    const saved = await owner
      .put(`/profiles/${profile.body.data.id}/google-binding`)
      .send({ searchConsoleSiteUrl: 'sc-domain:example.com', ga4PropertyId: '999' });

    expect(saved.status).toBe(200);
    expect(saved.body.data.ga4PropertyName).toBe('Acme Web');

    const intruder = request.agent(app);
    await register(intruder, 'google-intruder@example.com');
    const stolen = await intruder.get(`/profiles/${profile.body.data.id}/google-binding`);

    expect(stolen.status).toBe(404);
  });

  it('lists every binding of the account for the domain overview, and none of another account', async () => {
    const app = appFor();
    const owner = request.agent(app);
    await register(owner, 'google-bindings-owner@example.com');
    const ownerRow = await db.prisma.account.findFirstOrThrow({
      where: { email: 'google-bindings-owner@example.com' },
    });
    const shop = await owner
      .post('/profiles')
      .send({ name: 'Shop', domain: 'https://shop.example.com' });
    const blog = await owner
      .post('/profiles')
      .send({ name: 'Blog', domain: 'https://blog.example.com' });
    await db.prisma.siteGoogleBinding.createMany({
      data: [
        {
          accountId: ownerRow.id,
          siteProfileId: shop.body.data.id,
          searchConsoleSiteUrl: 'sc-domain:example.com',
        },
        {
          accountId: ownerRow.id,
          siteProfileId: blog.body.data.id,
          ga4PropertyId: '999',
          ga4PropertyName: 'Blog',
        },
      ],
    });

    const listed = await owner.get('/integrations/google/bindings');

    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(2);
    expect(listed.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          siteProfileId: shop.body.data.id,
          searchConsoleSiteUrl: 'sc-domain:example.com',
          ga4PropertyId: null,
        }),
        expect.objectContaining({
          siteProfileId: blog.body.data.id,
          searchConsoleSiteUrl: null,
          ga4PropertyId: '999',
        }),
      ]),
    );

    const intruder = request.agent(app);
    await register(intruder, 'google-bindings-intruder@example.com');
    const foreign = await intruder.get('/integrations/google/bindings');
    expect(foreign.body.data).toEqual([]);
  });
});
