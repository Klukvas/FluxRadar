// Scan retention, for scans that were exported.
//
// A scan is purged when its plan's retention window closes. Every dependent row
// is removed with it, and until now `ExportArtifact` was not on that list — even
// though its foreign key to Scan is ON DELETE RESTRICT (see
// migrations/20260904110000_init/migration.sql). So the delete of the FIRST
// expired scan that had ever been exported raised a foreign key violation,
// `sweepRetention` caught it, logged "retention sweep failed", and NOTHING was
// purged again: the sweep is sequential, so one blocked scan stopped the webhook
// purge and the checkout expiry behind it as well.
//
// The second half of the same gap is the object: a purged scan's report lives in
// private object storage, and deleting the row never deleted the object, so the
// report outlived the retention window that promised to remove it.
//
// The ordering rule is the one `deleteAccountData` already follows: the database
// transaction commits first, and only then is storage touched. A failed database
// deletion must never remove a report that still belongs to a live scan.

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TARIFFS } from '@fluxradar/contracts';

import { deleteScanResult, purgeExpiredScans, runRetentionSweep } from './data-retention.ts';
import { reportObjectKey, type PrivateObjectStore } from './integrations/s3.ts';
import {
  createTestDb,
  seedAccountWithProfile,
  seedScan,
  type SeededAccount,
  type TestDb,
} from './test-utils/test-db.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-06T12:00:00.000Z');

/** Records what was deleted, and optionally refuses a key, like a bucket outage. */
function recordingStore(options: { readonly failOn?: string } = {}): {
  readonly store: PrivateObjectStore;
  readonly deleted: string[];
} {
  const deleted: string[] = [];
  return {
    deleted,
    store: {
      putText: () => Promise.resolve(),
      deleteObject: (key: string) => {
        if (key === options.failOn) {
          return Promise.reject(new Error('bucket refused the delete'));
        }
        deleted.push(key);
        return Promise.resolve();
      },
    },
  };
}

