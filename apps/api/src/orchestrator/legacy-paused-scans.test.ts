import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cancelScan } from '../billing/cancel-scan.ts';
import { JOB_STATUSES, STATUS_REASONS } from '../billing/constants.ts';
import { InvalidTransitionError } from '../billing/errors.ts';
import { transitionScan } from '../billing/state-machine.ts';
import { silentLogger } from '../http/logger.ts';
import { createApp } from '../index.ts';
import {
  createTestDb,
  seedAccountWithProfile,
  seedScan,
  type SeededAccount,
  type TestDb,
} from '../test-utils/test-db.ts';
import { resumeLegacyPausedScans, resumeScan } from './legacy-paused-scans.ts';

// Scans paused before the pause feature was removed. Nothing can pause a scan
// any more, so every row here is written the way the old code left it — status
// `Paused`, the state it was paused from in `statusReason`, the flag set and
// the job parked — and what is defended is that such a paid run is never
// stranded: it goes back in the queue on the job and purchase it already has.

let db: TestDb;
let account: SeededAccount;

beforeEach(async () => {
  db = await createTestDb();
  account = await seedAccountWithProfile(db.prisma);
});

afterEach(async () => {
  await db.cleanup();
});

const PAUSED_REASON = {
  Pending: STATUS_REASONS.pausedPreQueue,
  Queued: STATUS_REASONS.pausedAfterQueue,
  Running: STATUS_REASONS.pausedAfterStart,
} as const;

/** A scan exactly as the removed pause left it: parked, flagged, job held. */
async function seedLegacyPaused(from: 'Pending' | 'Queued' | 'Running') {
  const { scan, purchase } = await seedScan(db.prisma, {
    account,
    status: 'Paused',
    statusReason: PAUSED_REASON[from],
    plan: 'Complete',
  });
  const startedAt = from === 'Running' ? new Date(Date.now() - 60_000) : null;
  await db.prisma.scan.update({
    where: { id: scan.id },
    data: { pauseRequestedAt: new Date(), startedAt },
  });
  const job = await db.prisma.job.create({
    data: { scanId: scan.id, type: 'scan', status: JOB_STATUSES.paused },
  });
  return { scan, purchase, job, startedAt };
}

async function seedWithJob(status: 'Pending' | 'Queued' | 'Running', jobStatus: string) {
  const { scan } = await seedScan(db.prisma, { account, status, plan: 'Complete' });
  await db.prisma.job.create({ data: { scanId: scan.id, type: 'scan', status: jobStatus } });
  return scan;
}

