// The Action Plan HTTP surface and its spend rules (D-232).
//
// Everything here runs against a mock provider: a plan attempt never reaches
// Anthropic in a test, and the fixtures are the only source of a "model answer".
//
// A POST answers 202 and leaves the generation running in the background, so
// every test drives its own BackgroundRuns and awaits it rather than hoping the
// work landed before the next request.

import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ACTION_PLAN_LIMITS } from '@fluxradar/contracts';
import {
  ACTION_PLAN_NOTICE_VERSION,
  CURRENT_AI_PROCESSING_NOTICE_VERSION,
  MockAiProvider,
} from '@fluxradar/ai';
import type { AiProvider, MockAiFixture } from '@fluxradar/ai';

import { deleteScanResult } from '../data-retention.ts';
import { BackgroundRuns } from '../http/background-runs.ts';
import { silentLogger } from '../http/logger.ts';
import { createApp } from '../index.ts';
import {
  createTestDb,
  type SeededAccount,
  type TestDb,
} from '../test-utils/test-db.ts';
import { clearActionPlansForScan } from './service.ts';

const PASSWORD = 'sufficiently-long-password';

const VALID_PLAN = {
  overview: 'Search engines cannot read your site’s basic instructions yet.',
  actions: [
    {
      title: 'Publish a robots.txt',
      why: 'Without it, crawlers guess what they may read.',
      steps: ['Create /robots.txt', 'Allow the public pages'],
      effort: 'small',
      ruleIds: ['SEO-TECH-001'],
    },
  ],
};

function planFixtures(body: unknown): readonly MockAiFixture[] {
  return [
    {
      questionIncludes: 'Write the Action Plan',
      response: {
        id: 'msg_plan',
        status: 'completed',
        output_text: JSON.stringify(body),
        usage: { input_tokens: 900, output_tokens: 400 },
      },
    },
  ];
}

function planProvider(fixtures: readonly MockAiFixture[]): AiProvider {
  return new MockAiProvider(fixtures, {
    config: {
      provider: 'anthropic',
      apiVersion: '2023-06-01',
      modelId: 'claude-opus-5',
      timeoutMs: 1000,
      maxRetries: 1,
    },
  });
}

interface ScanFixture {
  readonly scanId: string;
}

/** The fields every seeded issue shares; only the rule and module differ. */
function issueRow(scanId: string, domain: string, suffix: string) {
  return {
    scanId,
    fingerprint: `fp-${scanId}-${suffix}`,
    severity: 'High',
    severityRank: 1,
    category: 'seo',
    status: 'New',
    targetKind: 'site',
    normalizedUrl: '',
    normalizedResource: '',
    normalizedSelector: '',
    normalizedParameter: '',
    ruleVariant: 'v1',
    targetUrl: `${domain}/`,
    evidenceType: 'none',
    recommendation: 'Publish a robots.txt at the site root.',
    confidence: 1,
    applicableTargets: 1,
    affectedTargets: 1,
    rulePenalty: 5,
    scoreDelta: -5,
    observedAt: new Date(),
  };
}

/** An open finding the plan never sees: Google data stays out of the prompt. */
function analyticsIssue(scanId: string, domain: string) {
  return {
    ...issueRow(scanId, domain, 'analytics'),
    ruleId: 'ANALYTICS-SC-001',
    module: 'Analytics',
  };
}

/** An open finding the plan could have named and did not. */
function unplannedSeoIssue(scanId: string, domain: string) {
  return { ...issueRow(scanId, domain, 'unplanned'), ruleId: 'SEO-TECH-004', module: 'SEO' };
}