describe('expired scan purge', () => {
  let db: TestDb;
  let account: SeededAccount;

  beforeEach(async () => {
    db = await createTestDb();
    account = await seedAccountWithProfile(db.prisma);
  });

  afterEach(async () => {
    await db.cleanup();
  });

  /** A terminal scan of `plan`, aged `ageDays` days, optionally with a report. */
  async function seedAgedScan(params: {
    readonly plan: 'Free' | 'Basic' | 'Complete';
    readonly ageDays: number;
    readonly exported?: boolean;
  }): Promise<{ readonly scanId: string; readonly objectKey: string | null }> {
    const { scan } = await seedScan(db.prisma, {
      account,
      status: 'Completed',
      plan: params.plan,
      withPurchase: false,
    });
    await db.prisma.scan.update({
      where: { id: scan.id },
      data: { createdAt: new Date(NOW.getTime() - params.ageDays * DAY_MS) },
    });
    if (params.exported !== true) {
      return { scanId: scan.id, objectKey: null };
    }
    const objectKey = reportObjectKey(account.accountId, scan.id, 'json');
    await db.prisma.exportArtifact.create({
      data: {
        accountId: account.accountId,
        scanId: scan.id,
        format: 'json',
        objectKey,
        contentType: 'application/json',
      },
    });
    return { scanId: scan.id, objectKey };
  }

  // The regression itself. Before the fix this rejected with a foreign key
  // violation on ExportArtifact_scanId_fkey, and every later sweep did too.
  it('purges an expired scan that was exported, instead of stalling on its report row', async () => {
    const { scanId } = await seedAgedScan({
      plan: 'Free',
      ageDays: TARIFFS.Free.retentionDays + 1,
      exported: true,
    });

    const result = await purgeExpiredScans(db.prisma, NOW, null);

    expect(result.deletedScanCount).toBe(1);
    expect(await db.prisma.scan.count({ where: { id: scanId } })).toBe(0);
    expect(await db.prisma.exportArtifact.count({ where: { scanId } })).toBe(0);
  });

  // One blocked scan used to stop the whole sweep, so the scans behind it kept
  // their data past the window they were sold with.
  it('keeps purging the scans behind an exported one', async () => {
    const exported = await seedAgedScan({
      plan: 'Free',
      ageDays: TARIFFS.Free.retentionDays + 2,
      exported: true,
    });
    const plain = await seedAgedScan({ plan: 'Free', ageDays: TARIFFS.Free.retentionDays + 1 });

    const result = await purgeExpiredScans(db.prisma, NOW, null);

    expect(result.deletedScanCount).toBe(2);
    expect(
      await db.prisma.scan.count({ where: { id: { in: [exported.scanId, plain.scanId] } } }),
    ).toBe(0);
  });

  // The row and the object are the same promise to the customer; removing only
  // the row leaves the report readable to anyone holding a signed link.
  it('deletes the stored report of a purged scan', async () => {
    const { objectKey } = await seedAgedScan({
      plan: 'Basic',
      ageDays: TARIFFS.Basic.retentionDays + 1,
      exported: true,
    });
    const { store, deleted } = recordingStore();

    const result = await purgeExpiredScans(db.prisma, NOW, store);

    expect(result.deletedScanCount).toBe(1);
    expect(result.orphanedArtifactCount).toBe(0);
    expect(deleted).toEqual([objectKey]);
  });

  // Storage is best effort and reported; the database deletion is not undone,
  // because leaving the scan behind would keep MORE data, not less.
  it('counts a report it could not delete and still removes the scan', async () => {
    const { scanId, objectKey } = await seedAgedScan({
      plan: 'Basic',
      ageDays: TARIFFS.Basic.retentionDays + 1,
      exported: true,
    });
    const { store } = recordingStore({ failOn: objectKey ?? '' });

    const result = await purgeExpiredScans(db.prisma, NOW, store);

    expect(result.deletedScanCount).toBe(1);
    expect(result.orphanedArtifactCount).toBe(1);
    expect(await db.prisma.scan.count({ where: { id: scanId } })).toBe(0);
  });

  it('leaves a scan and its report alone before the window closes', async () => {
    const { scanId } = await seedAgedScan({
      plan: 'Complete',
      ageDays: TARIFFS.Complete.retentionDays - 1,
      exported: true,
    });
    const { store, deleted } = recordingStore();

    const result = await purgeExpiredScans(db.prisma, NOW, store);

    expect(result.deletedScanCount).toBe(0);
    expect(deleted).toEqual([]);
    expect(await db.prisma.exportArtifact.count({ where: { scanId } })).toBe(1);
  });

  // deleteScanResult is also the single-scan entry point, so it has to report
  // the keys it removed rather than leave the caller to guess them.
  it('reports the object keys it removed', async () => {
    const { scanId, objectKey } = await seedAgedScan({ plan: 'Free', ageDays: 1, exported: true });

    await expect(deleteScanResult(db.prisma, scanId)).resolves.toEqual([objectKey]);
    expect(await db.prisma.exportArtifact.count({ where: { scanId } })).toBe(0);
  });

  it('reports nothing for a scan that no longer exists', async () => {
    await expect(deleteScanResult(db.prisma, `missing-${randomUUID()}`)).resolves.toEqual([]);
  });

  // The scheduled sweep is what actually runs in production, and it has to carry
  // the storage outcome so an operator can see a bucket that stopped accepting
  // deletes instead of discovering it from a bill.
  it('reports orphaned reports through the scheduled sweep', async () => {
    const { objectKey } = await seedAgedScan({
      plan: 'Free',
      ageDays: TARIFFS.Free.retentionDays + 1,
      exported: true,
    });
    const { store } = recordingStore({ failOn: objectKey ?? '' });

    const result = await runRetentionSweep(db.prisma, NOW, store);

    expect(result.deletedScanCount).toBe(1);
    expect(result.orphanedArtifactCount).toBe(1);
  });
});
