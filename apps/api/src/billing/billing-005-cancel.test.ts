import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cancelScan } from './cancel-scan.ts';
import { refundIdempotencyKey } from './constants.ts';
import { RefundPolicyError } from './errors.ts';
import { requestRefund } from './refund.ts';
import { transitionScan } from './state-machine.ts';
import {
  createTestDb,
  seedAccountWithProfile,
  seedScan,
  type SeededAccount,
  type TestDb,
} from '../test-utils/test-db.ts';

// BILLING-005: cancel before Queued refunds 100% (PRE_QUEUE_CANCEL); stopping
// after processing started is a used run — Cancelled without refund (§18).
// Refunds are idempotent: one RefundRecord per purchase, ever.
describe('BILLING-005 cancellation and refund policy', () => {
  let db: TestDb;
  let account: SeededAccount;

  beforeAll(async () => {
    db = await createTestDb();
    account = await seedAccountWithProfile(db.prisma);
  });

  afterAll(async () => {
    await db.cleanup();
  });

  it('cancels a Pending scan with an automatic PRE_QUEUE_CANCEL refund', async () => {
    const { scan, purchase } = await seedScan(db.prisma, { account, status: 'Pending' });

    const result = await cancelScan(db.prisma, scan.id);

    expect(result.cancelledFrom).toBe('Pending');
    expect(result.refund).not.toBeNull();
    expect(result.refund?.reasonCode).toBe('PRE_QUEUE_CANCEL');
    expect(result.refund?.status).toBe('requested');
    expect(result.refund?.amountUsd).toBe(purchase?.amountUsd);
    expect(result.refund?.idempotencyKey).toBe(refundIdempotencyKey(purchase?.id ?? ''));

    const cancelled = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(cancelled.status).toBe('Cancelled');
  });

  it('cancels a Running scan without any refund', async () => {
    const { scan, purchase } = await seedScan(db.prisma, { account, status: 'Running' });

    const result = await cancelScan(db.prisma, scan.id);

    expect(result.cancelledFrom).toBe('Running');
    expect(result.refund).toBeNull();
    expect(
      await db.prisma.refundRecord.count({ where: { purchaseId: purchase?.id ?? '' } }),
    ).toBe(0);
    const cancelled = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(cancelled.status).toBe('Cancelled');
  });

  it('cancels a Queued scan without any refund', async () => {
    const { scan, purchase } = await seedScan(db.prisma, { account, status: 'Queued' });

    const result = await cancelScan(db.prisma, scan.id);

    expect(result.cancelledFrom).toBe('Queued');
    expect(result.refund).toBeNull();
    expect(
      await db.prisma.refundRecord.count({ where: { purchaseId: purchase?.id ?? '' } }),
    ).toBe(0);
  });

  it('returns the stored record for a repeated refund request (idempotency)', async () => {
    const { scan, purchase } = await seedScan(db.prisma, { account, status: 'Pending' });
    await cancelScan(db.prisma, scan.id);
    const purchaseId = purchase?.id ?? '';

    const repeat = await requestRefund(db.prisma, purchaseId, 'PRE_QUEUE_CANCEL');
    expect(repeat.deduplicated).toBe(true);

    // A different reason code cannot create a second refund either (§18).
    const differentReason = await requestRefund(db.prisma, purchaseId, 'LEGAL_SUPPORT');
    expect(differentReason.deduplicated).toBe(true);
    expect(differentReason.record.id).toBe(repeat.record.id);
    expect(differentReason.record.reasonCode).toBe('PRE_QUEUE_CANCEL');

    expect(await db.prisma.refundRecord.count({ where: { purchaseId } })).toBe(1);
  });

  it('rejects PRE_QUEUE_CANCEL for a scan cancelled after processing started', async () => {
    const { scan, purchase } = await seedScan(db.prisma, { account, status: 'Running' });
    await cancelScan(db.prisma, scan.id);

    await expect(
      requestRefund(db.prisma, purchase?.id ?? '', 'PRE_QUEUE_CANCEL'),
    ).rejects.toBeInstanceOf(RefundPolicyError);
  });

  it('rejects PLATFORM_FAILURE_AFTER_RETRY before the platform retry was used', async () => {
    const { scan, purchase } = await seedScan(db.prisma, { account, status: 'Running' });
    await transitionScan(db.prisma, scan.id, 'Running', 'Failed');

    await expect(
      requestRefund(db.prisma, purchase?.id ?? '', 'PLATFORM_FAILURE_AFTER_RETRY'),
    ).rejects.toBeInstanceOf(RefundPolicyError);
  });
});
