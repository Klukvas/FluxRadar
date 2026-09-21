import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PURCHASE_STATUSES } from '../billing/constants.ts';
import {
  FINISHED_AT,
  PLAN_NOW,
  getPlan,
  planAnswer,
  planApp,
  planProvider,
  plannableScan,
  postPlan,
  settledRun,
} from '../test-utils/action-plan-fixtures.ts';
import { createTestDb, type TestDb } from '../test-utils/test-db.ts';
import { ACTION_PLAN_WINDOW_MS } from './policy.ts';

// Who may ask for an Action Plan, and when (D-232). Every refusal has its own
// code, in a fixed order, so the report can say the real reason.

const ANSWER = planAnswer([
  { ruleIds: ['SEC-PASSIVE-003'], title: 'Turn on HSTS' },
  { ruleIds: ['SEO-TECH-004', 'SEO-ONPAGE-002'], title: 'Fix the page head' },
]);

describe('POST /scans/:scanId/action-plan — who and when', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it('accepts a finished Complete scan with open issues and answers 202 before the provider', async () => {
    const provider = planProvider(ANSWER);
    const send = vi.spyOn(provider, 'send');
    const app = planApp(db.prisma, { provider });
    const { owner, scanId } = await plannableScan(db.prisma, app, 'accepted@example.com');

    const response = await postPlan(owner, scanId, 'en');

    expect(response.status).toBe(202);
    expect(response.body.data).toMatchObject({ scanId, language: 'en' });
    await settledRun(db.prisma, scanId);
    expect(send).toHaveBeenCalledTimes(1);
    const plan = await db.prisma.actionPlan.findUniqueOrThrow({
      where: { scanId_language: { scanId, language: 'en' } },
    });
    expect(plan).toMatchObject({
      modelId: 'claude-opus-5',
      promptVersion: 'action-plan-v1',
      noticeVersion: 'action-plan-notice-v1',
    });
  });

  it('refuses a Basic scan: the plan is part of Complete', async () => {
    const app = planApp(db.prisma, { provider: planProvider(ANSWER) });
    const { owner, scanId } = await plannableScan(db.prisma, app, 'basic@example.com', {
      plan: 'Basic',
    });

    const post = await postPlan(owner, scanId, 'en');
    const get = await getPlan(owner, scanId, 'en');

    expect(post.status).toBe(403);
    expect(post.body.error.code).toBe('ACTION_PLAN_COMPLETE_ONLY');
    expect(get.status).toBe(403);
    expect(get.body.error.code).toBe('ACTION_PLAN_COMPLETE_ONLY');
  });

  it.each([
    ['still running', { status: 'Running', completedAt: null, jobStatus: 'Claimed' }],
    // The worker writes Analytics after the status settles; the job is the signal.
    ['settled but its job not done', { status: 'Completed', jobStatus: 'Claimed' }],
  ])('refuses a scan that is %s', async (_case, finish) => {
    const app = planApp(db.prisma, { provider: planProvider(ANSWER) });
    const { owner, scanId } = await plannableScan(db.prisma, app, 'not-ready@example.com', finish);

    const response = await postPlan(owner, scanId, 'en');

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ACTION_PLAN_NOT_READY');
  });

  it.each(['Partial', 'Failed', 'Cancelled'])(
    'accepts a %s scan whose job is done',
    async (status) => {
      const app = planApp(db.prisma, { provider: planProvider(ANSWER) });
      const { owner, scanId } = await plannableScan(db.prisma, app, `${status}@example.com`, {
        status,
      });

      expect((await postPlan(owner, scanId, 'en')).status).toBe(202);
      await settledRun(db.prisma, scanId);
    },
  );

  it('refuses a refunded scan: its report is no longer the owner’s to read', async () => {
    const app = planApp(db.prisma, { provider: planProvider(ANSWER) });
    const { owner, scanId, purchaseId } = await plannableScan(
      db.prisma,
      app,
      'refunded@example.com',
    );
    await db.prisma.purchase.update({
      where: { id: purchaseId },
      data: { status: PURCHASE_STATUSES.refunded },
    });

    const post = await postPlan(owner, scanId, 'en');
    const get = await getPlan(owner, scanId, 'en');

    expect(post.status).toBe(403);
    expect(post.body.error.code).toBe('ENTITLEMENT_SUSPENDED');
    expect(get.status).toBe(403);
  });

  it('refuses new work after the entitlement expired, and still shows the report', async () => {
    const app = planApp(db.prisma, { provider: planProvider(ANSWER) });
    const { owner, scanId, purchaseId } = await plannableScan(
      db.prisma,
      app,
      'expired@example.com',
    );
    await db.prisma.entitlement.update({
      where: { purchaseId },
      data: { expiresAt: new Date(PLAN_NOW.getTime() - 1) },
    });

    const post = await postPlan(owner, scanId, 'en');
    const get = await getPlan(owner, scanId, 'en');

    expect(post.status).toBe(403);
    expect(post.body.error.code).toBe('ENTITLEMENT_INACTIVE');
    expect(get.status).toBe(200);
    expect(get.body.data.availability).toBe('window_closed');
  });

  it('closes the Plan Window three days after the latest run finished', async () => {
    const app = planApp(db.prisma, { provider: planProvider(ANSWER) });
    const closed = await plannableScan(db.prisma, app, 'closed@example.com', {
      completedAt: new Date(PLAN_NOW.getTime() - ACTION_PLAN_WINDOW_MS),
    });
    const lastMinute = await plannableScan(db.prisma, app, 'last-minute@example.com', {
      completedAt: new Date(PLAN_NOW.getTime() - ACTION_PLAN_WINDOW_MS + 60_000),
    });

    const refused = await postPlan(closed.owner, closed.scanId, 'en');
    const accepted = await postPlan(lastMinute.owner, lastMinute.scanId, 'en');

    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('ACTION_PLAN_WINDOW_CLOSED');
    expect(accepted.status).toBe(202);
    await settledRun(db.prisma, lastMinute.scanId);
  });

  it('refuses a scan whose only open issues are Analytics or settled', async () => {
    const app = planApp(db.prisma, { provider: planProvider(ANSWER) });
    const { owner, scanId } = await plannableScan(db.prisma, app, 'nothing@example.com', {
      issues: [
        { ruleId: 'ANALYTICS-SC-002', module: 'Analytics' },
        { ruleId: 'SEO-TECH-004', status: 'Ignored' },
        { ruleId: 'SEO-ONPAGE-002', status: 'False Positive' },
        { ruleId: 'SEC-PASSIVE-003', module: 'Security', status: 'Resolved' },
      ],
    });

    const response = await postPlan(owner, scanId, 'en');

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ACTION_PLAN_NOTHING_TO_PLAN');
  });

  it('answers 503 when no AI provider is configured', async () => {
    const app = planApp(db.prisma, { provider: null });
    const { owner, scanId } = await plannableScan(db.prisma, app, 'no-ai@example.com');

    const response = await postPlan(owner, scanId, 'en');

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('ACTION_PLAN_AI_UNAVAILABLE');
    expect(await db.prisma.actionPlanAttempt.count()).toBe(0);
  });

  it.each([
    ['an unknown code', { language: 'xx' }],
    ['a region tag', { language: 'en-US' }],
    ['no language at all', { language: undefined }],
  ])('answers 400 to %s', async (_case, body) => {
    const app = planApp(db.prisma, { provider: planProvider(ANSWER) });
    const { owner, scanId } = await plannableScan(db.prisma, app, 'language@example.com');

    const post = await owner.agent
      .post(`/scans/${scanId}/action-plan`)
      .set('Cookie', owner.cookie)
      .send({ noticeVersion: 'action-plan-notice-v1', ...body });
    const get = await owner.agent
      .get(`/scans/${scanId}/action-plan`)
      .query(body.language === undefined ? {} : { language: body.language })
      .set('Cookie', owner.cookie);

    expect(post.status).toBe(400);
    expect(get.status).toBe(400);
  });

  it('refuses consent given under a notice the button no longer shows', async () => {
    const app = planApp(db.prisma, { provider: planProvider(ANSWER) });
    const { owner, scanId } = await plannableScan(db.prisma, app, 'notice@example.com');

    const response = await postPlan(owner, scanId, 'en', {
      noticeVersion: 'action-plan-notice-v0',
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ACTION_PLAN_NOTICE_OUTDATED');
    expect(await db.prisma.actionPlanAttempt.count()).toBe(0);
  });

  it('keeps another account away from the scan', async () => {
    const app = planApp(db.prisma, { provider: planProvider(ANSWER) });
    const { scanId } = await plannableScan(db.prisma, app, 'owner@example.com');
    const stranger = await plannableScan(db.prisma, app, 'stranger@example.com');

    expect((await postPlan(stranger.owner, scanId, 'en')).status).toBe(404);
    expect((await getPlan(stranger.owner, scanId, 'en')).status).toBe(404);
  });
});

describe('GET /scans/:scanId/action-plan — what the report reads', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it('describes a scan with no plan yet: available, full budget, window end', async () => {
    const app = planApp(db.prisma, { provider: planProvider(ANSWER) });
    const { owner, scanId } = await plannableScan(db.prisma, app, 'fresh@example.com');

    const response = await getPlan(owner, scanId, 'uk');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      language: 'uk',
      availability: 'available',
      languages: [],
      run: null,
      lastFailure: null,
      remaining: { successes: 3, attempts: 6 },
      windowEndsAt: new Date(FINISHED_AT.getTime() + ACTION_PLAN_WINDOW_MS).toISOString(),
      plan: null,
    });
  });

  it('returns the plan with live counts, Reach and the caveats the server adds', async () => {
    const app = planApp(db.prisma, { provider: planProvider(ANSWER) });
    const { owner, scanId } = await plannableScan(db.prisma, app, 'ready@example.com');
    await postPlan(owner, scanId, 'en');
    await settledRun(db.prisma, scanId);

    const response = await getPlan(owner, scanId, 'en');

    expect(response.status).toBe(200);
    const view = response.body.data;
    expect(view).toMatchObject({
      availability: 'available',
      languages: ['en'],
      run: null,
      lastFailure: null,
      remaining: { successes: 2, attempts: 5 },
    });
    expect(view.plan).toMatchObject({
      language: 'en',
      generatedAt: PLAN_NOW.toISOString(),
      modelId: 'claude-opus-5',
      overview: expect.any(String),
      // Analytics' open issue counts in the denominator though no plan addresses it.
      reach: { addressed: 4, open: 5, rules: 3 },
      // Performance was only partly checked; GEO and Analytics never reach a plan.
      caveats: [{ module: 'Performance', status: 'Partial' }],
    });
    expect(
      view.plan.actions.map(
        (action: { title: string; openIssues: number; totalIssues: number }) => [
          action.title,
          action.openIssues,
          action.totalIssues,
        ],
      ),
    ).toEqual([
      ['Turn on HSTS', 1, 1],
      ['Fix the page head', 3, 3],
    ]);
  });

  it('offers the plan of another language by listing it, without returning it', async () => {
    const app = planApp(db.prisma, { provider: planProvider(ANSWER) });
    const { owner, scanId } = await plannableScan(db.prisma, app, 'other-language@example.com');
    await postPlan(owner, scanId, 'uk');
    await settledRun(db.prisma, scanId);

    const response = await getPlan(owner, scanId, 'en');

    expect(response.body.data).toMatchObject({ languages: ['uk'], plan: null });
  });

  it('reports the last failure by code only', async () => {
    const provider = planProvider({
      status: 'completed',
      output_text: 'I would rather not write JSON today: SECRET-PROVIDER-TEXT',
    });
    const app = planApp(db.prisma, { provider });
    const { owner, scanId } = await plannableScan(db.prisma, app, 'failure@example.com');
    await postPlan(owner, scanId, 'de');
    await settledRun(db.prisma, scanId);

    const response = await getPlan(owner, scanId, 'de');

    expect(response.body.data).toMatchObject({
      lastFailure: { code: 'invalid_output', language: 'de', at: PLAN_NOW.toISOString() },
      remaining: { successes: 3, attempts: 5 },
      plan: null,
    });
    const attempt = await db.prisma.actionPlanAttempt.findFirstOrThrow({ where: { scanId } });
    expect(JSON.stringify(attempt)).not.toContain('SECRET-PROVIDER-TEXT');
    expect(JSON.stringify(response.body)).not.toContain('SECRET-PROVIDER-TEXT');
  });

  it('says why a plan cannot be asked for', async () => {
    const app = planApp(db.prisma, { provider: planProvider(ANSWER) });
    const running = await plannableScan(db.prisma, app, 'view-running@example.com', {
      status: 'Running',
      completedAt: null,
      jobStatus: 'Claimed',
    });
    const closed = await plannableScan(db.prisma, app, 'view-closed@example.com', {
      completedAt: new Date(PLAN_NOW.getTime() - ACTION_PLAN_WINDOW_MS - 1),
    });
    const settled = await plannableScan(db.prisma, app, 'view-settled@example.com', {
      issues: [{ ruleId: 'SEO-TECH-004', status: 'Ignored' }],
    });

    const availability = async (target: typeof running) =>
      (await getPlan(target.owner, target.scanId, 'en')).body.data.availability;

    expect(await availability(running)).toBe('not_ready');
    expect(await availability(closed)).toBe('window_closed');
    expect(await availability(settled)).toBe('nothing_to_plan');
  });
});
