// What the database guarantees about Action Plan spend (D-232).
//
// The HTTP tests drive one request at a time; these drive the claim itself, in
// parallel, because every rule here is a rule about two things happening at
// once. A cap that only holds when requests arrive one after another is not a
// cap — it is a coincidence — so each test fires the real transaction against
// the real PostgreSQL and asserts on what committed.

import { randomUUID } from 'node:crypto';

import { ACTION_PLAN_LIMITS } from '@fluxradar/contracts';
import {
  ACTION_PLAN_NOTICE_VERSION,
  CURRENT_AI_PROCESSING_NOTICE_VERSION,
  MockAiProvider,
} from '@fluxradar/ai';
import type { AiProvider } from '@fluxradar/ai';
import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { deleteScanResult } from '../data-retention.ts';
import { silentLogger } from '../http/logger.ts';
import { createTestDb, type SeededAccount, type TestDb } from '../test-utils/test-db.ts';
import { generateActionPlan } from './generation.ts';
import {
  claimPlanRun,
  clearActionPlansForScan,
  clearActionPlansInTransaction,
  completePlanRun,
  failPlanRun,
  generationsToday,
} from './service.ts';
import type { ClaimResult, ClaimedRun, FinishedPlan } from './service.ts';

const FINISHED_PLAN: FinishedPlan = {
  contentJson: JSON.stringify({ overview: 'ok', actions: [] }),
  promptText: 'Write the Action Plan',
  promptVersion: 'action-plan-v1',
  modelId: 'claude-opus-5',
  requestId: 'msg_plan',
  usageJson: JSON.stringify({ inputTokens: 900, outputTokens: 400 }),
  noticeVersion: ACTION_PLAN_NOTICE_VERSION,
};

async function seedAccount(prisma: PrismaClient, name: string): Promise<SeededAccount> {
  const account = await prisma.account.create({
    data: { email: `${name}-${randomUUID()}@example.com`, passwordHash: 'test-hash' },
  });
  const profile = await prisma.siteProfile.create({
    data: { accountId: account.id, name, domain: `https://${name}.example` },
  });
  return { accountId: account.id, siteProfileId: profile.id, domain: profile.domain };
}

/** A finished, paid, plannable Complete scan. */
async function seedScan(
  prisma: PrismaClient,
  account: SeededAccount,
  completedAt = new Date(),
): Promise<string> {
  const purchase = await prisma.purchase.create({
    data: {
      accountId: account.accountId,
      siteProfileId: account.siteProfileId,
      plan: 'Complete',
      provider: 'paddle',
      providerTransactionId: `txn_${randomUUID()}`,
      amountUsd: 49,
      currency: 'USD',
      status: 'paid',
    },
  });
  await prisma.entitlement.create({
    data: { purchaseId: purchase.id, expiresAt: new Date(Date.now() + 30 * 86_400_000) },
  });
  const scan = await prisma.scan.create({
    data: {
      purchaseId: purchase.id,
      accountId: account.accountId,
      siteProfileId: account.siteProfileId,
      plan: 'Complete',
      domain: account.domain,
      status: 'Completed',
      scopeJson: JSON.stringify({ includeSubdomains: false }),
      rulesetVersion: 'rules-mvp-0.1',
      completedAt,
    },
  });
  await prisma.job.create({ data: { scanId: scan.id, type: 'scan', status: 'Done' } });
  return scan.id;
}

async function claim(
  prisma: PrismaClient,
  scanId: string,
  accountId: string,
  now = new Date(),
): Promise<ClaimResult> {
  return claimPlanRun(prisma, {
    scanId,
    accountId,
    language: 'en',
    noticeVersion: ACTION_PLAN_NOTICE_VERSION,
    now,
  });
}

function claimedRun(result: ClaimResult): ClaimedRun {
  if (result.kind !== 'claimed') throw new Error(`expected a claim, got ${result.kind}`);
  return result.run;
}

function kinds(results: readonly ClaimResult[]): Record<string, number> {
  return results.reduce<Record<string, number>>(
    (counts, result) => ({ ...counts, [result.kind]: (counts[result.kind] ?? 0) + 1 }),
    {},
  );
}

