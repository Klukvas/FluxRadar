import { CURRENT_AI_PROCESSING_NOTICE_VERSION } from '@fluxradar/ai';
import request from 'supertest';
import type { Response } from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../index.ts';
import { silentLogger } from '../http/logger.ts';
import { PURCHASE_STATUSES, REFUND_STATUSES } from '../billing/constants.ts';
import { accountDeletionHash } from '../data-retention.ts';
import type { PrivateObjectStore } from '../integrations/s3.ts';
import {
  createTestDb,
  seedScan,
  seedScanModule,
  type SeededAccount,
  type TestDb,
} from '../test-utils/test-db.ts';
import { PROFILE_DELETION_REASON } from './profile-deletion.ts';

// Deleting a site profile takes the audit and billing history of that site with
// it — and nothing of any other site — but never while something is still in
// motion: a scan the worker may run, or a refund that is still owed.

const PASSWORD = 'sufficiently-long-password';
const DAY_MS = 24 * 60 * 60 * 1000;

interface RecordingObjectStore extends PrivateObjectStore {
  readonly deletedKeys: readonly string[];
}

function recordingObjectStore(): RecordingObjectStore {
  const deletedKeys: string[] = [];
  return {
    deletedKeys,
    putText: () => Promise.resolve(),
    deleteObject: (key) => {
      deletedKeys.push(key);
      return Promise.resolve();
    },
  };
}

