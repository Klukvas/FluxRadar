import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { severityRank } from '@fluxradar/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../index.ts';
import { PURCHASE_STATUSES } from '../billing/constants.ts';
import { silentLogger } from '../http/logger.ts';
import { createTestDb, TEST_WEBHOOK_SECRET, type TestDb } from '../test-utils/test-db.ts';

// The Issue Center's order, its rule view and the "what changed" read.
//
// Severity is stored as text, and the list used to sort on it: Critical, High,
// Low, Medium — Low findings above Medium ones, right under a legend promising
// the opposite. The rule summary and the scan comparison are what the report's
// "fix these first" and "since last scan" blocks read.

type TestAgent = ReturnType<typeof request.agent>;

const NOW = new Date('2026-09-18T12:00:00.000Z');

interface SeedIssue {
  readonly ruleId: string;
  readonly severity: string;
  readonly fingerprint: string;
  readonly status?: string;
  readonly module?: string;
}

describe('issue order, rule summary and scan changes', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  function makeApp() {
    return createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
      now: () => NOW,
    });
  }

  async function signUp(app: ReturnType<typeof makeApp>, email: string) {
    const agent = request.agent(app);
    const response = await agent
      .post('/auth/register')
      .send({ email, password: 'correct-horse-1' });
    expect(response.status).toBe(201);
    const cookie = response.headers['set-cookie']?.[0]?.split(';', 1)[0];
    if (cookie === undefined) throw new Error('registration did not set a session cookie');
    const profile = await agent
      .post('/profiles')
      .set('Cookie', cookie)
      .send({ name: 'Fixture Site', domain: `https://${email.split('@')[0]}.example.com` });
    expect(profile.status).toBe(201);
    return { agent, cookie, profileId: profile.body.data.id as string };
  }

  async function paidScan(agent: TestAgent, cookie: string, profileId: string): Promise<string> {
    const checkout = await agent
      .post('/billing/dev-checkout')
      .set('Cookie', cookie)
      .send({
        siteProfileId: profileId,
        plan: 'Complete',
        scope: { includeSubdomains: false, maxPages: 15 },
      });
    expect(checkout.status).toBe(201);
    return checkout.body.data.scanId as string;
  }

  async function seed(prisma: PrismaClient, scanId: string, issues: readonly SeedIssue[]) {
    const scan = await prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
    await prisma.issue.createMany({
      data: issues.map((issue) => ({
        scanId,
        ruleId: issue.ruleId,
        module: issue.module ?? 'SEO',
        fingerprint: issue.fingerprint,
        severity: issue.severity,
        severityRank: severityRank(issue.severity),
        category: 'on-page',
        status: issue.status ?? 'New',
        targetKind: 'page',
        normalizedUrl: `${scan.domain}/${issue.fingerprint}`,
        normalizedResource: '',
        normalizedSelector: '',
        normalizedParameter: '',
        ruleVariant: 'v1',
        targetUrl: `${scan.domain}/${issue.fingerprint}`,
        evidenceType: 'dom',
        recommendation: 'Fix it',
        confidence: 1,
        applicableTargets: 1,
        affectedTargets: 1,
        rulePenalty: 0,
        scoreDelta: 0,
        observedAt: NOW,
      })),
    });
    await prisma.scan.update({
      where: { id: scanId },
      data: { status: 'Completed', startedAt: NOW, completedAt: NOW },
    });
  }

  it('lists findings by urgency, not by the alphabetical order of the severity', async () => {
    const app = makeApp();
    const owner = await signUp(app, 'order@example.com');
    const scanId = await paidScan(owner.agent, owner.cookie, owner.profileId);
    await seed(db.prisma, scanId, [
      { ruleId: 'SEO-ONPAGE-002', severity: 'Low', fingerprint: 'fp-a' },
      { ruleId: 'SEO-ONPAGE-001', severity: 'Medium', fingerprint: 'fp-b' },
      { ruleId: 'SEC-ASVS-001', severity: 'Critical', fingerprint: 'fp-c' },
      { ruleId: 'SEC-PASSIVE-003', severity: 'High', fingerprint: 'fp-d' },
    ]);

    const response = await owner.agent.get(`/scans/${scanId}/issues`).set('Cookie', owner.cookie);

    expect(response.status).toBe(200);
    expect(response.body.data.map((issue: { severity: string }) => issue.severity)).toEqual([
      'Critical',
      'High',
      'Medium',
      'Low',
    ]);
  });

  it('filters by rule and searches without regard to case', async () => {
    const app = makeApp();
    const owner = await signUp(app, 'filter@example.com');
    const scanId = await paidScan(owner.agent, owner.cookie, owner.profileId);
    await seed(db.prisma, scanId, [
      { ruleId: 'SEO-ONPAGE-002', severity: 'Medium', fingerprint: 'fp-1' },
      { ruleId: 'SEO-ONPAGE-002', severity: 'Medium', fingerprint: 'fp-2' },
      { ruleId: 'SEO-ONPAGE-001', severity: 'High', fingerprint: 'fp-3' },
    ]);

    const byRule = await owner.agent
      .get(`/scans/${scanId}/issues?ruleId=SEO-ONPAGE-002`)
      .set('Cookie', owner.cookie);
    const bySearch = await owner.agent
      .get(`/scans/${scanId}/issues?search=seo-onpage-001`)
      .set('Cookie', owner.cookie);

    expect(byRule.body.data).toHaveLength(2);
    expect(byRule.body.meta.total).toBe(2);
    expect(bySearch.body.data.map((issue: { ruleId: string }) => issue.ruleId)).toEqual([
      'SEO-ONPAGE-001',
    ]);
  });

  it('folds findings by rule, most urgent first, counting only open ones as work', async () => {
    const app = makeApp();
    const owner = await signUp(app, 'summary@example.com');
    const scanId = await paidScan(owner.agent, owner.cookie, owner.profileId);
    await seed(db.prisma, scanId, [
      { ruleId: 'SEO-ONPAGE-002', severity: 'Medium', fingerprint: 'fp-1' },
      { ruleId: 'SEO-ONPAGE-002', severity: 'Medium', fingerprint: 'fp-2' },
      { ruleId: 'SEO-ONPAGE-002', severity: 'Medium', fingerprint: 'fp-3', status: 'Ignored' },
      { ruleId: 'SEC-ASVS-001', severity: 'Critical', fingerprint: 'fp-4', module: 'Security' },
      { ruleId: 'SEO-TECH-001', severity: 'Low', fingerprint: 'fp-5' },
    ]);

    const response = await owner.agent
      .get(`/scans/${scanId}/issues/summary`)
      .set('Cookie', owner.cookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      total: 5,
      open: 4,
      bySeverity: { Critical: 1, High: 0, Medium: 2, Low: 1 },
      groups: [
        {
          ruleId: 'SEC-ASVS-001',
          module: 'Security',
          severity: 'Critical',
          issues: 1,
          openIssues: 1,
        },
        { ruleId: 'SEO-ONPAGE-002', module: 'SEO', severity: 'Medium', issues: 3, openIssues: 2 },
        { ruleId: 'SEO-TECH-001', module: 'SEO', severity: 'Low', issues: 1, openIssues: 1 },
      ],
    });
  });

  it('lists a rule once, however many severities its findings carry', async () => {
    const app = makeApp();
    const owner = await signUp(app, 'duplicates@example.com');
    const scanId = await paidScan(owner.agent, owner.cookie, owner.profileId);
    // The UX AI rules take their severity from the model, per finding, so one
    // rule legitimately produces findings at several severities. Grouping by
    // rule + severity listed UX-CONV-AI-002 twice — a Medium row and a Low row,
    // both opening the same findings, which reads as broken data.
    await seed(db.prisma, scanId, [
      {
        ruleId: 'UX-CONV-AI-002',
        module: 'UX/Conversion',
        severity: 'Medium',
        fingerprint: 'ux-1',
      },
      { ruleId: 'UX-CONV-AI-002', module: 'UX/Conversion', severity: 'Low', fingerprint: 'ux-2' },
      { ruleId: 'UX-CONV-AI-002', module: 'UX/Conversion', severity: 'Low', fingerprint: 'ux-3' },
    ]);

    const response = await owner.agent
      .get(`/scans/${scanId}/issues/summary`)
      .set('Cookie', owner.cookie);

    expect(response.body.data.groups).toEqual([
      {
        ruleId: 'UX-CONV-AI-002',
        module: 'UX/Conversion',
        // The row wears the worst of them: that is the urgency being asked for.
        severity: 'Medium',
        issues: 3,
        openIssues: 3,
      },
    ]);
    // The breakdown still counts each finding under its own severity — folding
    // the row must not move two Low findings into the Medium column.
    expect(response.body.data.bySeverity).toEqual({ Critical: 0, High: 0, Medium: 1, Low: 2 });
  });

  it('says what a re-scan fixed, introduced and kept, against the previous scan of the profile', async () => {
    const app = makeApp();
    const owner = await signUp(app, 'changes@example.com');
    const firstId = await paidScan(owner.agent, owner.cookie, owner.profileId);
    await seed(db.prisma, firstId, [
      { ruleId: 'SEO-ONPAGE-002', severity: 'Medium', fingerprint: 'kept' },
      { ruleId: 'SEC-ASVS-001', severity: 'Critical', fingerprint: 'fixed-1' },
      { ruleId: 'SEC-ASVS-001', severity: 'Critical', fingerprint: 'fixed-2' },
    ]);
    const secondId = await paidScan(owner.agent, owner.cookie, owner.profileId);
    await seed(db.prisma, secondId, [
      { ruleId: 'SEO-ONPAGE-002', severity: 'Medium', fingerprint: 'kept' },
      { ruleId: 'SEO-TECH-001', severity: 'Low', fingerprint: 'new-1' },
    ]);

    const response = await owner.agent
      .get(`/scans/${secondId}/changes`)
      .set('Cookie', owner.cookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      previous: { id: firstId, plan: 'Complete' },
      introduced: 1,
      fixed: 2,
      persisting: 1,
      introducedByRule: [{ ruleId: 'SEO-TECH-001', severity: 'Low', count: 1 }],
      fixedByRule: [{ ruleId: 'SEC-ASVS-001', severity: 'Critical', count: 2 }],
    });
    // The first scan has nothing before it to compare with.
    const first = await owner.agent.get(`/scans/${firstId}/changes`).set('Cookie', owner.cookie);
    expect(first.body.data.previous).toBeNull();
  });

  /** Rewrites where a scan's crawl is recorded as having left from; undefined = before D-228. */
  async function recordLocation(scanId: string, location: string | undefined): Promise<void> {
    const scan = await db.prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
    const config = JSON.parse(scan.executionConfigJson ?? '{}') as {
      scope: Record<string, unknown>;
    };
    const scope = Object.fromEntries(
      Object.entries(config.scope).filter(([key]) => key !== 'egressLocation'),
    );
    const recorded = location === undefined ? scope : { ...scope, egressLocation: location };
    await db.prisma.scan.update({
      where: { id: scanId },
      data: {
        executionConfigJson: JSON.stringify({ ...config, scope: recorded }),
        scopeJson: JSON.stringify(recorded),
      },
    });
  }

  it.each([
    ['ua', 'ua', 'same'],
    ['de', 'ua', 'different'],
    [undefined, 'ua', 'unrecorded'],
    [undefined, undefined, 'unrecorded'],
  ] as const)(
    'says whether the two crawls left from the same place (%s then %s: %s)',
    async (earlier, later, comparison) => {
      // Findings from two countries are two measurements, not a trend: a site
      // can show Kyiv one language, redirect and banner, and Frankfurt another.
      const app = makeApp();
      const owner = await signUp(app, `egress-${comparison}-${String(earlier)}@example.com`);
      const firstId = await paidScan(owner.agent, owner.cookie, owner.profileId);
      await seed(db.prisma, firstId, [
        { ruleId: 'SEO-TECH-001', severity: 'Low', fingerprint: 'a' },
      ]);
      await recordLocation(firstId, earlier);
      const secondId = await paidScan(owner.agent, owner.cookie, owner.profileId);
      await seed(db.prisma, secondId, []);
      await recordLocation(secondId, later);

      const response = await owner.agent
        .get(`/scans/${secondId}/changes`)
        .set('Cookie', owner.cookie);

      expect(response.body.data.egressComparison).toBe(comparison);
      expect(response.body.data.previous.egressLocation?.id ?? null).toBe(earlier ?? null);
      expect(response.body.data.egressLocation?.id ?? null).toBe(later ?? null);
    },
  );

  it('does not compare with a previous report whose payment was returned', async () => {
    const app = makeApp();
    const owner = await signUp(app, 'refunded-previous@example.com');
    const firstId = await paidScan(owner.agent, owner.cookie, owner.profileId);
    await seed(db.prisma, firstId, [
      { ruleId: 'SEC-ASVS-001', severity: 'Critical', fingerprint: 'x' },
    ]);
    const secondId = await paidScan(owner.agent, owner.cookie, owner.profileId);
    await seed(db.prisma, secondId, []);
    const first = await db.prisma.scan.findUniqueOrThrow({ where: { id: firstId } });
    await db.prisma.purchase.update({
      where: { id: first.purchaseId ?? '' },
      data: { status: PURCHASE_STATUSES.refunded },
    });

    const response = await owner.agent
      .get(`/scans/${secondId}/changes`)
      .set('Cookie', owner.cookie);

    expect(response.body.data).toMatchObject({ previous: null, fixed: 0 });
  });

  it("keeps another account's report out of reach", async () => {
    const app = makeApp();
    const owner = await signUp(app, 'owner@example.com');
    const stranger = await signUp(app, 'stranger@example.com');
    const scanId = await paidScan(owner.agent, owner.cookie, owner.profileId);
    await seed(db.prisma, scanId, [{ ruleId: 'SEO-TECH-001', severity: 'Low', fingerprint: 'fp' }]);

    const summary = await stranger.agent
      .get(`/scans/${scanId}/issues/summary`)
      .set('Cookie', stranger.cookie);
    const changes = await stranger.agent
      .get(`/scans/${scanId}/changes`)
      .set('Cookie', stranger.cookie);

    expect(summary.status).toBe(404);
    expect(changes.status).toBe(404);
  });
});
