import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../index.ts';
import { silentLogger } from '../http/logger.ts';
import { createTestDb, type TestDb } from '../test-utils/test-db.ts';
import { hashOAuthState } from './crypto.ts';
import { claimOAuthState } from './oauth-state.ts';
import { integrationsRouter } from './routes.ts';

describe('integrations routes', () => {
  let db: TestDb;
  const envKeys = [
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'GOOGLE_OAUTH_REDIRECT_URI',
    'BING_OAUTH_CLIENT_ID',
    'BING_OAUTH_CLIENT_SECRET',
    'BING_OAUTH_REDIRECT_URI',
    'ANTHROPIC_API_KEY',
    'PAGESPEED_API_KEY',
    'CRUX_API_KEY',
    'HETZNER_S3_ENDPOINT',
    'HETZNER_S3_REGION',
    'HETZNER_S3_BUCKET',
    'HETZNER_S3_ACCESS_KEY',
    'HETZNER_S3_SECRET_KEY',
  ] as const;
  const previous = new Map(envKeys.map((key) => [key, process.env[key]]));

  beforeEach(async () => {
    db = await createTestDb();
    for (const key of envKeys) delete process.env[key];
  });

  afterEach(async () => {
    await db.cleanup();
    for (const key of envKeys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('returns only customer-connectable integrations without exposing configuration values', async () => {
    const app = createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'integrations@example.com');
    const response = await agent.get('/integrations').set('Cookie', account.cookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'google',
          status: 'not_configured',
          canConnect: false,
        }),
        expect.objectContaining({ provider: 'bing', status: 'not_configured', canConnect: false }),
      ]),
    );
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data.map((item: { provider: string }) => item.provider)).toEqual([
      'google',
      'bing',
    ]);
    expect(JSON.stringify(response.body)).not.toContain('client_secret');
  });

  it('does not start OAuth when the server has no provider credentials', async () => {
    const app = createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'oauth-disabled@example.com');
    const response = await agent
      .post('/integrations/google/start')
      .set('Cookie', account.cookie)
      .send({});
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INTEGRATION_NOT_CONFIGURED');
  });

  it('makes Google and Bing connectable and builds provider authorization URLs when configured', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'google-client-id';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'google-client-secret';
    process.env.GOOGLE_OAUTH_REDIRECT_URI =
      'https://fluxradar.net/api/integrations/google/callback';
    process.env.BING_OAUTH_CLIENT_ID = 'bing-client-id';
    process.env.BING_OAUTH_CLIENT_SECRET = 'bing-client-secret';
    process.env.BING_OAUTH_REDIRECT_URI = 'https://fluxradar.net/api/integrations/bing/callback';

    const app = createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'configured-integrations@example.com');
    const status = await agent.get('/integrations').set('Cookie', account.cookie);

    expect(status.body.data).toEqual([
      expect.objectContaining({ provider: 'google', status: 'available', canConnect: true }),
      expect.objectContaining({ provider: 'bing', status: 'available', canConnect: true }),
    ]);

    const googleStart = await agent
      .post('/integrations/google/start')
      .set('Cookie', account.cookie)
      .send({});
    const googleUrl = new URL(googleStart.body.data.authorizationUrl as string);
    expect(googleStart.status).toBe(200);
    expect(googleUrl.origin).toBe('https://accounts.google.com');
    expect(googleUrl.searchParams.get('redirect_uri')).toBe(
      'https://fluxradar.net/api/integrations/google/callback',
    );
    // Only the two read-only data scopes: Google's app verification requires the
    // narrowest scopes an app uses, and nothing reads the Google identity.
    expect(googleUrl.searchParams.get('scope')?.split(' ')).toEqual([
      'https://www.googleapis.com/auth/webmasters.readonly',
      'https://www.googleapis.com/auth/analytics.readonly',
    ]);

    const bingStart = await agent
      .post('/integrations/bing/start')
      .set('Cookie', account.cookie)
      .send({});
    const bingUrl = new URL(bingStart.body.data.authorizationUrl as string);
    expect(bingStart.status).toBe(200);
    expect(bingUrl.origin).toBe('https://www.bing.com');
    expect(bingUrl.searchParams.get('redirect_uri')).toBe(
      'https://fluxradar.net/api/integrations/bing/callback',
    );
  });

  it('rate-limits OAuth starts and removes a bounded batch of expired states', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'google-client-id';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'google-client-secret';
    process.env.GOOGLE_OAUTH_REDIRECT_URI =
      'https://fluxradar.net/api/integrations/google/callback';
    const app = createApp({ prisma: db.prisma, autoProcess: false, logger: silentLogger });
    const agent = request.agent(app);
    const email = 'oauth-rate-limit@example.com';
    const registered = await register(agent, email);
    const account = await db.prisma.account.findUniqueOrThrow({ where: { email } });
    await db.prisma.integrationOAuthState.create({
      data: {
        accountId: account.id,
        provider: 'google',
        stateHash: hashOAuthState('expired-state'),
        expiresAt: new Date(Date.now() - 1),
      },
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(
        (await agent.post('/integrations/google/start').set('Cookie', registered.cookie).send({})).status,
      ).toBe(200);
    }
    expect((await agent.post('/integrations/google/start').send({})).status).toBe(429);
    expect(
      await db.prisma.integrationOAuthState.count({ where: { stateHash: hashOAuthState('expired-state') } }),
    ).toBe(0);
  });

  it('claims an OAuth state once when duplicate callbacks race', async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'google-client-id';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'google-client-secret';
    process.env.GOOGLE_OAUTH_REDIRECT_URI =
      'https://fluxradar.net/api/integrations/google/callback';
    const account = await db.prisma.account.create({
      data: { email: 'oauth-callback-race@example.com', passwordHash: 'not-used-by-this-test' },
    });
    const state = 'same-state-for-two-callbacks';
    await db.prisma.integrationOAuthState.create({
      data: {
        accountId: account.id,
        provider: 'google',
        stateHash: hashOAuthState(state),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    let exchanges = 0;
    const app = express();
    app.use(
      integrationsRouter({
        prisma: db.prisma,
        now: () => new Date(),
        exchangeOAuthCode: async () => {
          exchanges += 1;
          return {
            accessToken: 'test-access-token',
            refreshToken: 'test-refresh-token',
            expiresAt: null,
            scopes: [],
          };
        },
      }),
    );

    const responses = await Promise.all([
      request(app).get(`/integrations/google/callback?state=${state}&code=one-time-code`),
      request(app).get(`/integrations/google/callback?state=${state}&code=one-time-code`),
    ]);

    expect(exchanges).toBe(1);
    expect(responses.map((response) => response.status).sort()).toEqual([302, 302]);
    expect(
      await db.prisma.integrationConnection.findUnique({
        where: { accountId_provider: { accountId: account.id, provider: 'google' } },
      }),
    ).toMatchObject({ status: 'connected' });
  });

  it('allows exactly one claimant after two callbacks both read an unused state', async () => {
    const account = await db.prisma.account.create({
      data: { email: 'oauth-state-claim@example.com', passwordHash: 'not-used-by-this-test' },
    });
    const stateHash = hashOAuthState('overlapping-state');
    await db.prisma.integrationOAuthState.create({
      data: {
        accountId: account.id,
        provider: 'google',
        stateHash,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    let readers = 0;
    let releaseReaders: (() => void) | undefined;
    const bothRead = new Promise<void>((resolve) => {
      releaseReaders = resolve;
    });
    const afterRead = async (): Promise<void> => {
      readers += 1;
      if (readers === 2) releaseReaders?.();
      await bothRead;
    };

    const claims = await Promise.all([
      claimOAuthState(db.prisma, stateHash, 'google', new Date(), { afterRead }),
      claimOAuthState(db.prisma, stateHash, 'google', new Date(), { afterRead }),
    ]);

    expect(claims.filter((claim) => claim !== null)).toEqual([{ accountId: account.id }]);
  });
});

async function register(
  agent: ReturnType<typeof request.agent>,
  email: string,
): Promise<{ cookie: string }> {
  const response = await agent.post('/auth/register').send({ email, password: 'password-123' });
  expect(response.status).toBe(201);
  return { cookie: response.headers['set-cookie']?.[0] as string };
}
