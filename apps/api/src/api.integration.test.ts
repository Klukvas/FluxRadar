import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './index.ts';
import { createDefaultAiProvider } from './orchestrator/geo.ts';
import { processScan } from './orchestrator/worker.ts';
import { silentLogger } from './http/logger.ts';
import { createTestDb, type TestDb } from './test-utils/test-db.ts';
import { startFixtureSite, type FixtureSite } from '@fluxradar/crawler';
import { TEST_WEBHOOK_SECRET } from './test-utils/test-db.ts';

type TestAgent = ReturnType<typeof request.agent>;

describe('T-12 API happy paths', () => {
  let fixture: FixtureSite;
  let db: TestDb;

  beforeAll(async () => {
    fixture = await startFixtureSite();
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it('registers, creates a profile, runs one Free check, and enforces the one-time limit', async () => {
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'free@example.com');
    const profile = await createProfile(agent, account.cookie);

    const created = await agent
      .post(`/profiles/${profile.id}/free-check`)
      .set('Cookie', account.cookie)
      .send({});
    expect(created.status).toBe(201);
    const scanId = created.body.data.id as string;
    await runScan(db, scanId);

    const scan = await agent.get(`/scans/${scanId}`).set('Cookie', account.cookie);
    expect(scan.status).toBe(200);
    expect(scan.body.data.status).toBe('Completed');
    expect(scan.body.data.modules[0].module).toBe('SEO');

    const dashboard = await agent.get(`/scans/${scanId}/dashboard`).set('Cookie', account.cookie);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.overall).toEqual({
      verdict: 'insufficient_data',
      score: null,
      weightedCoverage: 0,
      moduleWeights: [],
    });
    expect(dashboard.body.data.modules).toEqual(
      expect.arrayContaining([expect.objectContaining({ module: 'SEO', score: null })]),
    );

    const duplicate = await agent
      .post(`/profiles/${profile.id}/free-check`)
      .set('Cookie', account.cookie)
      .send({});
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('FREE_CHECK_USED');

    const otherAgent = request.agent(app);
    const otherAccount = await register(otherAgent, 'free-other@example.com');
    const otherProfile = await createProfile(
      otherAgent,
      otherAccount.cookie,
      'https://EXAMPLE.com/',
    );
    const sameDomain = await otherAgent
      .post(`/profiles/${otherProfile.id}/free-check`)
      .set('Cookie', otherAccount.cookie)
      .send({});
    expect(sameDomain.status).toBe(409);
    expect(sameDomain.body.error.code).toBe('FREE_CHECK_DOMAIN_USED');
  });

  it('allows only one account to claim a domain under concurrent Free checks', async () => {
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
    });
    const agentA = request.agent(app);
    const agentB = request.agent(app);
    const [accountA, accountB] = await Promise.all([
      register(agentA, 'free-race-a@example.com'),
      register(agentB, 'free-race-b@example.com'),
    ]);
    const [profileA, profileB] = await Promise.all([
      createProfile(agentA, accountA.cookie, 'https://race.example.com'),
      createProfile(agentB, accountB.cookie, 'https://RACE.example.com/'),
    ]);

    const results = await Promise.all([
      agentA.post(`/profiles/${profileA.id}/free-check`).set('Cookie', accountA.cookie).send({}),
      agentB.post(`/profiles/${profileB.id}/free-check`).set('Cookie', accountB.cookie).send({}),
    ]);
    expect(results.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(results.find(({ status }) => status === 409)?.body.error.code).toBe(
      'FREE_CHECK_DOMAIN_USED',
    );
    expect(
      await db.prisma.freeCheckClaim.count({ where: { origin: 'https://race.example.com' } }),
    ).toBe(1);
  });

  it('runs Complete through the worker, exposes issues/dashboard, and exports JSON/CSV', async () => {
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'complete@example.com');
    const profile = await createProfile(agent, account.cookie);
    const checkout = await agent
      .post('/billing/dev-checkout')
      .set('Cookie', account.cookie)
      .send({
        siteProfileId: profile.id,
        plan: 'Complete',
        scope: { includeSubdomains: false, maxPages: 15 },
        aiConsent: { providers: ['anthropic'], noticeVersion: 'v1' },
      });
    expect(checkout.status).toBe(201);
    const scanId = checkout.body.data.scanId as string;
    await runScan(db, scanId);

    const dashboard = await agent.get(`/scans/${scanId}/dashboard`).set('Cookie', account.cookie);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.data.overall.score).toEqual(expect.any(Number));
    expect(dashboard.body.data.modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ module: 'Security' }),
        expect.objectContaining({ module: 'Performance', status: 'Unavailable' }),
      ]),
    );
    const moduleByName = new Map(
      dashboard.body.data.modules.map((module: { module: string }) => [module.module, module]),
    );
    expect(moduleByName.get('Accessibility')).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          standard: 'WCAG 2.2 AA',
          profiles: ['EN 301 549', 'Section 508'],
        }),
      }),
    );
    expect(moduleByName.get('Security')).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({ profile: 'Public Security Profile' }),
      }),
    );
    expect(moduleByName.get('AI SEO / GEO')).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({ providerTokenRequired: false }),
      }),
    );

    const issues = await agent
      .get(`/scans/${scanId}/issues?limit=10`)
      .set('Cookie', account.cookie);
    expect(issues.status).toBe(200);
    expect(issues.body.data.length).toBeGreaterThan(0);
    const issueId = issues.body.data[0].id as string;
    const issueUpdate = await agent
      .patch(`/scans/${scanId}/issues/${issueId}`)
      .set('Cookie', account.cookie)
      .send({ status: 'Acknowledged' });
    expect(issueUpdate.status).toBe(200);
    expect(issueUpdate.body.data.status).toBe('Acknowledged');

    const jsonExport = await agent
      .get(`/scans/${scanId}/export?format=json`)
      .set('Cookie', account.cookie);
    expect(jsonExport.status).toBe(200);
    expect(jsonExport.body.data.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ record_type: 'summary' }),
        expect.objectContaining({ record_type: 'module', module: 'SEO' }),
        expect.objectContaining({ record_type: 'issue' }),
      ]),
    );
    const csvExport = await agent
      .get(`/scans/${scanId}/export?format=csv`)
      .set('Cookie', account.cookie);
    expect(csvExport.status).toBe(200);
    expect(csvExport.headers['content-type']).toContain('text/csv');
    expect(csvExport.text.split('\n')[0]).toContain('record_type');
  });

  it('runs Basic but rejects export', async () => {
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'basic@example.com');
    const profile = await createProfile(agent, account.cookie);
    const checkout = await agent
      .post('/billing/dev-checkout')
      .set('Cookie', account.cookie)
      .send({
        siteProfileId: profile.id,
        plan: 'Basic',
        scope: { includeSubdomains: false, maxPages: 15 },
        aiConsent: { providers: ['anthropic'], noticeVersion: 'v1' },
      });
    const scanId = checkout.body.data.scanId as string;
    await runScan(db, scanId);
    const scan = await agent.get(`/scans/${scanId}`).set('Cookie', account.cookie);
    expect(scan.body.data.status).toBe('Completed');
    const exportResponse = await agent.get(`/scans/${scanId}/export`).set('Cookie', account.cookie);
    expect(exportResponse.status).toBe(403);
    expect(exportResponse.body.error.code).toBe('EXPORT_COMPLETE_ONLY');
  });

  it('retries an unreachable paid scan once and records the external-output refund', async () => {
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'offline@example.com');
    const profile = await createProfile(agent, account.cookie);
    const checkout = await agent
      .post('/billing/dev-checkout')
      .set('Cookie', account.cookie)
      .send({
        siteProfileId: profile.id,
        plan: 'Complete',
        scope: { includeSubdomains: false, maxPages: 15 },
      });
    const scanId = checkout.body.data.scanId as string;
    const result = await processScan(
      {
        prisma: db.prisma,
        logger: silentLogger,
        createAiProvider: (scan, siteProfile) =>
          createDefaultAiProvider(siteProfile.name, new URL(scan.domain).hostname),
        crawl: {
          originOverride: () => fixture.origin,
          dangerouslyAllowLoopback: true,
          fetcher: async () => {
            throw new Error('fixture offline');
          },
        },
      },
      scanId,
    );
    expect(result.outcome).toBe('Failed');
    const stored = await db.prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
    expect(stored.status).toBe('Failed');
    expect(stored.moduleRetryCount).toBe(1);
    const refund = await db.prisma.refundRecord.findUniqueOrThrow({
      where: { purchaseId: stored.purchaseId as string },
    });
    expect(refund.reasonCode).toBe('EXTERNAL_NO_USABLE_OUTPUT');
  });

  it('does not allow a module retry after entitlement expiry', async () => {
    const now = new Date('2026-09-03T12:00:00.000Z');
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
      now: () => now,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'expired@example.com');
    const profile = await createProfile(agent, account.cookie);
    const checkout = await agent
      .post('/billing/dev-checkout')
      .set('Cookie', account.cookie)
      .send({
        siteProfileId: profile.id,
        plan: 'Basic',
        scope: { includeSubdomains: false, maxPages: 15 },
      });
    const scanId = checkout.body.data.scanId as string;
    const purchaseId = checkout.body.data.purchaseId as string;
    await db.prisma.scan.update({ where: { id: scanId }, data: { status: 'Partial' } });
    await db.prisma.entitlement.update({
      where: { purchaseId },
      data: { expiresAt: new Date(now.getTime() - 1) },
    });

    const retry = await agent.post(`/scans/${scanId}/retry`).set('Cookie', account.cookie).send({});
    expect(retry.status).toBe(403);
    expect(retry.body.error.code).toBe('ENTITLEMENT_INACTIVE');
  });

  it('automatically selects a retryable planned module instead of an unavailable stub', async () => {
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'module-retry@example.com');
    const profile = await createProfile(agent, account.cookie);
    const checkout = await agent
      .post('/billing/dev-checkout')
      .set('Cookie', account.cookie)
      .send({
        siteProfileId: profile.id,
        plan: 'Complete',
        scope: { includeSubdomains: false, maxPages: 15 },
      });
    const scanId = checkout.body.data.scanId as string;
    await db.prisma.scan.update({ where: { id: scanId }, data: { status: 'Partial' } });
    await db.prisma.scanModule.createMany({
      data: [
        {
          scanId,
          module: 'Performance',
          runtimeStatus: 'Unavailable',
          statusReason: 'PerformanceRunnerUnavailable',
          usableOutput: false,
        },
        {
          scanId,
          module: 'Security',
          runtimeStatus: 'Partial',
          statusReason: 'ExternalModuleFailure',
          usableOutput: false,
        },
      ],
    });

    const retry = await agent.post(`/scans/${scanId}/retry`).set('Cookie', account.cookie).send({});
    expect(retry.status).toBe(202);
    expect(retry.body.data.module).toBe('Security');
    expect(await db.prisma.job.findUniqueOrThrow({ where: { scanId } })).toMatchObject({
      type: 'module-retry:Security',
      status: 'Pending',
    });
  });

  it('returns only the current Basic result and rejects explicit history access', async () => {
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'basic-history@example.com');
    const profile = await createProfile(agent, account.cookie);
    const checkout = (transactionId: string) =>
      agent
        .post('/billing/dev-checkout')
        .set('Cookie', account.cookie)
        .send({
          siteProfileId: profile.id,
          plan: 'Basic',
          scope: { includeSubdomains: false, maxPages: 15 },
          transactionId,
        });
    const first = await checkout('txn_history_1');
    const second = await checkout('txn_history_2');
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const current = await agent.get('/scans').set('Cookie', account.cookie);
    expect(current.status).toBe(200);
    expect(current.body.data).toHaveLength(1);
    expect(current.body.data[0].id).toBe(second.body.data.scanId);
    const history = await agent.get('/scans?history=true').set('Cookie', account.cookie);
    expect(history.status).toBe(403);
    expect(history.body.error.code).toBe('HISTORY_REQUIRES_COMPLETE');
  });

  it('deletes account-owned results and leaves only a content-free audit fact', async () => {
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'delete-me@example.com');
    const profile = await createProfile(agent, account.cookie);
    const checkout = await agent
      .post('/billing/dev-checkout')
      .set('Cookie', account.cookie)
      .send({
        siteProfileId: profile.id,
        plan: 'Basic',
        scope: { includeSubdomains: false, maxPages: 15 },
      });
    expect(checkout.status).toBe(201);

    const deleted = await agent.delete('/account').set('Cookie', account.cookie);
    expect(deleted.status).toBe(200);
    expect(deleted.body.data.deleted).toBe(true);
    expect((await agent.get('/auth/me')).status).toBe(401);
    expect(await db.prisma.account.count({ where: { id: account.id } })).toBe(0);
    expect(await db.prisma.siteProfile.count({ where: { id: profile.id } })).toBe(0);
    expect(await db.prisma.scan.count({ where: { accountId: account.id } })).toBe(0);
    expect(await db.prisma.purchase.count({ where: { accountId: account.id } })).toBe(0);
    expect(await db.prisma.webhookEvent.count({ where: { accountId: account.id } })).toBe(0);
    expect(await db.prisma.accountDeletionAudit.count()).toBe(1);
  });

  async function register(agent: TestAgent, email: string) {
    const response = await agent
      .post('/auth/register')
      .send({ email, password: 'correct-horse-1' });
    expect(response.status).toBe(201);
    const cookie = response.headers['set-cookie']?.[0]?.split(';', 1)[0];
    if (cookie === undefined) throw new Error('registration did not set a session cookie');
    return { cookie, id: response.body.data.accountId as string };
  }

  async function createProfile(agent: TestAgent, cookie: string, domain = 'https://example.com') {
    const response = await agent
      .post('/profiles')
      .set('Cookie', cookie)
      .send({ name: 'Fixture Site', domain });
    expect(response.status).toBe(201);
    return response.body.data as { id: string };
  }

  async function runScan(testDb: TestDb, scanId: string): Promise<void> {
    const profile = await testDb.prisma.scan.findUniqueOrThrow({
      where: { id: scanId },
      include: { siteProfile: true },
    });
    const result = await processScan(
      {
        prisma: testDb.prisma,
        logger: silentLogger,
        createAiProvider: (scan, siteProfile) =>
          createDefaultAiProvider(siteProfile.name, new URL(scan.domain).hostname),
        crawl: { originOverride: () => fixture.origin, dangerouslyAllowLoopback: true },
      },
      profile.id,
    );
    expect(['Completed', 'Partial', 'Failed']).toContain(result.outcome);
  }
});