describe('site profile deletion', () => {
  let db: TestDb;
  let objectStore: RecordingObjectStore;

  beforeEach(async () => {
    db = await createTestDb();
    objectStore = recordingObjectStore();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  async function signIn(email: string) {
    const app = createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
      objectStore,
    });
    const agent = request.agent(app);
    const registered = await agent.post('/auth/register').send({ email, password: PASSWORD });
    expect(registered.status).toBe(201);
    return { agent, accountId: registered.body.data.accountId as string };
  }

  async function createProfile(
    agent: ReturnType<typeof request.agent>,
    accountId: string,
    domain: string,
  ): Promise<SeededAccount> {
    const created = await agent.post('/profiles').send({ name: 'Site', domain });
    expect(created.status).toBe(201);
    return { accountId, siteProfileId: created.body.data.id as string, domain };
  }

  /** A finished paid audit with every row that hangs off its scan and purchase. */
  async function seedPaidHistory(profile: SeededAccount, key: string) {
    const { scan, purchase } = await seedScan(db.prisma, { account: profile, status: 'Completed' });
    if (purchase === null) throw new Error('seedScan did not create a purchase');
    await seedScanModule(db.prisma, {
      scanId: scan.id,
      module: 'SEO',
      runtimeStatus: 'Completed',
      usableOutput: true,
    });
    await db.prisma.job.create({ data: { scanId: scan.id, type: 'scan', status: 'Done' } });
    await db.prisma.aiConsent.create({
      data: {
        accountId: profile.accountId,
        scanId: scan.id,
        providersJson: JSON.stringify(['anthropic', 'openai']),
        noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
      },
    });
    await db.prisma.exportArtifact.create({
      data: {
        accountId: profile.accountId,
        scanId: scan.id,
        format: 'json',
        objectKey: `exports/${key}.json`,
        contentType: 'application/json',
      },
    });
    await db.prisma.entitlement.create({
      data: { purchaseId: purchase.id, expiresAt: new Date(Date.now() + DAY_MS) },
    });
    await db.prisma.refundRecord.create({
      data: {
        purchaseId: purchase.id,
        idempotencyKey: `refund:${purchase.id}`,
        reasonCode: 'TEST',
        status: REFUND_STATUSES.paid,
        amountUsd: 10,
        provider: purchase.provider,
      },
    });
    await db.prisma.webhookEvent.create({
      data: {
        provider: purchase.provider,
        providerEventId: `evt_${key}`,
        accountId: profile.accountId,
        providerTransactionId: purchase.providerTransactionId,
        eventType: 'transaction.completed',
        rawBody: '{}',
        signature: 'test-signature',
      },
    });
    return { scanId: scan.id, purchaseId: purchase.id };
  }

  function expectBlocked(response: Response, code: string): void {
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe(code);
  }

  it('removes the site with its audit and billing history and leaves other sites alone', async () => {
    const { agent, accountId } = await signIn('owner@example.com');
    const target = await createProfile(agent, accountId, 'https://gone.example.com');
    const kept = await createProfile(agent, accountId, 'https://kept.example.com');
    const gone = await seedPaidHistory(target, 'gone');
    const other = await seedPaidHistory(kept, 'kept');
    await db.prisma.freeCheckClaim.create({ data: { origin: target.domain } });

    const deleted = await agent.delete(`/profiles/${target.siteProfileId}`);

    expect(deleted.status).toBe(200);
    expect(await db.prisma.siteProfile.count({ where: { id: target.siteProfileId } })).toBe(0);
    expect(await db.prisma.scan.count({ where: { id: gone.scanId } })).toBe(0);
    expect(await db.prisma.scanModule.count({ where: { scanId: gone.scanId } })).toBe(0);
    expect(await db.prisma.exportArtifact.count({ where: { scanId: gone.scanId } })).toBe(0);
    expect(await db.prisma.purchase.count({ where: { id: gone.purchaseId } })).toBe(0);
    expect(await db.prisma.entitlement.count({ where: { purchaseId: gone.purchaseId } })).toBe(0);
    expect(await db.prisma.refundRecord.count({ where: { purchaseId: gone.purchaseId } })).toBe(0);
    expect(await db.prisma.webhookEvent.count({ where: { providerEventId: 'evt_gone' } })).toBe(0);
    expect(objectStore.deletedKeys).toEqual(['exports/gone.json']);
    expect(
      await db.prisma.deletedScan.findUnique({ where: { scanId: gone.scanId } }),
    ).toMatchObject({
      reason: PROFILE_DELETION_REASON,
      accountIdHash: accountDeletionHash(accountId),
    });

    expect(await db.prisma.scan.count({ where: { id: other.scanId } })).toBe(1);
    expect(await db.prisma.purchase.count({ where: { id: other.purchaseId } })).toBe(1);
    expect(await db.prisma.exportArtifact.count({ where: { scanId: other.scanId } })).toBe(1);
    expect(await db.prisma.webhookEvent.count({ where: { providerEventId: 'evt_kept' } })).toBe(1);

    // Re-adding the site is allowed, but it does not earn a second free check.
    expect(await db.prisma.freeCheckClaim.count({ where: { origin: target.domain } })).toBe(1);
    const readded = await agent.post('/profiles').send({ name: 'Again', domain: target.domain });
    expect(readded.status).toBe(201);
  });

  // Deleting a profile is the cheapest way a customer could reach the Action
  // Plan spend log, so it is the one that must not clear it: the row loses its
  // scan and keeps counting against the hourly and daily caps until retention
  // decides it counts for nothing (D-232, data-retention.ts).
  it('keeps the Action Plan spend log of the scans it deletes', async () => {
    const { agent, accountId } = await signIn('spend@example.com');
    const profile = await createProfile(agent, accountId, 'https://spend.example.com');
    const history = await seedPaidHistory(profile, 'spend');
    await db.prisma.actionPlanAttempt.create({
      data: {
        scanId: history.scanId,
        accountId,
        language: 'en',
        status: 'Succeeded',
        noticeVersion: 'action-plan-notice-v1',
      },
    });

    expect((await agent.delete(`/profiles/${profile.siteProfileId}`)).status).toBe(200);

    expect(await db.prisma.scan.count({ where: { id: history.scanId } })).toBe(0);
    expect(await db.prisma.actionPlanAttempt.count({ where: { accountId, scanId: null } })).toBe(1);
  });

  // Paused belongs on this list: the run has not been given up on, and a resume
  // would crawl a site whose profile is gone. It leaves the same way the others
  // do — the owner cancels or resumes it first.
  it.each(['Pending', 'Queued', 'Running', 'Paused'] as const)(
    'refuses while a scan is %s and keeps everything',
    async (status) => {
      const { agent, accountId } = await signIn('busy@example.com');
      const profile = await createProfile(agent, accountId, 'https://busy.example.com');
      const { scan } = await seedScan(db.prisma, { account: profile, status, withPurchase: false });

      expectBlocked(
        await agent.delete(`/profiles/${profile.siteProfileId}`),
        'PROFILE_HAS_ACTIVE_SCAN',
      );
      expect(await db.prisma.siteProfile.count({ where: { id: profile.siteProfileId } })).toBe(1);
      expect(await db.prisma.scan.count({ where: { id: scan.id } })).toBe(1);
    },
  );

  it.each([REFUND_STATUSES.requested, REFUND_STATUSES.processing])(
    'refuses while a refund is %s, and lets the site go once it is paid',
    async (refundStatus) => {
      const { agent, accountId } = await signIn('refund@example.com');
      const profile = await createProfile(agent, accountId, 'https://refund.example.com');
      const history = await seedPaidHistory(profile, 'refund');
      await db.prisma.refundRecord.update({
        where: { purchaseId: history.purchaseId },
        data: { status: refundStatus },
      });

      expectBlocked(
        await agent.delete(`/profiles/${profile.siteProfileId}`),
        'PROFILE_HAS_OPEN_REFUND',
      );
      expect(await db.prisma.purchase.count({ where: { id: history.purchaseId } })).toBe(1);

      await db.prisma.refundRecord.update({
        where: { purchaseId: history.purchaseId },
        data: { status: REFUND_STATUSES.paid },
      });
      expect((await agent.delete(`/profiles/${profile.siteProfileId}`)).status).toBe(200);
    },
  );

  // Nothing moves a purchase out of Disputed, so blocking on it would make the
  // profile undeletable forever.
  it('deletes a site whose purchase is disputed', async () => {
    const { agent, accountId } = await signIn('dispute@example.com');
    const profile = await createProfile(agent, accountId, 'https://dispute.example.com');
    const history = await seedPaidHistory(profile, 'dispute');
    await db.prisma.purchase.update({
      where: { id: history.purchaseId },
      data: { status: PURCHASE_STATUSES.disputed },
    });

    expect((await agent.delete(`/profiles/${profile.siteProfileId}`)).status).toBe(200);
    expect(await db.prisma.purchase.count({ where: { id: history.purchaseId } })).toBe(0);
  });

  it("answers 404 for another account's profile and deletes nothing", async () => {
    const owner = await signIn('owner@example.com');
    const profile = await createProfile(owner.agent, owner.accountId, 'https://owned.example.com');
    const { scan } = await seedScan(db.prisma, { account: profile, status: 'Completed' });
    const stranger = await signIn('stranger@example.com');

    const response = await stranger.agent.delete(`/profiles/${profile.siteProfileId}`);

    expect(response.status).toBe(404);
    expect(await db.prisma.siteProfile.count({ where: { id: profile.siteProfileId } })).toBe(1);
    expect(await db.prisma.scan.count({ where: { id: scan.id } })).toBe(1);
  });
});