/** Attempt rows that make the product look busy, without a scan of their own. */
async function fillDailyQuota(
  prisma: PrismaClient,
  account: SeededAccount,
  scanId: string,
  rows: number,
  createdAt = new Date(),
): Promise<void> {
  await prisma.actionPlanAttempt.createMany({
    data: Array.from({ length: rows }, () => ({
      scanId,
      accountId: account.accountId,
      language: 'en',
      noticeVersion: ACTION_PLAN_NOTICE_VERSION,
      status: 'Succeeded',
      createdAt,
    })),
  });
}

describe('Action Plan spend, under concurrency', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it('lets exactly one of many simultaneous claims take the same scan', async () => {
    const account = await seedAccount(db.prisma, 'same-scan');
    const scanId = await seedScan(db.prisma, account);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => claim(db.prisma, scanId, account.accountId)),
    );

    expect(kinds(results)).toEqual({ claimed: 1, in_progress: 7 });
    // One claim, one attempt row, one increment — the refused seven cost nothing.
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

  it('holds the product-wide daily cap across different scans and accounts', async () => {
    const quotaHolder = await seedAccount(db.prisma, 'quota');
    const quotaScan = await seedScan(db.prisma, quotaHolder);
    await fillDailyQuota(
      db.prisma,
      quotaHolder,
      quotaScan,
      ACTION_PLAN_LIMITS.maxGenerationsPerProductPerDay - 1,
    );

    // Six different accounts, six different scans, one free slot between them:
    // nothing here shares a row that a per-scan guard could serialise on.
    const contenders = await Promise.all(
      Array.from({ length: 6 }, async (_unused, index) => {
        const account = await seedAccount(db.prisma, `rush-${index}`);
        return { account, scanId: await seedScan(db.prisma, account) };
      }),
    );
    const results = await Promise.all(
      contenders.map((contender) =>
        claim(db.prisma, contender.scanId, contender.account.accountId),
      ),
    );

    expect(kinds(results)).toEqual({ claimed: 1, product_busy: 5 });
    expect(await generationsToday(db.prisma, new Date())).toBe(
      ACTION_PLAN_LIMITS.maxGenerationsPerProductPerDay,
    );
  });

  it('counts the daily cap over 24 hours, not over all time', async () => {
    const account = await seedAccount(db.prisma, 'yesterday');
    const scanId = await seedScan(db.prisma, account);
    await fillDailyQuota(
      db.prisma,
      account,
      scanId,
      ACTION_PLAN_LIMITS.maxGenerationsPerProductPerDay,
      new Date(Date.now() - 25 * 60 * 60 * 1000),
    );

    const fresh = await seedAccount(db.prisma, 'today');
    const freshScan = await seedScan(db.prisma, fresh);

    expect((await claim(db.prisma, freshScan, fresh.accountId)).kind).toBe('claimed');
  });

  it('holds one account to ten starts an hour across its own scans', async () => {
    const account = await seedAccount(db.prisma, 'busy');
    const scans = await Promise.all(
      Array.from({ length: ACTION_PLAN_LIMITS.maxStartsPerAccountPerHour + 4 }, () =>
        seedScan(db.prisma, account),
      ),
    );

    const results = await Promise.all(
      scans.map((scanId) => claim(db.prisma, scanId, account.accountId)),
    );

    expect(kinds(results)).toEqual({
      claimed: ACTION_PLAN_LIMITS.maxStartsPerAccountPerHour,
      account_rate_limited: 4,
    });
    // A neighbour is untouched by it: the hourly rule is per account.
    const neighbour = await seedAccount(db.prisma, 'neighbour');
    const neighbourScan = await seedScan(db.prisma, neighbour);
    expect((await claim(db.prisma, neighbourScan, neighbour.accountId)).kind).toBe('claimed');
  });

  it('refuses a scan the account does not own without touching it', async () => {
    const owner = await seedAccount(db.prisma, 'owner');
    const stranger = await seedAccount(db.prisma, 'stranger');
    const scanId = await seedScan(db.prisma, owner);

    const result = await claim(db.prisma, scanId, stranger.accountId);

    expect(result.kind).toBe('gone');
    expect(await db.prisma.actionPlanAttempt.count()).toBe(0);
    expect(
      (
        await db.prisma.scan.findUniqueOrThrow({
          where: { id: scanId },
          select: { actionPlanAttempts: true },
        })
      ).actionPlanAttempts,
    ).toBe(0);
  });

  it('throws away the answer of a run that was taken over while it was thinking', async () => {
    const account = await seedAccount(db.prisma, 'takeover');
    const scanId = await seedScan(db.prisma, account);
    const startedAt = new Date(Date.now() - ACTION_PLAN_LIMITS.staleRunMs - 1000);
    const abandoned = claimedRun(await claim(db.prisma, scanId, account.accountId, startedAt));
    const successor = claimedRun(await claim(db.prisma, scanId, account.accountId));

    const late = await completePlanRun(db.prisma, scanId, abandoned, FINISHED_PLAN, new Date());

    expect(late).toEqual({ kind: 'discarded', reason: 'Superseded' });
    expect(await db.prisma.actionPlan.count({ where: { scanId } })).toBe(0);
    // The abandoned attempt still reached the provider, so what it cost is kept.
    const abandonedRow = await db.prisma.actionPlanAttempt.findUniqueOrThrow({
      where: { id: abandoned.attemptId },
    });
    expect(abandonedRow).toMatchObject({ status: 'Failed', failureCode: 'Superseded' });
    expect(abandonedRow.usageJson).toBe(FINISHED_PLAN.usageJson);

    // And the run that took over still owns the scan and can still store.
    const stored = await completePlanRun(db.prisma, scanId, successor, FINISHED_PLAN, new Date());
    expect(stored).toEqual({ kind: 'stored' });
    expect(
      await db.prisma.scan.findUniqueOrThrow({
        where: { id: scanId },
        select: { actionPlanSuccesses: true, actionPlanRunAttemptId: true },
      }),
    ).toEqual({ actionPlanSuccesses: 1, actionPlanRunAttemptId: null });
  });

  it('throws away a plan written for a snapshot that has since been re-scanned', async () => {
    const account = await seedAccount(db.prisma, 'rescan');
    const scanId = await seedScan(db.prisma, account);
    const run = claimedRun(await claim(db.prisma, scanId, account.accountId));

    // The scan runs again while the model is writing: same row, new snapshot.
    await db.prisma.scan.update({
      where: { id: scanId },
      data: { completedAt: new Date(Date.now() + 1000) },
    });

    const result = await completePlanRun(db.prisma, scanId, run, FINISHED_PLAN, new Date());

    expect(result).toEqual({ kind: 'discarded', reason: 'SnapshotChanged' });
    expect(await db.prisma.actionPlan.count({ where: { scanId } })).toBe(0);
  });

  it('throws away a plan whose report was refunded mid-flight, but not an expired one', async () => {
    const refundedAccount = await seedAccount(db.prisma, 'refunded');
    const refundedScan = await seedScan(db.prisma, refundedAccount);
    const refundedRun = claimedRun(await claim(db.prisma, refundedScan, refundedAccount.accountId));
    await db.prisma.purchase.updateMany({
      where: { scan: { id: refundedScan } },
      data: { status: 'Refunded' },
    });

    expect(
      await completePlanRun(db.prisma, refundedScan, refundedRun, FINISHED_PLAN, new Date()),
    ).toEqual({ kind: 'discarded', reason: 'AccessRevoked' });

    // Expiry is not revocation: this generation was bought when it was claimed,
    // and the report it belongs to stays readable after the window closes.
    const expiredAccount = await seedAccount(db.prisma, 'expired');
    const expiredScan = await seedScan(db.prisma, expiredAccount);
    const expiredRun = claimedRun(await claim(db.prisma, expiredScan, expiredAccount.accountId));
    await db.prisma.entitlement.updateMany({
      where: { purchase: { scan: { id: expiredScan } } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(
      await completePlanRun(db.prisma, expiredScan, expiredRun, FINISHED_PLAN, new Date()),
    ).toEqual({ kind: 'stored' });
  });

  it('finishes without writing when the scan was deleted while the model was thinking', async () => {
    const account = await seedAccount(db.prisma, 'deleted');
    const scanId = await seedScan(db.prisma, account);
    const run = claimedRun(await claim(db.prisma, scanId, account.accountId));

    await deleteScanResult(db.prisma, scanId);

    expect(await completePlanRun(db.prisma, scanId, run, FINISHED_PLAN, new Date())).toEqual({
      kind: 'discarded',
      reason: 'Superseded',
    });
    expect(await db.prisma.actionPlan.count()).toBe(0);
    // The attempt row outlived the scan — it is the spend log, and the provider
    // was paid — so what the discarded answer cost is still recorded, against
    // no scan.
    const detached = await db.prisma.actionPlanAttempt.findUniqueOrThrow({
      where: { id: run.attemptId },
    });
    expect(detached).toMatchObject({ scanId: null, status: 'Failed', failureCode: 'Superseded' });
    expect(detached.usageJson).toBe(FINISHED_PLAN.usageJson);
  });

  it('does not give an account its hourly starts back when the scan is deleted', async () => {
    // Deleting a site profile deletes its scans, and a customer may do that at
    // any moment. If the spend log went with them, "delete the profile" would
    // be a way to clear this counter and the product-wide daily one with it.
    const account = await seedAccount(db.prisma, 'cap-after-delete');
    const scanId = await seedScan(db.prisma, account);
    await fillDailyQuota(
      db.prisma,
      account,
      scanId,
      ACTION_PLAN_LIMITS.maxStartsPerAccountPerHour - 1,
    );

    await deleteScanResult(db.prisma, scanId);

    expect(
      await db.prisma.actionPlanAttempt.count({ where: { accountId: account.accountId } }),
    ).toBe(ACTION_PLAN_LIMITS.maxStartsPerAccountPerHour - 1);
    // One start left, and the one after it is refused — the counts are what
    // they would have been had the scan never been deleted.
    const nextScan = await seedScan(db.prisma, account);
    expect((await claim(db.prisma, nextScan, account.accountId)).kind).toBe('claimed');
    const anotherScan = await seedScan(db.prisma, account);
    expect((await claim(db.prisma, anotherScan, account.accountId)).kind).toBe(
      'account_rate_limited',
    );
  });

  it('frees the scan after a failure and keeps what the failure cost', async () => {
    const account = await seedAccount(db.prisma, 'failure');
    const scanId = await seedScan(db.prisma, account);
    const run = claimedRun(await claim(db.prisma, scanId, account.accountId));

    await failPlanRun(
      db.prisma,
      scanId,
      run,
      { code: 'ProviderContract', usageJson: FINISHED_PLAN.usageJson },
      new Date(),
    );

    expect(
      await db.prisma.scan.findUniqueOrThrow({
        where: { id: scanId },
        select: {
          actionPlanAttempts: true,
          actionPlanSuccesses: true,
          actionPlanRunStartedAt: true,
          actionPlanRunAttemptId: true,
        },
      }),
    ).toEqual({
      // The attempt is spent; the success is not.
      actionPlanAttempts: 1,
      actionPlanSuccesses: 0,
      actionPlanRunStartedAt: null,
      actionPlanRunAttemptId: null,
    });
    const row = await db.prisma.actionPlanAttempt.findUniqueOrThrow({
      where: { id: run.attemptId },
    });
    expect(row).toMatchObject({ status: 'Failed', failureCode: 'ProviderContract' });
    expect(row.usageJson).toBe(FINISHED_PLAN.usageJson);

    // The scan is free again immediately: a retry does not wait out the stale timer.
    expect((await claim(db.prisma, scanId, account.accountId)).kind).toBe('claimed');
  });

  it('keeps the spend log when a re-run drops the plans, so re-running buys nothing', async () => {
    const account = await seedAccount(db.prisma, 'rerun');
    const scanId = await seedScan(db.prisma, account);
    const run = claimedRun(await claim(db.prisma, scanId, account.accountId));
    await completePlanRun(db.prisma, scanId, run, FINISHED_PLAN, new Date());

    await clearActionPlansForScan(db.prisma, scanId, new Date());

    expect(await db.prisma.actionPlan.count({ where: { scanId } })).toBe(0);
    expect(
      await db.prisma.scan.findUniqueOrThrow({
        where: { id: scanId },
        select: { actionPlanAttempts: true, actionPlanSuccesses: true },
      }),
    ).toEqual({ actionPlanAttempts: 0, actionPlanSuccesses: 0 });
    // The per-scan counters reset because the snapshot is new; the caps that
    // meter money do not.
    expect(await generationsToday(db.prisma, new Date())).toBe(1);
    const cleared = await db.prisma.actionPlanAttempt.findUniqueOrThrow({
      where: { id: run.attemptId },
    });
    expect(cleared.clearedAt).not.toBeNull();
    expect(cleared.status).toBe('Succeeded');
  });

  it('marks a run that was in flight during a re-run as superseded', async () => {
    const account = await seedAccount(db.prisma, 'rerun-inflight');
    const scanId = await seedScan(db.prisma, account);
    const run = claimedRun(await claim(db.prisma, scanId, account.accountId));

    await clearActionPlansForScan(db.prisma, scanId, new Date());

    const row = await db.prisma.actionPlanAttempt.findUniqueOrThrow({
      where: { id: run.attemptId },
    });
    expect(row).toMatchObject({ status: 'Failed', failureCode: 'Superseded' });
    expect(row.clearedAt).not.toBeNull();
    // The answer that run is still waiting for cannot land on the new snapshot.
    expect(await completePlanRun(db.prisma, scanId, run, FINISHED_PLAN, new Date())).toEqual({
      kind: 'discarded',
      reason: 'Superseded',
    });
  });

  it('cannot resurrect a plan a re-run deleted while the completion was reading', async () => {
    const account = await seedAccount(db.prisma, 'interleaved');
    const scanId = await seedScan(db.prisma, account);
    const run = claimedRun(await claim(db.prisma, scanId, account.accountId));

    // The interleaving that used to be possible, made deterministic: a re-run
    // holds the scan row and has NOT committed, so the completion that starts
    // now must wait for it instead of deciding on the world as it was.
    let reachedClear = (): void => {};
    let commitRerun = (): void => {};
    const clearTaken = new Promise<void>((resolve) => (reachedClear = resolve));
    const rerunMayCommit = new Promise<void>((resolve) => (commitRerun = resolve));
    const rerun = db.prisma.$transaction(
      async (tx) => {
        await clearActionPlansInTransaction(tx, scanId, new Date());
        reachedClear();
        await rerunMayCommit;
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
    await clearTaken;

    let settled = false;
    const completion = completePlanRun(db.prisma, scanId, run, FINISHED_PLAN, new Date()).then(
      (result) => {
        settled = true;
        return result;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    // Still waiting: the completion cannot read the scan until the re-run
    // commits, which is what makes the interleaving deterministic rather than a
    // race the test would only sometimes lose.
    expect(settled).toBe(false);

    commitRerun();
    await rerun;

    expect(await completion).toEqual({ kind: 'discarded', reason: 'Superseded' });
    expect(await db.prisma.actionPlan.count({ where: { scanId } })).toBe(0);
    expect(
      await db.prisma.scan.findUniqueOrThrow({
        where: { id: scanId },
        select: { actionPlanSuccesses: true, actionPlanRunAttemptId: true },
      }),
    ).toEqual({ actionPlanSuccesses: 0, actionPlanRunAttemptId: null });
  });

  it('stores one plan per language and replaces it on the next success', async () => {
    const account = await seedAccount(db.prisma, 'languages');
    const scanId = await seedScan(db.prisma, account);

    for (const language of ['en', 'uk', 'en'] as const) {
      const result = await claimPlanRun(db.prisma, {
        scanId,
        accountId: account.accountId,
        language,
        noticeVersion: ACTION_PLAN_NOTICE_VERSION,
        now: new Date(),
      });
      await completePlanRun(db.prisma, scanId, claimedRun(result), FINISHED_PLAN, new Date());
    }

    const plans = await db.prisma.actionPlan.findMany({
      where: { scanId },
      orderBy: { language: 'asc' },
      select: { language: true },
    });
    expect(plans.map((plan) => plan.language)).toEqual(['en', 'uk']);
    // Three successes were spent even though two rows exist: a rewrite costs.
    expect(
      await db.prisma.scan.findUniqueOrThrow({
        where: { id: scanId },
        select: { actionPlanSuccesses: true, actionPlanAttempts: true },
      }),
    ).toEqual({ actionPlanSuccesses: 3, actionPlanAttempts: 3 });
    expect((await claim(db.prisma, scanId, account.accountId)).kind).toBe('limit_reached');
  });
});

/**
 * The claim proves nobody else holds the scan's slot. It does not prove the
 * report is still one this account paid for — and between the click and the
 * provider call lie the queue and the model's thinking time, which is exactly
 * where a refund, a re-run or a takeover lands. Every test here is about money
 * that must NOT be spent, so each one asserts on the provider call count.
 */
describe('Action Plan spend, between the claim and the provider', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  interface CountedProvider {
    readonly provider: AiProvider;
    calls(): number;
  }

  /** The plan provider, wrapped so a test can assert it was never asked. */
  function countedProvider(): CountedProvider {
    const inner = new MockAiProvider(
      [
        {
          questionIncludes: 'Write the Action Plan',
          response: {
            id: 'msg_plan',
            status: 'completed',
            output_text: JSON.stringify({
              overview: 'Publish the basics search engines look for.',
              actions: [
                {
                  title: 'Publish a robots.txt',
                  why: 'Crawlers guess what they may read without it.',
                  steps: ['Create /robots.txt'],
                  effort: 'small',
                  ruleIds: ['SEO-TECH-001'],
                },
              ],
            }),
            usage: { input_tokens: 900, output_tokens: 400 },
          },
        },
      ],
      {
        config: {
          provider: 'anthropic',
          apiVersion: '2023-06-01',
          modelId: 'claude-opus-5',
          timeoutMs: 1000,
          maxRetries: 1,
        },
      },
    );
    let calls = 0;
    return {
      provider: {
        config: inner.config,
        send: (request, promptText, signal) => {
          calls += 1;
          return inner.send(request, promptText, signal);
        },
      },
      calls: () => calls,
    };
  }

  /**
   * A scan a generation can actually run against: one open SEO issue to plan
   * and the processing record the AI layer requires. Consent is seeded for the
   * refusal tests too, so that when the provider is not called it is the gate
   * that stopped it and not a missing record.
   */
  async function seedRunnableScan(
    account: SeededAccount,
    completedAt = new Date(),
  ): Promise<string> {
    const scanId = await seedScan(db.prisma, account, completedAt);
    await seedOpenIssue(scanId, account.domain);
    await db.prisma.aiConsent.create({
      data: {
        accountId: account.accountId,
        scanId,
        providersJson: JSON.stringify(['anthropic']),
        noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
      },
    });
    return scanId;
  }

  /** One open SEO issue, so there is something to plan and a rule to name. */
  async function seedOpenIssue(scanId: string, domain: string): Promise<void> {
    await db.prisma.issue.create({
      data: {
        scanId,
        ruleId: 'SEO-TECH-001',
        module: 'SEO',
        fingerprint: `fp-${scanId}`,
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
      },
    });
  }

  async function run(
    scanId: string,
    claimed: ClaimedRun,
    provider: CountedProvider,
  ): Promise<void> {
    await generateActionPlan(
      {
        prisma: db.prisma,
        now: () => new Date(),
        logger: silentLogger,
        createProvider: () => provider.provider,
      },
      scanId,
      claimed,
      new AbortController().signal,
    );
  }

  async function attemptOf(attemptId: string) {
    return db.prisma.actionPlanAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  }

  it('writes the plan when everything the claim was authorised by still holds', async () => {
    const account = await seedAccount(db.prisma, 'authorised');
    const scanId = await seedRunnableScan(account);
    const claimed = claimedRun(await claim(db.prisma, scanId, account.accountId));
    const provider = countedProvider();

    await run(scanId, claimed, provider);

    expect(provider.calls()).toBe(1);
    expect(await db.prisma.actionPlan.count({ where: { scanId } })).toBe(1);
    expect(await attemptOf(claimed.attemptId)).toMatchObject({ status: 'Succeeded' });
  });

  it('never asks the provider for a report that was refunded while the run waited', async () => {
    const account = await seedAccount(db.prisma, 'refund-queue');
    const scanId = await seedRunnableScan(account);
    const claimed = claimedRun(await claim(db.prisma, scanId, account.accountId));
    const provider = countedProvider();

    await db.prisma.purchase.updateMany({
      where: { scan: { id: scanId } },
      data: { status: 'Refunded' },
    });
    await run(scanId, claimed, provider);

    expect(provider.calls()).toBe(0);
    expect(await db.prisma.actionPlan.count({ where: { scanId } })).toBe(0);
    expect(await attemptOf(claimed.attemptId)).toMatchObject({
      status: 'Failed',
      failureCode: 'AccessRevoked',
    });
    // The slot is handed back: a refund is not a reason to leave the scan stuck.
    expect(
      await db.prisma.scan.findUniqueOrThrow({
        where: { id: scanId },
        select: { actionPlanRunAttemptId: true },
      }),
    ).toEqual({ actionPlanRunAttemptId: null });
  });

  it('never asks the provider once the entitlement expired: generating is new work', async () => {
    const account = await seedAccount(db.prisma, 'expired-queue');
    const scanId = await seedRunnableScan(account);
    const claimed = claimedRun(await claim(db.prisma, scanId, account.accountId));
    const provider = countedProvider();

    await db.prisma.entitlement.updateMany({
      where: { purchase: { scan: { id: scanId } } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await run(scanId, claimed, provider);

    expect(provider.calls()).toBe(0);
    expect(await attemptOf(claimed.attemptId)).toMatchObject({ failureCode: 'AccessRevoked' });
  });

  it('never asks the provider for a snapshot the scan replaced while the run waited', async () => {
    const account = await seedAccount(db.prisma, 'rescan-queue');
    const scanId = await seedRunnableScan(account);
    const claimed = claimedRun(await claim(db.prisma, scanId, account.accountId));
    const provider = countedProvider();

    await db.prisma.scan.update({
      where: { id: scanId },
      data: { completedAt: new Date(Date.now() + 1000) },
    });
    await run(scanId, claimed, provider);

    expect(provider.calls()).toBe(0);
    expect(await attemptOf(claimed.attemptId)).toMatchObject({ failureCode: 'SnapshotChanged' });
  });

  it('never asks the provider while the worker is still finishing the scan', async () => {
    const account = await seedAccount(db.prisma, 'job-queue');
    const scanId = await seedRunnableScan(account);
    const claimed = claimedRun(await claim(db.prisma, scanId, account.accountId));
    const provider = countedProvider();

    // Analytics is written after the outcome is resolved, so a job that went
    // back to Running means the snapshot this plan would describe is moving.
    await db.prisma.job.updateMany({ where: { scanId }, data: { status: 'Running' } });
    await run(scanId, claimed, provider);

    expect(provider.calls()).toBe(0);
    expect(await attemptOf(claimed.attemptId)).toMatchObject({ failureCode: 'SnapshotChanged' });
  });

  it('never asks the provider after a re-run took the scan away from the claim', async () => {
    const account = await seedAccount(db.prisma, 'takeover-queue');
    const scanId = await seedRunnableScan(account);
    const claimed = claimedRun(await claim(db.prisma, scanId, account.accountId));
    const provider = countedProvider();

    await clearActionPlansForScan(db.prisma, scanId, new Date());
    await run(scanId, claimed, provider);

    expect(provider.calls()).toBe(0);
    expect(await db.prisma.actionPlan.count({ where: { scanId } })).toBe(0);
    // The re-run already marked it; a second failure must not overwrite that.
    expect(await attemptOf(claimed.attemptId)).toMatchObject({
      status: 'Failed',
      failureCode: 'Superseded',
    });
  });

  it('never asks the provider once the Plan Window has closed', async () => {
    const account = await seedAccount(db.prisma, 'window-queue');
    const closedLongAgo = new Date(Date.now() - ACTION_PLAN_LIMITS.windowMs - 60_000);
    const scanId = await seedRunnableScan(account, closedLongAgo);
    // The route refuses this; the claim itself does not, so the run has to.
    const claimed = claimedRun(await claim(db.prisma, scanId, account.accountId));
    const provider = countedProvider();

    await run(scanId, claimed, provider);

    expect(provider.calls()).toBe(0);
    expect(await attemptOf(claimed.attemptId)).toMatchObject({ failureCode: 'WindowClosed' });
  });

  it('records a deleted scan without an internal error and writes nothing', async () => {
    const account = await seedAccount(db.prisma, 'deleted-queue');
    const scanId = await seedRunnableScan(account);
    const claimed = claimedRun(await claim(db.prisma, scanId, account.accountId));
    const provider = countedProvider();

    await deleteScanResult(db.prisma, scanId);
    await expect(run(scanId, claimed, provider)).resolves.toBeUndefined();

    expect(provider.calls()).toBe(0);
    expect(await db.prisma.actionPlan.count()).toBe(0);
    // The scan is gone; the start it already cost the account is not.
    expect(
      await db.prisma.actionPlanAttempt.findUniqueOrThrow({ where: { id: claimed.attemptId } }),
    ).toMatchObject({ scanId: null, status: 'Failed', failureCode: 'Superseded' });
  });
});
