import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PLAN_NOW,
  gatedProvider,
  getPlan,
  planAnswer,
  planApp,
  planProvider,
  plannableScan,
  postPlan,
  settledRun,
} from '../test-utils/action-plan-fixtures.ts';
import { createTestDb, type TestDb } from '../test-utils/test-db.ts';
import {
  ACTION_PLAN_DAILY_LIMIT,
  ACTION_PLAN_DAILY_WINDOW_MS,
  ACTION_PLAN_RUN_STALE_MS,
} from './policy.ts';

// How often a plan is written, and what it is written from (D-232).

const ANSWER = planAnswer([
  { ruleIds: ['SEC-PASSIVE-003'], title: 'Turn on HSTS' },
  { ruleIds: ['SEO-TECH-004', 'SEO-ONPAGE-002'], title: 'Fix the page head' },
]);

describe('Action Plan generation', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it.each([
    ['in the same language', 'en'],
    ['in another language', 'uk'],
  ])('lets one of two concurrent requests %s reach the provider', async (_case, second) => {
    const gated = gatedProvider(planProvider(ANSWER));
    const app = planApp(db.prisma, { provider: gated.provider });
    const { owner, scanId } = await plannableScan(db.prisma, app, 'race@example.com');

    const responses = await Promise.all([
      postPlan(owner, scanId, 'en'),
      postPlan(owner, scanId, second),
    ]);
    await vi.waitFor(() => expect(gated.calls()).toBe(1));
    gated.release();
    await settledRun(db.prisma, scanId);

    expect(responses.map((response) => response.status).sort()).toEqual([202, 409]);
    const refused = responses.find((response) => response.status === 409);
    expect(refused?.body.error.code).toBe('ACTION_PLAN_IN_PROGRESS');
    expect(gated.calls()).toBe(1);
    const scan = await db.prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
    expect(scan).toMatchObject({ actionPlanAttempts: 1, actionPlanSuccesses: 1 });
  });

  it('shows the run in flight to a report that polls, and survives a reload', async () => {
    const gated = gatedProvider(planProvider(ANSWER));
    const app = planApp(db.prisma, { provider: gated.provider });
    const { owner, scanId } = await plannableScan(db.prisma, app, 'polling@example.com');

    await postPlan(owner, scanId, 'de');
    await vi.waitFor(() => expect(gated.calls()).toBe(1));
    const during = await getPlan(owner, scanId, 'en');
    gated.release();
    await settledRun(db.prisma, scanId);
    const after = await getPlan(owner, scanId, 'de');

    expect(during.body.data.run).toEqual({ language: 'de', startedAt: PLAN_NOW.toISOString() });
    expect(after.body.data).toMatchObject({ run: null, languages: ['de'] });
    expect(after.body.data.plan).not.toBeNull();
  });

  it('takes over a run presumed dead and fails its attempt', async () => {
    const provider = planProvider(ANSWER);
    const app = planApp(db.prisma, { provider });
    const { owner, scanId } = await plannableScan(db.prisma, app, 'stale@example.com');
    const deadSince = new Date(PLAN_NOW.getTime() - ACTION_PLAN_RUN_STALE_MS);
    await db.prisma.scan.update({
      where: { id: scanId },
      data: {
        actionPlanRunStartedAt: deadSince,
        actionPlanRunLanguage: 'en',
        actionPlanAttempts: 1,
      },
    });
    const dead = await db.prisma.actionPlanAttempt.create({
      data: {
        scanId,
        accountId: 'someone',
        language: 'en',
        status: 'Running',
        createdAt: deadSince,
      },
    });

    const response = await postPlan(owner, scanId, 'en');
    await settledRun(db.prisma, scanId);

    expect(response.status).toBe(202);
    expect(
      await db.prisma.actionPlanAttempt.findUniqueOrThrow({ where: { id: dead.id } }),
    ).toMatchObject({
      status: 'Failed',
      failureCode: 'abandoned',
    });
    expect(await db.prisma.scan.findUniqueOrThrow({ where: { id: scanId } })).toMatchObject({
      actionPlanAttempts: 2,
      actionPlanSuccesses: 1,
    });
  });

  it('does not take over a run that is merely slow', async () => {
    const app = planApp(db.prisma, { provider: planProvider(ANSWER) });
    const { owner, scanId } = await plannableScan(db.prisma, app, 'slow@example.com');
    await db.prisma.scan.update({
      where: { id: scanId },
      data: {
        actionPlanRunStartedAt: new Date(PLAN_NOW.getTime() - ACTION_PLAN_RUN_STALE_MS + 1_000),
        actionPlanRunLanguage: 'en',
        actionPlanAttempts: 1,
      },
    });

    const response = await postPlan(owner, scanId, 'uk');

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ACTION_PLAN_IN_PROGRESS');
  });

  it('allows three plans per scan, then answers 429', async () => {
    const provider = planProvider(ANSWER);
    const send = vi.spyOn(provider, 'send');
    const app = planApp(db.prisma, { provider });
    const { owner, scanId } = await plannableScan(db.prisma, app, 'three@example.com');

    for (const language of ['en', 'uk', 'en']) {
      expect((await postPlan(owner, scanId, language)).status).toBe(202);
      await settledRun(db.prisma, scanId);
    }
    const fourth = await postPlan(owner, scanId, 'de');
    const view = await getPlan(owner, scanId, 'en');

    expect(fourth.status).toBe(429);
    expect(fourth.body.error.code).toBe('ACTION_PLAN_LIMIT');
    expect(send).toHaveBeenCalledTimes(3);
    // A new plan in a language replaces the old one: there is no history.
    expect(await db.prisma.actionPlan.count({ where: { scanId } })).toBe(2);
    expect(view.body.data).toMatchObject({
      availability: 'limit_reached',
      remaining: { successes: 0, attempts: 3 },
    });
  });

  it('allows six attempts per scan whatever came of them', async () => {
    const provider = planProvider({ status: 'completed', output_text: 'not a plan' });
    const send = vi.spyOn(provider, 'send');
    const app = planApp(db.prisma, { provider });
    const { owner, scanId } = await plannableScan(db.prisma, app, 'six@example.com');

    for (let attempt = 0; attempt < 6; attempt += 1) {
      expect((await postPlan(owner, scanId, 'en')).status).toBe(202);
      await settledRun(db.prisma, scanId);
    }
    const seventh = await postPlan(owner, scanId, 'en');

    expect(seventh.status).toBe(429);
    expect(seventh.body.error.code).toBe('ACTION_PLAN_LIMIT');
    expect(send).toHaveBeenCalledTimes(6);
    expect(
      await db.prisma.actionPlanAttempt.count({
        where: { scanId, status: 'Failed', failureCode: 'invalid_output' },
      }),
    ).toBe(6);
  });

  it('stops every scan once the product made its daily number of attempts', async () => {
    const provider = planProvider(ANSWER);
    const send = vi.spyOn(provider, 'send');
    const app = planApp(db.prisma, { provider });
    const { owner, scanId } = await plannableScan(db.prisma, app, 'daily@example.com');
    const other = await plannableScan(db.prisma, app, 'daily-other@example.com');
    const within = new Date(PLAN_NOW.getTime() - ACTION_PLAN_DAILY_WINDOW_MS + 60_000);
    const before = new Date(PLAN_NOW.getTime() - ACTION_PLAN_DAILY_WINDOW_MS - 60_000);
    const attempt = (createdAt: Date) => ({
      scanId: other.scanId,
      accountId: randomUUID(),
      language: 'en',
      status: 'Succeeded',
      createdAt,
    });
    await db.prisma.actionPlanAttempt.createMany({
      data: [
        ...Array.from({ length: ACTION_PLAN_DAILY_LIMIT - 1 }, () => attempt(within)),
        ...Array.from({ length: 20 }, () => attempt(before)),
      ],
    });

    const lastOfTheDay = await postPlan(owner, scanId, 'en');
    await settledRun(db.prisma, scanId);
    const refused = await postPlan(owner, scanId, 'uk');

    expect(lastOfTheDay.status).toBe(202);
    expect(refused.status).toBe(503);
    expect(refused.body.error.code).toBe('ACTION_PLAN_BUSY');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('gives the last attempt of the day to one of two scans asking at once', async () => {
    const provider = planProvider(ANSWER);
    const send = vi.spyOn(provider, 'send');
    const app = planApp(db.prisma, { provider });
    const first = await plannableScan(db.prisma, app, 'last-first@example.com');
    const second = await plannableScan(db.prisma, app, 'last-second@example.com');
    const within = new Date(PLAN_NOW.getTime() - 60_000);
    await db.prisma.actionPlanAttempt.createMany({
      data: Array.from({ length: ACTION_PLAN_DAILY_LIMIT - 1 }, () => ({
        scanId: first.scanId,
        accountId: randomUUID(),
        language: 'en',
        status: 'Succeeded',
        createdAt: within,
      })),
    });

    // Counted outside the claim, both would see 99 and both would pass.
    const responses = await Promise.all([
      postPlan(first.owner, first.scanId, 'en'),
      postPlan(second.owner, second.scanId, 'en'),
    ]);
    await settledRun(db.prisma, first.scanId);
    await settledRun(db.prisma, second.scanId);

    expect(responses.map((response) => response.status).sort()).toEqual([202, 503]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await db.prisma.actionPlanAttempt.count()).toBe(ACTION_PLAN_DAILY_LIMIT);
  });

  it('limits one account to ten starts an hour', async () => {
    const gated = gatedProvider(planProvider(ANSWER));
    const app = planApp(db.prisma, { provider: gated.provider });
    const { owner, scanId } = await plannableScan(db.prisma, app, 'hourly@example.com');

    const statuses: number[] = [];
    for (let request = 0; request < 11; request += 1) {
      statuses.push((await postPlan(owner, scanId, 'en')).status);
    }
    gated.release();
    await settledRun(db.prisma, scanId);

    // One run starts; the next nine find it in flight; the eleventh is refused first.
    expect(statuses).toEqual([202, 409, 409, 409, 409, 409, 409, 409, 409, 409, 429]);
  });

  it('sends Anthropic no evidence and nothing from Analytics', async () => {
    const gated = gatedProvider(planProvider(ANSWER));
    const app = planApp(db.prisma, { provider: gated.provider });
    const { owner, scanId } = await plannableScan(db.prisma, app, 'privacy@example.com', {
      issues: [
        {
          ruleId: 'SEO-TECH-004',
          evidenceExcerpt: 'SECRET-EVIDENCE-EXCERPT',
          targetUrl: 'https://privacy.example.com/account?token=SECRET-QUERY#SECRET-FRAGMENT',
        },
        {
          ruleId: 'ANALYTICS-SC-002',
          module: 'Analytics',
          evidenceExcerpt: 'Google showed this page 900 times',
          recommendation: 'SECRET-ANALYTICS-RECOMMENDATION',
          targetUrl: 'https://privacy.example.com/SECRET-ANALYTICS-PAGE',
        },
      ],
      modules: [
        { module: 'SEO', runtimeStatus: 'Completed', score: 90, coverage: 1 },
        { module: 'Analytics', runtimeStatus: 'Completed', score: 12, coverage: 1 },
      ],
    });

    await postPlan(owner, scanId, 'en');
    await vi.waitFor(() => expect(gated.calls()).toBe(1));
    gated.release();
    await settledRun(db.prisma, scanId);

    const [prompt] = gated.prompts();
    expect(prompt).toContain('SEO-TECH-004');
    expect(prompt).toContain('https://privacy.example.com/account');
    for (const secret of [
      'SECRET-EVIDENCE-EXCERPT',
      'SECRET-QUERY',
      'SECRET-FRAGMENT',
      'SECRET-ANALYTICS',
      'ANALYTICS-SC-002',
      'Section Analytics',
      'Google showed',
    ]) {
      expect(prompt).not.toContain(secret);
    }
    const stored = await db.prisma.actionPlan.findUniqueOrThrow({
      where: { scanId_language: { scanId, language: 'en' } },
    });
    expect(stored.promptText).toBe(prompt);
  });

  it('moves the counts, not the text, when the owner settles issues', async () => {
    const app = planApp(db.prisma, { provider: planProvider(ANSWER) });
    const { owner, scanId } = await plannableScan(db.prisma, app, 'overlay@example.com');
    await postPlan(owner, scanId, 'en');
    await settledRun(db.prisma, scanId);
    const before = (await getPlan(owner, scanId, 'en')).body.data.plan;
    const hsts = await db.prisma.issue.findFirstOrThrow({
      where: { scanId, ruleId: 'SEC-PASSIVE-003' },
    });
    const onPage = await db.prisma.issue.findFirstOrThrow({
      where: { scanId, ruleId: 'SEO-ONPAGE-002' },
    });

    for (const [issue, status] of [
      [hsts, 'Ignored'],
      [onPage, 'False Positive'],
    ] as const) {
      const patched = await owner.agent
        .patch(`/scans/${scanId}/issues/${issue.id}`)
        .set('Cookie', owner.cookie)
        .send({ status });
      expect(patched.status).toBe(200);
    }
    const after = (await getPlan(owner, scanId, 'en')).body.data.plan;

    expect(after.overview).toBe(before.overview);
    expect(after.actions.map((action: { title: string }) => action.title)).toEqual(
      before.actions.map((action: { title: string }) => action.title),
    );
    expect(
      after.actions.map((action: { openIssues: number; totalIssues: number; settled: boolean }) => [
        action.openIssues,
        action.totalIssues,
        action.settled,
      ]),
    ).toEqual([
      [0, 1, true],
      [2, 3, false],
    ]);
    expect(before.reach).toEqual({ addressed: 4, open: 5, rules: 3 });
    expect(after.reach).toEqual({ addressed: 2, open: 3, rules: 3 });
  });

  it('keeps the current plan while a regeneration fails', async () => {
    const answers = [ANSWER, { status: 'completed' as const, output_text: '{"broken":' }];
    const provider = planProvider(ANSWER);
    vi.spyOn(provider, 'send').mockImplementation(async (aiRequest, promptText) => {
      const next = answers.shift() ?? ANSWER;
      return planProvider(next).send(aiRequest, promptText);
    });
    const app = planApp(db.prisma, { provider });
    const { owner, scanId } = await plannableScan(db.prisma, app, 'regenerate@example.com');

    await postPlan(owner, scanId, 'en');
    await settledRun(db.prisma, scanId);
    const first = (await getPlan(owner, scanId, 'en')).body.data.plan;
    await postPlan(owner, scanId, 'en');
    await settledRun(db.prisma, scanId);
    const view = (await getPlan(owner, scanId, 'en')).body.data;

    expect(view.plan).toEqual(first);
    expect(view.lastFailure).toMatchObject({ code: 'invalid_output', language: 'en' });
  });
});