/** A Complete scan that has finished, has one open SEO issue and a live entitlement. */
async function seedPlannableScan(
  prisma: PrismaClient,
  account: SeededAccount,
  overrides: {
    readonly plan?: string;
    readonly completedAt?: Date;
    readonly jobStatus?: string;
    readonly openIssue?: boolean;
    readonly analyticsIssueOnly?: boolean;
  } = {},
): Promise<ScanFixture> {
  const purchase = await prisma.purchase.create({
    data: {
      accountId: account.accountId,
      siteProfileId: account.siteProfileId,
      plan: overrides.plan ?? 'Complete',
      provider: 'paddle',
      providerTransactionId: `txn_${Math.random().toString(36).slice(2)}`,
      amountUsd: 49,
      currency: 'USD',
      status: 'paid',
    },
  });
  await prisma.entitlement.create({
    data: {
      purchaseId: purchase.id,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  const completedAt = overrides.completedAt ?? new Date();
  const scan = await prisma.scan.create({
    data: {
      purchaseId: purchase.id,
      accountId: account.accountId,
      siteProfileId: account.siteProfileId,
      plan: overrides.plan ?? 'Complete',
      domain: account.domain,
      status: 'Completed',
      scopeJson: JSON.stringify({ includeSubdomains: false }),
      rulesetVersion: 'rules-mvp-0.1',
      completedAt,
    },
  });
  await prisma.job.create({
    data: { scanId: scan.id, type: 'scan', status: overrides.jobStatus ?? 'Done' },
  });
  await prisma.aiConsent.create({
    data: {
      accountId: account.accountId,
      scanId: scan.id,
      providersJson: JSON.stringify(['anthropic', 'openai']),
      noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
    },
  });
  await prisma.scanModule.create({
    data: {
      scanId: scan.id,
      module: 'SEO',
      runtimeStatus: 'Completed',
      coverage: 1,
      score: 72,
      usableOutput: true,
    },
  });
  await prisma.scanModule.create({
    data: {
      scanId: scan.id,
      module: 'Performance',
      runtimeStatus: 'Partial',
      coverage: 0.5,
      score: null,
      usableOutput: false,
    },
  });
  if (overrides.openIssue !== false) {
    await prisma.issue.createMany({
      data: [
        {
          scanId: scan.id,
          ruleId: overrides.analyticsIssueOnly === true ? 'ANALYTICS-SC-001' : 'SEO-TECH-001',
          module: overrides.analyticsIssueOnly === true ? 'Analytics' : 'SEO',
          fingerprint: `fp-${scan.id}-1`,
          severity: 'High',
          severityRank: 1,
          category: 'seo',
          status: 'New',
          targetKind: 'site',
          normalizedUrl: '',
          normalizedResource: '',
          normalizedSelector: '',
          normalizedParameter: '',
          ruleVariant: 'v1',
          targetUrl: `${account.domain}/?utm_source=x#frag`,
          evidenceType: 'none',
          recommendation: 'Publish a robots.txt at the site root.',
          confidence: 1,
          applicableTargets: 1,
          affectedTargets: 1,
          rulePenalty: 5,
          scoreDelta: -5,
          observedAt: completedAt,
        },
      ],
    });
  }
  return { scanId: scan.id };
}

describe('Action Plan routes', () => {
  let db: TestDb;
  let account: SeededAccount;
  let agent: ReturnType<typeof request.agent>;
  /** The background registry of the app `agent` talks to, awaited after a POST. */
  let runs: BackgroundRuns;
  const registries: BackgroundRuns[] = [];

  function app(fixtures: readonly MockAiFixture[], provider?: AiProvider) {
    const backgroundRuns = new BackgroundRuns();
    registries.push(backgroundRuns);
    const express = createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
      actionPlanRuns: backgroundRuns,
      createActionPlanProvider: () => provider ?? planProvider(fixtures),
    });
    return { express, backgroundRuns };
  }

  /**
   * One signed-in account that owns everything a test seeds. Registering first
   * and seeding against that account keeps ownership real rather than rewired
   * afterwards, which is what the tenant boundary actually checks.
   */
  async function signIn(fixtures: readonly MockAiFixture[]): Promise<void> {
    const built = app(fixtures);
    agent = request.agent(built.express);
    runs = built.backgroundRuns;
    const email = `plan-${Math.random().toString(36).slice(2)}@example.com`;
    const registered = await agent.post('/auth/register').send({ email, password: PASSWORD });
    expect(registered.status).toBe(201);
    const session = await db.prisma.account.findUniqueOrThrow({ where: { email } });
    const profile = await db.prisma.siteProfile.create({
      data: { accountId: session.id, name: 'Test Site', domain: 'https://example.com' },
    });
    account = { accountId: session.id, siteProfileId: profile.id, domain: profile.domain };
  }

  beforeEach(async () => {
    db = await createTestDb();
    registries.length = 0;
    await signIn(planFixtures(VALID_PLAN));
  });

  afterEach(async () => {
    // Stop first: a generation still running when prisma disconnects is a
    // leaked write, and the failure it produces belongs to no test.
    await Promise.all(registries.map((background) => background.stop()));
    await db.cleanup();
  });

  /** Starts a generation and waits for the background run it detached. */
  async function generate(scanId: string, language = 'en') {
    const response = await agent
      .post(`/scans/${scanId}/action-plan`)
      .send({ language, noticeVersion: ACTION_PLAN_NOTICE_VERSION });
    await runs.settled();
    return response;
  }

  it('writes a plan, stores it per language and answers with its live counts', async () => {
    const { scanId } = await seedPlannableScan(db.prisma, account);

    const response = await generate(scanId);
    expect(response.status).toBe(202);

    const read = await agent.get(`/scans/${scanId}/action-plan?language=en`);
    expect(read.status).toBe(200);
    expect(read.body.data.plan).toMatchObject({
      language: 'en',
      overview: VALID_PLAN.overview,
      modelId: 'claude-opus-5',
      // The plan names the notice the CLICK accepted, not the one the purchase
      // did: they are different disclosures with their own version lines.
      noticeVersion: ACTION_PLAN_NOTICE_VERSION,
    });
    expect(read.body.data.plan.actions[0]).toMatchObject({
      ruleIds: ['SEO-TECH-001'],
      openIssues: 1,
      totalIssues: 1,
      settled: false,
    });
    expect(read.body.data.plan.reach).toMatchObject({ share: 1, rules: 1 });
    // A module that did not complete becomes a caveat line above the plan.
    expect(read.body.data.plan.caveats).toEqual(['Performance']);
    expect(read.body.data.remaining).toEqual({ successes: 2, attempts: 5 });
  });

  it('never answers with the prompt or the provider payload', async () => {
    const { scanId } = await seedPlannableScan(db.prisma, account);
    await generate(scanId);

    const read = await agent.get(`/scans/${scanId}/action-plan?language=en`);

    const body = JSON.stringify(read.body);
    expect(body).not.toContain('Write the Action Plan');
    expect(body).not.toContain('msg_plan');
    expect(body).not.toContain('input_tokens');
    expect(read.body.data.plan.promptText).toBeUndefined();
  });

  it('refuses a notice version this release does not publish', async () => {
    const { scanId } = await seedPlannableScan(db.prisma, account);

    const response = await agent
      .post(`/scans/${scanId}/action-plan`)
      .send({ language: 'en', noticeVersion: 'action-plan-notice-v99' });

    expect(response.status).toBe(400);
    expect(await db.prisma.actionPlanAttempt.count({ where: { scanId } })).toBe(0);
  });

  it('refuses a scan another account owns, without saying it exists', async () => {
    const owner = account;
    const { scanId } = await seedPlannableScan(db.prisma, owner);
    await signIn(planFixtures(VALID_PLAN));

    const response = await generate(scanId);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(await db.prisma.actionPlanAttempt.count({ where: { scanId } })).toBe(0);
  });

  it('refuses a Basic scan, an unfinished one and a closed window', async () => {
    const basic = await seedPlannableScan(db.prisma, account, { plan: 'Basic' });
    expect((await generate(basic.scanId)).body.error.code).toBe('ACTION_PLAN_COMPLETE_ONLY');

    const unfinished = await seedPlannableScan(db.prisma, account, { jobStatus: 'Claimed' });
    expect((await generate(unfinished.scanId)).body.error.code).toBe('ACTION_PLAN_NOT_READY');

    const stale = await seedPlannableScan(db.prisma, account, {
      completedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
    });
    expect((await generate(stale.scanId)).body.error.code).toBe('ACTION_PLAN_WINDOW_CLOSED');
  });

  it('refuses a scan with nothing to plan, counting Analytics as nothing', async () => {
    const empty = await seedPlannableScan(db.prisma, account, { openIssue: false });
    expect((await generate(empty.scanId)).body.error.code).toBe('ACTION_PLAN_NOTHING_TO_PLAN');

    // An Analytics finding is Google data and never reaches a provider, so a
    // report whose only open issue is one has nothing a plan could be written from.
    const analytics = await seedPlannableScan(db.prisma, account, { analyticsIssueOnly: true });
    expect((await generate(analytics.scanId)).body.error.code).toBe('ACTION_PLAN_NOTHING_TO_PLAN');
  });

  it('refuses a language the picker does not offer', async () => {
    const { scanId } = await seedPlannableScan(db.prisma, account);

    const response = await generate(scanId, 'klingon');

    expect(response.status).toBe(400);
  });

  it('refuses a refunded purchase and an expired entitlement', async () => {
    const refunded = await seedPlannableScan(db.prisma, account);
    await db.prisma.purchase.updateMany({
      where: { scan: { id: refunded.scanId } },
      data: { status: 'Refunded' },
    });
    expect((await generate(refunded.scanId)).status).toBe(403);

    const expired = await seedPlannableScan(db.prisma, account);
    await db.prisma.entitlement.updateMany({
      where: { purchase: { scan: { id: expired.scanId } } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const response = await generate(expired.scanId);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ENTITLEMENT_INACTIVE');
  });

  it('produces one provider call for concurrent requests, in any language', async () => {
    let calls = 0;
    const counting = planProvider(planFixtures(VALID_PLAN));
    const originalSend = counting.send.bind(counting);
    counting.send = async (...args: Parameters<typeof originalSend>) => {
      calls += 1;
      return originalSend(...args);
    };
    const built = app([], counting);
    const racing = request.agent(built.express);
    const email = `race-${Math.random().toString(36).slice(2)}@example.com`;
    await racing.post('/auth/register').send({ email, password: PASSWORD });
    const session = await db.prisma.account.findUniqueOrThrow({ where: { email } });
    const profile = await db.prisma.siteProfile.create({
      data: { accountId: session.id, name: 'Race Site', domain: 'https://race.example' },
    });
    const { scanId } = await seedPlannableScan(db.prisma, {
      accountId: session.id,
      siteProfileId: profile.id,
      domain: profile.domain,
    });

    // Different languages on purpose: one generation may be in flight per scan,
    // not per language.
    const [first, second] = await Promise.all([
      racing
        .post(`/scans/${scanId}/action-plan`)
        .send({ language: 'en', noticeVersion: ACTION_PLAN_NOTICE_VERSION }),
      racing
        .post(`/scans/${scanId}/action-plan`)
        .send({ language: 'uk', noticeVersion: ACTION_PLAN_NOTICE_VERSION }),
    ]);
    await built.backgroundRuns.settled();

    expect([first.status, second.status].sort()).toEqual([202, 409]);
    expect(calls).toBe(1);
    // One attempt row, one increment: the refused request paid for nothing.
    expect(await db.prisma.actionPlanAttempt.count({ where: { scanId } })).toBe(1);
    expect(
      (
        await db.prisma.scan.findUniqueOrThrow({
          where: { id: scanId },
          select: { actionPlanAttempts: true },
        })
      ).actionPlanAttempts,
    ).toBe(1);
  });

  it('recovers a stale run instead of leaving the scan stuck', async () => {
    const { scanId } = await seedPlannableScan(db.prisma, account);
    await db.prisma.scan.update({
      where: { id: scanId },
      data: {
        actionPlanRunStartedAt: new Date(Date.now() - ACTION_PLAN_LIMITS.staleRunMs - 1000),
        actionPlanRunLanguage: 'en',
        actionPlanAttempts: 1,
      },
    });

    const response = await generate(scanId);

    expect(response.status).toBe(202);
  });

  it('stops after three successes and after six attempts', async () => {
    const { scanId } = await seedPlannableScan(db.prisma, account);
    await db.prisma.scan.update({
      where: { id: scanId },
      data: { actionPlanSuccesses: ACTION_PLAN_LIMITS.maxSuccessesPerScan },
    });
    const exhaustedSuccesses = await generate(scanId);
    expect(exhaustedSuccesses.status).toBe(429);
    expect(exhaustedSuccesses.body.error.code).toBe('ACTION_PLAN_LIMIT');

    await db.prisma.scan.update({
      where: { id: scanId },
      data: {
        actionPlanSuccesses: 0,
        actionPlanAttempts: ACTION_PLAN_LIMITS.maxAttemptsPerScan,
      },
    });
    expect((await generate(scanId)).body.error.code).toBe('ACTION_PLAN_LIMIT');
  });

  it('answers busy when the product-wide daily cap is reached', async () => {
    const { scanId } = await seedPlannableScan(db.prisma, account);
    await db.prisma.actionPlanAttempt.createMany({
      data: Array.from({ length: ACTION_PLAN_LIMITS.maxGenerationsPerProductPerDay }, () => ({
        scanId,
        accountId: account.accountId,
        language: 'en',
        noticeVersion: ACTION_PLAN_NOTICE_VERSION,
        status: 'Succeeded',
      })),
    });

    const response = await generate(scanId);

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('ACTION_PLAN_BUSY');
  });

  it('keeps the previous plan when a regeneration fails, and records a code only', async () => {
    const { scanId } = await seedPlannableScan(db.prisma, account);
    await generate(scanId);
    expect(
      (await agent.get(`/scans/${scanId}/action-plan?language=en`)).body.data.plan,
    ).not.toBeNull();

    // The same signed-in session, against an app whose provider answers with
    // something the contract refuses.
    await signIn(planFixtures({ overview: 'x', actions: 'nonsense' }));
    await db.prisma.scan.update({
      where: { id: scanId },
      data: { accountId: account.accountId },
    });
    const failed = await generate(scanId);
    expect(failed.status).toBe(202);

    const read = await agent.get(`/scans/${scanId}/action-plan?language=en`);
    expect(read.body.data.plan.overview).toBe(VALID_PLAN.overview);
    expect(read.body.data.lastFailure).toMatchObject({ code: 'ProviderContract' });
    // A failure code, never provider text.
    expect(JSON.stringify(read.body.data.lastFailure)).not.toContain('nonsense');
  });

  it('shows the live overlay move when an issue is marked a false positive', async () => {
    const { scanId } = await seedPlannableScan(db.prisma, account);
    await generate(scanId);

    await db.prisma.issue.updateMany({ where: { scanId }, data: { status: 'False Positive' } });

    const read = await agent.get(`/scans/${scanId}/action-plan?language=en`);
    expect(read.body.data.plan.actions[0]).toMatchObject({
      openIssues: 0,
      totalIssues: 1,
      settled: true,
    });
    expect(read.body.data.plan.reach.totalOpenIssues).toBe(0);
  });

  it('counts every open issue in Reach, including the Analytics ones never sent', async () => {
    const { scanId } = await seedPlannableScan(db.prisma, account);
    // Two more open issues the plan could never address: one Analytics finding,
    // which never leaves the product, and one SEO rule the model did not name.
    await db.prisma.issue.createMany({
      data: [analyticsIssue(scanId, account.domain), unplannedSeoIssue(scanId, account.domain)],
    });

    await generate(scanId);
    const read = await agent.get(`/scans/${scanId}/action-plan?language=en`);

    // Reach is "the share of a SCAN's open issues an Action addresses"
    // (D-232): the denominator is what the owner can see in
    // this report, not what we were allowed to send.
    expect(read.body.data.plan.reach).toEqual({
      share: 1 / 3,
      addressedOpenIssues: 1,
      totalOpenIssues: 3,
      rules: 1,
    });
    // And the Analytics rule is nowhere in the plan itself.
    expect(JSON.stringify(read.body.data.plan)).not.toContain('ANALYTICS');
  });

  it('drops the plans but keeps the spend log when the scan is re-run', async () => {
    const { scanId } = await seedPlannableScan(db.prisma, account);
    await generate(scanId);
    expect(await db.prisma.actionPlan.count({ where: { scanId } })).toBe(1);

    await clearActionPlansForScan(db.prisma, scanId, new Date());

    expect(await db.prisma.actionPlan.count({ where: { scanId } })).toBe(0);
    // The provider was paid for that attempt whatever the report now shows, so
    // the row survives and keeps counting against the daily and hourly caps.
    const attempts = await db.prisma.actionPlanAttempt.findMany({ where: { scanId } });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.clearedAt).not.toBeNull();
    expect(
      await db.prisma.scan.findUniqueOrThrow({
        where: { id: scanId },
        select: { actionPlanAttempts: true, actionPlanSuccesses: true },
      }),
    ).toEqual({ actionPlanAttempts: 0, actionPlanSuccesses: 0 });

    // A cleared attempt describes a report that no longer exists and must not
    // surface as this report's last failure.
    const read = await agent.get(`/scans/${scanId}/action-plan`);
    expect(read.body.data.lastFailure).toBeNull();
    expect(read.body.data.languages).toEqual([]);
  });

  it('removes the plan when the scan is deleted for retention, and keeps only the spend', async () => {
    const { scanId } = await seedPlannableScan(db.prisma, account);
    await generate(scanId);

    await deleteScanResult(db.prisma, scanId);

    expect(await db.prisma.actionPlan.count({ where: { scanId } })).toBe(0);
    expect(await db.prisma.scan.findUnique({ where: { id: scanId } })).toBeNull();
    // The plan is the report's; the attempt row is the account's spend, and it
    // keeps counting against the caps until it is old enough to count for
    // nothing (data-retention.ts). It describes no scan: the link is null.
    expect(await db.prisma.actionPlanAttempt.count({ where: { scanId } })).toBe(0);
    expect(
      await db.prisma.actionPlanAttempt.count({
        where: { scanId: null, accountId: account.accountId },
      }),
    ).toBe(1);
  });
});
