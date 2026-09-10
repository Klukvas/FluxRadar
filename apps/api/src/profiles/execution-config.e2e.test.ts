import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../index.ts';
import { silentLogger } from '../http/logger.ts';
import { createTestDb, TEST_WEBHOOK_SECRET, type TestDb } from '../test-utils/test-db.ts';

describe('execution configuration HTTP contract', () => {
  let db: TestDb;
  beforeEach(async () => {
    db = await createTestDb();
  });
  afterEach(async () => {
    await db.cleanup();
  });

  it('captures identity/context and effective Free scope, rejecting stale launches without reverting the profile', async () => {
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    expect(
      (
        await agent
          .post('/auth/register')
          .send({ email: 'revision@example.com', password: 'long-password-123' })
      ).status,
    ).toBe(201);
    const created = await agent
      .post('/profiles')
      .send({
        name: 'Dental Brand',
        domain: 'https://revision.example',
        offerings: 'Implants',
        scanConfig: {
          plan: 'Complete',
          scope: { includeSubdomains: true, maxPages: 80, maxDepth: 9 },
        },
      });
    expect(created.status).toBe(201);
    const profileId = created.body.data.id as string;
    const saved = await agent
      .patch(`/profiles/${profileId}`)
      .send({ expectedProfileConfigVersion: 1, offerings: 'Family dentistry' });
    expect(saved.status).toBe(200);
    expect(saved.body.data.scanConfigVersion).toBe(2);
    const stale = await agent
      .post(`/profiles/${profileId}/free-check`)
      .send({ expectedProfileConfigVersion: 1, scope: { includeSubdomains: false } });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('PROFILE_CONFIG_CHANGED');
    const free = await agent
      .post(`/profiles/${profileId}/free-check`)
      .send({ expectedProfileConfigVersion: 2, scope: { includeSubdomains: false } });
    expect(free.status).toBe(201);
    expect(free.body.data.executionConfig).toMatchObject({
      profileConfigVersion: 2,
      plan: 'Free',
      profile: { name: 'Dental Brand', offerings: 'Family dentistry' },
      scope: { maxPages: 1, maxDepth: 0 },
    });
    const paid = await agent
      .post('/billing/dev-checkout')
      .send({
        siteProfileId: profileId,
        expectedProfileConfigVersion: 2,
        plan: 'Complete',
        scope: { includeSubdomains: true, maxPages: 80 },
      });
    expect(paid.status).toBe(201);
    const changed = await agent
      .patch(`/profiles/${profileId}`)
      .send({ expectedProfileConfigVersion: 2, name: 'Plumbing Brand', offerings: 'Leak repairs' });
    expect(changed.status).toBe(200);
    const scan = await agent.get(`/scans/${paid.body.data.scanId}`);
    expect(scan.body.data.executionConfig).toMatchObject({
      profileConfigVersion: 2,
      profile: { name: 'Dental Brand', offerings: 'Family dentistry' },
      plan: 'Complete',
    });
    const profile = await agent.get(`/profiles/${profileId}`);
    expect(profile.body.data.scanConfig).toMatchObject({
      plan: 'Complete',
      scope: { maxPages: 80, maxDepth: 9 },
    });
  });
});
