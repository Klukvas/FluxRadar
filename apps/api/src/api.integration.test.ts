import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './index.ts';
import { recoverClaimedJobs } from './orchestrator/claim.ts';
import { createDefaultAiProvider } from './orchestrator/geo.ts';
import { processPendingJobs, processScan } from './orchestrator/worker.ts';
import { silentLogger } from './http/logger.ts';
import { deleteAccountData } from './data-retention.ts';
import { FREE_CHECK_SCORING_REASON } from './orchestrator/free-check.ts';
import { purchaseScan } from './test-utils/purchase-scan.ts';
import { createTestDb, type TestDb } from './test-utils/test-db.ts';
import { FREE_CHECK_RULE_IDS } from '@fluxradar/contracts';
import { CURRENT_AI_PROCESSING_NOTICE_VERSION } from '@fluxradar/ai';
import { startFixtureSite, type FixtureSite } from '@fluxradar/crawler';

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
    // The pair the report has to reconcile, pinned on both halves: the overall
    // verdict above is `insufficient_data` with a weighted coverage of 0 because
    // Free carries no tariff score weight (D-123) — while the SEO row itself ran
    // every check it had and says so. A screen that printed both verbatim told
    // the owner a completed check had failed.
    const seo = (dashboard.body.data.modules as Record<string, unknown>[]).find(
      (module) => module.module === 'SEO',
    );
    expect(seo).toMatchObject({
      module: 'SEO',
      status: 'Completed',
      score: null,
      usableOutput: true,
      coverage: 1,
    });
    expect(seo?.completedApplicableChecks).toBe(seo?.applicableChecks);
    expect(seo?.applicableChecks).toBeGreaterThan(0);
    // And the row names the four homepage rules it ran, not the paid module's
    // structured-data and social-preview checks.
    expect(seo?.metadata).toMatchObject({
      freeCheck: true,
      scope: 'homepage only',
      scoring: FREE_CHECK_SCORING_REASON,
    });
    expect((seo?.metadata as { checks: unknown[] }).checks).toHaveLength(
      FREE_CHECK_RULE_IDS.length,
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

  // ─── Free-check allowlist ──────────────────────────────────────────────────
  //
  // FLUXRADAR_FREE_CHECK_ALLOWED_ORIGINS names the origins this deployment runs
  // itself (the demo site, a customer site being reproduced during support).
  // They skip BOTH Free-check limits: the account's one-time flag and the global
  // per-domain claim. Everything else keeps the limits above, unchanged.
  // ───────────────────────────────────────────────────────────────────────────
  it('lets an allowlisted origin run the Free check repeatedly, from any account', async () => {
    const app = createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
      freeCheckAllowedOrigins: new Set(['https://demo.example.com']),
    });
    const agent = request.agent(app);
    const account = await register(agent, 'allowlisted@example.com');
    // Stored as the normalized origin, which is what the allowlist is matched
    // against — an operator writing either spelling means the same site.
    const profile = await createProfile(agent, account.cookie, 'https://DEMO.example.com/');

    const runs = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      runs.push(
        await agent
          .post(`/profiles/${profile.id}/free-check`)
          .set('Cookie', account.cookie)
          .send({}),
      );
    }
    expect(runs.map(({ status }) => status)).toEqual([201, 201, 201]);

    // Neither limit was spent, so nothing has to be undone later to run again.
    expect(
      await db.prisma.account.count({ where: { id: account.id, freeCheckUsedAt: null } }),
    ).toBe(1);
    expect(
      await db.prisma.freeCheckClaim.count({ where: { origin: 'https://demo.example.com' } }),
    ).toBe(0);

    // The global claim is what normally stops a second account; an allowlisted
    // origin is exempt from that too.
    const otherAgent = request.agent(app);
    const otherAccount = await register(otherAgent, 'allowlisted-second@example.com');
    const otherProfile = await createProfile(
      otherAgent,
      otherAccount.cookie,
      'https://demo.example.com',
    );
    const secondAccountRun = await otherAgent
      .post(`/profiles/${otherProfile.id}/free-check`)
      .set('Cookie', otherAccount.cookie)
      .send({});
    expect(secondAccountRun.status).toBe(201);
  });

  it('keeps both Free-check limits for an origin the allowlist does not name', async () => {
    const app = createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
      // A near miss on purpose: the allowlist is exact, so a subdomain of an
      // allowlisted origin is a different site and stays limited.
      freeCheckAllowedOrigins: new Set(['https://demo.example.com']),
    });
    const agent = request.agent(app);
    const account = await register(agent, 'not-allowlisted@example.com');
    const profile = await createProfile(agent, account.cookie, 'https://www.demo.example.com');

    const first = await agent
      .post(`/profiles/${profile.id}/free-check`)
      .set('Cookie', account.cookie)
      .send({});
    expect(first.status).toBe(201);
    const second = await agent
      .post(`/profiles/${profile.id}/free-check`)
      .set('Cookie', account.cookie)
      .send({});
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('FREE_CHECK_USED');

    const otherAgent = request.agent(app);
    const otherAccount = await register(otherAgent, 'not-allowlisted-second@example.com');
    const otherProfile = await createProfile(
      otherAgent,
      otherAccount.cookie,
      'https://www.demo.example.com',
    );
    const sameDomain = await otherAgent
      .post(`/profiles/${otherProfile.id}/free-check`)
      .set('Cookie', otherAccount.cookie)
      .send({});
    expect(sameDomain.status).toBe(409);
    expect(sameDomain.body.error.code).toBe('FREE_CHECK_DOMAIN_USED');
    expect(
      await db.prisma.freeCheckClaim.count({ where: { origin: 'https://www.demo.example.com' } }),
    ).toBe(1);
  });

  it('allows the configured internal email to run a paid plan without a purchase', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const app = createApp({
        prisma: db.prisma,
        autoProcess: false,
        logger: silentLogger,
        internalFreeEmails: new Set(['pavlenkoandrey56@gmail.com']),
      });
      const agent = request.agent(app);
      const account = await register(agent, 'PAVLENKOANDREY56@GMAIL.COM');
      const profile = await createProfile(agent, account.cookie);

      const checkout = await agent
        .post('/billing/internal-checkout')
        .set('Cookie', account.cookie)
        .send({
          siteProfileId: profile.id,
          plan: 'Complete',
          scope: { includeSubdomains: false, maxPages: 15 },
          aiConsent: {
            providers: ['anthropic'],
            noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
          },
        });

      expect(checkout.status).toBe(201);
      // Exactly these fields: no purchase exists, so the response names none.
      expect(checkout.body.data).toEqual({
        scanId: expect.any(String),
        plan: 'Complete',
        billing: 'internal-free',
      });
      expect((await agent.get('/auth/me').set('Cookie', account.cookie)).body.data).toMatchObject({
        email: 'pavlenkoandrey56@gmail.com',
        internalFreeAccess: true,
      });
      expect(await db.prisma.purchase.count()).toBe(0);
      expect(
        await db.prisma.scan.count({ where: { accountId: account.id, plan: 'Complete' } }),
      ).toBe(1);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('runs Complete through the worker, exposes issues/dashboard, and exports JSON/CSV', async () => {
    const app = createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'complete@example.com');
    const profile = await createProfile(agent, account.cookie);
    const checkout = await purchaseScan(db.prisma, {
      siteProfileId: profile.id,
      plan: 'Complete',
      scope: { includeSubdomains: false, maxPages: 15 },
      aiConsent: {
        providers: ['anthropic', 'openai'],
        noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
      },
    });
    const scanId = checkout.scanId;
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
    // The per-rule coverage proof the Resolved policy stores in the module row
    // (orchestrator/run-coverage.ts) is internal: the report gets `ruleChecks`,
    // not a list of every URL each rule read.
    for (const module of dashboard.body.data.modules as { metadata?: unknown }[]) {
      expect(module.metadata).not.toHaveProperty('coverageProof');
    }

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
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'basic@example.com');
    const profile = await createProfile(agent, account.cookie);
    const checkout = await purchaseScan(db.prisma, {
      siteProfileId: profile.id,
      plan: 'Basic',
      scope: { includeSubdomains: false, maxPages: 15 },
      aiConsent: {
        providers: ['anthropic', 'openai'],
        noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
      },
    });
    const scanId = checkout.scanId;
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
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'offline@example.com');
    const profile = await createProfile(agent, account.cookie);
    const checkout = await purchaseScan(db.prisma, {
      siteProfileId: profile.id,
      plan: 'Complete',
      scope: { includeSubdomains: false, maxPages: 15 },
    });
    const scanId = checkout.scanId;
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
      autoProcess: false,
      logger: silentLogger,
      now: () => now,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'expired@example.com');
    const profile = await createProfile(agent, account.cookie);
    const checkout = await purchaseScan(db.prisma, {
      siteProfileId: profile.id,
      plan: 'Basic',
      scope: { includeSubdomains: false, maxPages: 15 },
    });
    const scanId = checkout.scanId;
    const purchaseId = checkout.purchaseId;
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
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'module-retry@example.com');
    const profile = await createProfile(agent, account.cookie);
    const checkout = await purchaseScan(db.prisma, {
      siteProfileId: profile.id,
      plan: 'Complete',
      scope: { includeSubdomains: false, maxPages: 15 },
    });
    const scanId = checkout.scanId;
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

  it('allows an unavailable UX/Conversion module to be retried on Complete', async () => {
    const app = createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'ux-module-retry@example.com');
    const profile = await createProfile(agent, account.cookie);
    const checkout = await purchaseScan(db.prisma, {
      siteProfileId: profile.id,
      plan: 'Complete',
      scope: { includeSubdomains: false, maxPages: 15 },
    });
    const scanId = checkout.scanId;
    await db.prisma.scan.update({ where: { id: scanId }, data: { status: 'Partial' } });
    await db.prisma.scanModule.create({
      data: {
        scanId,
        module: 'UX/Conversion',
        runtimeStatus: 'Unavailable',
        statusReason: 'ProviderUnavailable',
        usableOutput: false,
      },
    });

    const retry = await agent
      .post(`/scans/${scanId}/retry`)
      .set('Cookie', account.cookie)
      .send({ module: 'UX/Conversion' });

    expect(retry.status).toBe(202);
    expect(retry.body.data.module).toBe('UX/Conversion');
    expect(await db.prisma.job.findUniqueOrThrow({ where: { scanId } })).toMatchObject({
      type: 'module-retry:UX/Conversion',
      status: 'Pending',
    });
  });

  it('returns only the current Basic result and rejects explicit history access', async () => {
    const app = createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'basic-history@example.com');
    const profile = await createProfile(agent, account.cookie);
    const buyBasic = () =>
      purchaseScan(db.prisma, {
        siteProfileId: profile.id,
        plan: 'Basic',
        scope: { maxPages: 15 },
      });
    await buyBasic();
    const second = await buyBasic();

    const current = await agent.get('/scans').set('Cookie', account.cookie);
    expect(current.status).toBe(200);
    expect(current.body.data).toHaveLength(1);
    expect(current.body.data[0].id).toBe(second.scanId);
    const history = await agent.get('/scans?history=true').set('Cookie', account.cookie);
    expect(history.status).toBe(403);
    expect(history.body.error.code).toBe('HISTORY_REQUIRES_COMPLETE');
  });

  it('restores only the current account active scan and keeps scan IDs tenant-scoped', async () => {
    const app = createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
    });
    const agentA = request.agent(app);
    const agentB = request.agent(app);
    const accountA = await register(agentA, 'active-a@example.com');
    const accountB = await register(agentB, 'active-b@example.com');
    const profileA = await createProfile(agentA, accountA.cookie);
    const checkout = await purchaseScan(db.prisma, {
      siteProfileId: profileA.id,
      plan: 'Basic',
      scope: { includeSubdomains: false, maxPages: 15 },
    });
    const scanId = checkout.scanId;

    const active = await agentA.get('/scans/active').set('Cookie', accountA.cookie);
    expect(active.status).toBe(200);
    expect(active.body.data).toMatchObject({ id: scanId, status: 'Pending' });
    const repeated = await agentA.get('/scans/active').set('Cookie', accountA.cookie);
    expect(repeated.body.data.id).toBe(scanId);
    expect(await db.prisma.scan.count({ where: { accountId: accountA.id } })).toBe(1);
    expect(await db.prisma.job.count({ where: { scanId } })).toBe(1);

    const otherActive = await agentB.get('/scans/active').set('Cookie', accountB.cookie);
    expect(otherActive.status).toBe(200);
    expect(otherActive.body.data).toBeNull();
    const forbiddenScan = await agentB.get(`/scans/${scanId}`).set('Cookie', accountB.cookie);
    expect(forbiddenScan.status).toBe(404);
    expect(forbiddenScan.body.error.code).toBe('NOT_FOUND');
  });

  it('recovers a claimed job and drains it once without creating another job', async () => {
    const app = createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'recovery@example.com');
    const profile = await createProfile(agent, account.cookie, 'https://recovery.example.com');
    const created = await agent
      .post(`/profiles/${profile.id}/free-check`)
      .set('Cookie', account.cookie)
      .send({});
    expect(created.status).toBe(201);
    const scanId = created.body.data.id as string;
    const claimedAt = new Date('2026-09-04T00:00:00.000Z');
    await db.prisma.job.update({
      where: { scanId },
      data: { status: 'Claimed', claimedAt, attempts: 1 },
    });

    await expect(recoverClaimedJobs(db.prisma, new Date('2026-09-04T00:10:00.000Z'))).resolves.toBe(
      1,
    );
    const recovered = await db.prisma.job.findUniqueOrThrow({ where: { scanId } });
    expect(recovered).toMatchObject({ status: 'Pending', claimedAt: null, attempts: 1 });

    const results = await processPendingJobs({
      prisma: db.prisma,
      logger: silentLogger,
      createAiProvider: (scan, siteProfile) =>
        createDefaultAiProvider(siteProfile.name, new URL(scan.domain).hostname),
      crawl: { originOverride: () => fixture.origin, dangerouslyAllowLoopback: true },
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.scanId).toBe(scanId);
    expect(await db.prisma.scan.count({ where: { id: scanId } })).toBe(1);
    expect(await db.prisma.job.count({ where: { scanId } })).toBe(1);
    expect(await db.prisma.job.findUniqueOrThrow({ where: { scanId } })).toMatchObject({
      status: 'Done',
      attempts: 2,
      claimedAt: null,
    });
  });

  it('deletes account-owned results and leaves only a content-free audit fact', async () => {
    const deletedKeys: string[] = [];
    const objectStore = {
      putText: async () => undefined,
      deleteObject: async (key: string) => {
        deletedKeys.push(key);
      },
    };
    const app = createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
      objectStore,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'delete-me@example.com');
    const profile = await createProfile(agent, account.cookie);
    const checkout = await purchaseScan(db.prisma, {
      siteProfileId: profile.id,
      plan: 'Basic',
      scope: { includeSubdomains: false, maxPages: 15 },
    });
    const scanId = checkout.scanId;
    await db.prisma.integrationConnection.create({
      data: {
        accountId: account.id,
        provider: 'google',
        accessTokenEncrypted: 'v1:encrypted',
      },
    });
    await db.prisma.integrationOAuthState.create({
      data: {
        accountId: account.id,
        provider: 'google',
        stateHash: `state-${account.id}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await db.prisma.exportArtifact.create({
      data: {
        accountId: account.id,
        scanId,
        format: 'json',
        objectKey: `accounts/${account.id}/scans/${scanId}/report.json`,
        contentType: 'application/json',
      },
    });
    await db.prisma.checkoutSession.create({
      data: {
        provider: 'fastspring',
        reference: `frcs_${account.id}`,
        accountId: account.id,
        siteProfileId: profile.id,
        plan: 'Basic',
        productPath: 'fluxradar-basic-scan',
        expectedAmountUsd: 55,
        liveMode: false,
        scopeJson: JSON.stringify({ includeSubdomains: false }),
      },
    });

    const deleted = await agent.delete('/account').set('Cookie', account.cookie);
    expect(deleted.status).toBe(200);
    expect(deleted.body.data.deleted).toBe(true);
    expect((await agent.get('/auth/me')).status).toBe(401);
    expect(await db.prisma.account.count({ where: { id: account.id } })).toBe(0);
    expect(await db.prisma.siteProfile.count({ where: { id: profile.id } })).toBe(0);
    expect(await db.prisma.scan.count({ where: { accountId: account.id } })).toBe(0);
    expect(await db.prisma.purchase.count({ where: { accountId: account.id } })).toBe(0);
    expect(await db.prisma.integrationConnection.count({ where: { accountId: account.id } })).toBe(
      0,
    );
    expect(await db.prisma.integrationOAuthState.count({ where: { accountId: account.id } })).toBe(
      0,
    );
    expect(await db.prisma.exportArtifact.count({ where: { accountId: account.id } })).toBe(0);
    expect(await db.prisma.checkoutSession.count({ where: { accountId: account.id } })).toBe(0);
    expect(deletedKeys).toEqual([`accounts/${account.id}/scans/${scanId}/report.json`]);
    expect(await db.prisma.webhookEvent.count({ where: { accountId: account.id } })).toBe(0);
    expect(await db.prisma.accountDeletionAudit.count()).toBe(1);
    await expect(deleteAccountData(db.prisma, account.id, objectStore)).resolves.toEqual({
      orphanedArtifactCount: 0,
    });
    expect(await db.prisma.accountDeletionAudit.count()).toBe(1);
  });

  // A checkout session cascades from its site profile (the foreign key that keeps
  // an account deletion working after a rollback), so deleting the profile
  // mid-checkout would drop the binding the provider webhook needs and turn a
  // real charge into a rejected order. The route refuses while one is open.
  it('refuses to delete a site profile with a checkout in progress', async () => {
    const app = createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const account = await register(agent, 'open-checkout@example.com');
    const profile = await createProfile(agent, account.cookie);
    await db.prisma.checkoutSession.create({
      data: {
        provider: 'fastspring',
        reference: `frcs_open_${profile.id}`,
        accountId: account.id,
        siteProfileId: profile.id,
        plan: 'Basic',
        productPath: 'fluxradar-basic-scan',
        expectedAmountUsd: 55,
        liveMode: false,
        scopeJson: JSON.stringify({ includeSubdomains: false }),
      },
    });

    const blocked = await agent.delete(`/profiles/${profile.id}`).set('Cookie', account.cookie);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PROFILE_HAS_OPEN_CHECKOUT');
    expect(await db.prisma.siteProfile.count({ where: { id: profile.id } })).toBe(1);

    // Once the checkout is settled the profile can go — and the session goes with
    // it, which is the cascade the previous release's deletion order relies on.
    await db.prisma.checkoutSession.updateMany({
      where: { siteProfileId: profile.id },
      data: { status: 'rejected' },
    });
    const deleted = await agent.delete(`/profiles/${profile.id}`).set('Cookie', account.cookie);
    expect(deleted.status).toBe(200);
    expect(await db.prisma.checkoutSession.count({ where: { siteProfileId: profile.id } })).toBe(0);
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
