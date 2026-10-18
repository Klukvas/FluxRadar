import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JOB_STATUSES, STATUS_REASONS } from '../billing/constants.ts';
import { silentLogger } from '../http/logger.ts';
import {
  createTestDb,
  seedAccountWithProfile,
  seedScan,
  type SeededAccount,
  type TestDb,
} from '../test-utils/test-db.ts';
import type { WorkerDeps } from './deps.ts';
import { settleLegacyPausedScan } from './legacy-paused-scans.ts';
import { processScan } from './worker.ts';

// The worker settles a legacy paused scan whose job it claimed, then re-reads
// it. If settling changes nothing — it threw before its compare-and-set, or a
// stale state machine refused it — the row still reads Paused, and looping on
// it would spin forever. Settling is made a no-op here to hold that case open.
vi.mock('./legacy-paused-scans.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./legacy-paused-scans.ts')>()),
  settleLegacyPausedScan: vi.fn(() => Promise.resolve('skipped' as const)),
}));

let db: TestDb;
let account: SeededAccount;

beforeEach(async () => {
  db = await createTestDb();
  account = await seedAccountWithProfile(db.prisma);
});

afterEach(async () => {
  await db.cleanup();
});

describe('a legacy paused scan the worker cannot settle', () => {
  it('parks the job again for the sweep instead of looping', async () => {
    const { scan } = await seedScan(db.prisma, {
      account,
      status: 'Paused',
      statusReason: STATUS_REASONS.pausedAfterQueue,
      plan: 'Complete',
    });
    const job = await db.prisma.job.create({
      data: { scanId: scan.id, type: 'scan', status: JOB_STATUSES.pending },
    });
    const deps: WorkerDeps = {
      prisma: db.prisma,
      logger: silentLogger,
      createAiProvider: () => {
        throw new Error('an unsettled paused scan must not start any outbound work');
      },
    };

    const result = await processScan(deps, scan.id);

    expect(result).toMatchObject({ status: 'Paused', outcome: 'Paused' });
    expect(vi.mocked(settleLegacyPausedScan)).toHaveBeenCalledTimes(1);
    const row = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(row.status).toBe('Paused');
    const jobAfter = await db.prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(jobAfter.status).toBe(JOB_STATUSES.paused);
    expect(jobAfter.claimedAt).toBeNull();
  });
});
