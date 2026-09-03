import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../index.ts';
import { silentLogger } from '../http/logger.ts';
import { createTestDb, type TestDb } from '../test-utils/test-db.ts';
import { TEST_WEBHOOK_SECRET } from '../test-utils/test-db.ts';

describe('integrations routes', () => {
  let db: TestDb;
  const envKeys = [
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'BING_OAUTH_CLIENT_ID',
    'BING_OAUTH_CLIENT_SECRET',
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

  it('returns user and platform integration status without exposing configuration values', async () => {
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
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
        expect.objectContaining({
          provider: 'anthropic',
          status: 'not_configured',
          kind: 'platform',
        }),
        expect.objectContaining({
          provider: 'hetzner-s3',
          status: 'not_configured',
          kind: 'platform',
        }),
      ]),
    );
    expect(JSON.stringify(response.body)).not.toContain('client_secret');
  });

  it('does not start OAuth when the server has no provider credentials', async () => {
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
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
});

async function register(
  agent: ReturnType<typeof request.agent>,
  email: string,
): Promise<{ cookie: string }> {
  const response = await agent.post('/auth/register').send({ email, password: 'password-123' });
  expect(response.status).toBe(201);
  return { cookie: response.headers['set-cookie']?.[0] as string };
}