describe('resuming a legacy paused scan', () => {
  it('continues the same job and creates no second scan, job or purchase', async () => {
    const { scan, purchase, job } = await seedLegacyPaused('Queued');

    await resumeScan(db.prisma, scan.id, new Date());

    const resumed = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(resumed.status).toBe('Queued');
    expect(resumed.pauseRequestedAt).toBeNull();
    expect(resumed.statusReason).toBeNull();
    const jobAfter = await db.prisma.job.findUniqueOrThrow({ where: { scanId: scan.id } });
    expect(jobAfter.id).toBe(job.id);
    expect(jobAfter.status).toBe(JOB_STATUSES.pending);
    await expect(db.prisma.scan.count()).resolves.toBe(1);
    await expect(db.prisma.job.count()).resolves.toBe(1);
    await expect(db.prisma.purchase.count()).resolves.toBe(purchase === null ? 0 : 1);
    await expect(db.prisma.refundRecord.count()).resolves.toBe(0);
  });

  // The export contract reads started_at <= observed_at <= completed_at, and
  // findings recorded before the pause would fall outside a start that moved.
  it('keeps the start it already had when the run is picked up again', async () => {
    const { scan, startedAt } = await seedLegacyPaused('Running');

    await resumeScan(db.prisma, scan.id, new Date());
    await transitionScan(db.prisma, scan.id, 'Queued', 'Running', {});

    const resumed = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(resumed.startedAt?.getTime()).toBe(startedAt?.getTime());
    expect(resumed.completedAt).toBeNull();
  });

  it('refuses to resume a scan that is not paused', async () => {
    const scan = await seedWithJob('Running', JOB_STATUSES.claimed);

    await expect(resumeScan(db.prisma, scan.id, new Date())).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
  });

  it('lets exactly one of two concurrent resumes win', async () => {
    const { scan } = await seedLegacyPaused('Queued');

    const outcomes = await Promise.allSettled([
      resumeScan(db.prisma, scan.id, new Date()),
      resumeScan(db.prisma, scan.id, new Date()),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const resumed = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(resumed.status).toBe('Queued');
  });
});

describe('the legacy pause sweep', () => {
  it('resumes every paused scan onto its existing job, and charges nothing', async () => {
    const first = await seedLegacyPaused('Pending');
    const second = await seedLegacyPaused('Running');

    const result = await resumeLegacyPausedScans(db.prisma, new Date());

    expect([...result.resumedScanIds].sort()).toEqual([first.scan.id, second.scan.id].sort());
    for (const { scan, job } of [first, second]) {
      const resumed = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
      expect(resumed.status).toBe('Queued');
      expect(resumed.pauseRequestedAt).toBeNull();
      const jobAfter = await db.prisma.job.findUniqueOrThrow({ where: { scanId: scan.id } });
      expect(jobAfter.id).toBe(job.id);
      expect(jobAfter.status).toBe(JOB_STATUSES.pending);
    }
    await expect(db.prisma.scan.count()).resolves.toBe(2);
    await expect(db.prisma.job.count()).resolves.toBe(2);
    await expect(db.prisma.purchase.count()).resolves.toBe(2);
    await expect(db.prisma.refundRecord.count()).resolves.toBe(0);
  });

  it('clears a stray pause flag without touching the run it sits on', async () => {
    const running = await seedWithJob('Running', JOB_STATUSES.claimed);
    const queued = await seedWithJob('Queued', JOB_STATUSES.pending);
    await db.prisma.scan.updateMany({
      where: { id: { in: [running.id, queued.id] } },
      data: { pauseRequestedAt: new Date() },
    });

    const result = await resumeLegacyPausedScans(db.prisma, new Date());

    expect(result.clearedFlagCount).toBe(2);
    for (const [scan, status, jobStatus] of [
      [running, 'Running', JOB_STATUSES.claimed],
      [queued, 'Queued', JOB_STATUSES.pending],
    ] as const) {
      const row = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
      expect(row.status).toBe(status);
      expect(row.pauseRequestedAt).toBeNull();
      const job = await db.prisma.job.findUniqueOrThrow({ where: { scanId: scan.id } });
      expect(job.status).toBe(jobStatus);
    }
  });

  // The old park/resume race could leave a queued scan over a parked job that
  // nothing claims; after the removal nothing ever would.
  it('hands a job parked under a queued scan back to the drain', async () => {
    const queued = await seedWithJob('Queued', JOB_STATUSES.paused);

    const result = await resumeLegacyPausedScans(db.prisma, new Date());

    expect(result.releasedJobCount).toBe(1);
    const job = await db.prisma.job.findUniqueOrThrow({ where: { scanId: queued.id } });
    expect(job.status).toBe(JOB_STATUSES.pending);
  });

  it('is idempotent: a second pass changes nothing', async () => {
    await seedLegacyPaused('Queued');
    await resumeLegacyPausedScans(db.prisma, new Date());

    const again = await resumeLegacyPausedScans(db.prisma, new Date());

    expect(again).toEqual({ resumedScanIds: [], releasedJobCount: 0, clearedFlagCount: 0 });
  });

  it('leaves a scan the owner cancelled first cancelled', async () => {
    const { scan } = await seedLegacyPaused('Queued');
    await cancelScan(db.prisma, scan.id);

    const result = await resumeLegacyPausedScans(db.prisma, new Date());

    expect(result.resumedScanIds).toEqual([]);
    const row = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(row.status).toBe('Cancelled');
  });

  // The sweep and a cancel compete on the same Paused compare-and-set: exactly
  // one of them moves the scan out of Paused, and the loser is not an error. A
  // cancel that lost still cancels — the resumed scan, from Queued.
  it('converges with a concurrent cancel on exactly one winner', async () => {
    const { scan } = await seedLegacyPaused('Pending');

    const [swept, cancelled] = await Promise.all([
      resumeLegacyPausedScans(db.prisma, new Date()),
      cancelScan(db.prisma, scan.id),
    ]);

    const row = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(row.status).toBe('Cancelled');
    if (cancelled.cancelledFrom === 'Paused') {
      expect(swept.resumedScanIds).toEqual([]);
    } else {
      expect(swept.resumedScanIds).toEqual([scan.id]);
      expect(cancelled.cancelledFrom).toBe('Queued');
    }
  });
});

describe('cancelling a legacy paused scan', () => {
  // §18 is about what the run consumed, and a paused scan consumed nothing more
  // than the state it was paused from.
  it('refunds in full when it was paused before it was ever queued', async () => {
    const { scan } = await seedLegacyPaused('Pending');

    const cancelled = await cancelScan(db.prisma, scan.id);

    expect(cancelled.cancelledFrom).toBe('Paused');
    expect(cancelled.refund?.reasonCode).toBe('PRE_QUEUE_CANCEL');
    const settled = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(settled.status).toBe('Cancelled');
  });

  it('does not refund when it was paused after it was queued', async () => {
    const { scan } = await seedLegacyPaused('Queued');

    const cancelled = await cancelScan(db.prisma, scan.id);

    expect(cancelled.cancelledFrom).toBe('Paused');
    expect(cancelled.refund).toBeNull();
    await expect(db.prisma.refundRecord.count()).resolves.toBe(0);
  });

  it('cancels exactly once under two concurrent attempts', async () => {
    const { scan } = await seedLegacyPaused('Pending');

    const outcomes = await Promise.allSettled([
      cancelScan(db.prisma, scan.id),
      cancelScan(db.prisma, scan.id),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    await expect(db.prisma.refundRecord.count()).resolves.toBe(1);
  });
});

describe('the scan endpoints after the pause was removed', () => {
  const PASSWORD = 'sufficiently-long-password';

  async function signedIn(email: string) {
    const agent = request.agent(
      createApp({ prisma: db.prisma, autoProcess: false, logger: silentLogger }),
    );
    const registered = await agent.post('/auth/register').send({ email, password: PASSWORD });
    expect(registered.status).toBe(201);
    const accountRow = await db.prisma.account.findUniqueOrThrow({ where: { email } });
    const profile = await db.prisma.siteProfile.create({
      data: {
        accountId: accountRow.id,
        name: 'Site',
        domain: `https://${email.split('@')[0]}.example`,
      },
    });
    const scan = await db.prisma.scan.create({
      data: {
        accountId: accountRow.id,
        siteProfileId: profile.id,
        plan: 'Complete',
        domain: profile.domain,
        status: 'Queued',
        scopeJson: JSON.stringify({ includeSubdomains: false }),
        rulesetVersion: 'rules-mvp-0.1',
      },
    });
    await db.prisma.job.create({
      data: { scanId: scan.id, type: 'scan', status: JOB_STATUSES.pending },
    });
    return { agent, scanId: scan.id };
  }

  it('no longer has a pause or a resume route', async () => {
    const { agent, scanId } = await signedIn('http-no-pause@example.com');

    const paused = await agent.post(`/scans/${scanId}/pause`);
    const resumed = await agent.post(`/scans/${scanId}/resume`);

    expect([paused.status, resumed.status]).toEqual([404, 404]);
    const row = await db.prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
    expect(row.status).toBe('Queued');
    expect(row.pauseRequestedAt).toBeNull();
  });

  it('still lists a legacy paused scan as the account’s active one', async () => {
    const { agent, scanId } = await signedIn('http-legacy-active@example.com');
    await db.prisma.scan.update({
      where: { id: scanId },
      data: { status: 'Paused', statusReason: STATUS_REASONS.pausedAfterQueue },
    });

    const active = await agent.get('/scans/active');

    expect(active.body.data?.id).toBe(scanId);
    expect(active.body.data?.status).toBe('Paused');
    expect(active.body.data).not.toHaveProperty('pauseRequestedAt');
  });
});
