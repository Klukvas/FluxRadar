import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { STATUS_REASONS } from './constants.ts';
import { InvalidTransitionError } from './errors.ts';
import { resolveScanOutcome } from './resolve-outcome.ts';
import { transitionScan } from './state-machine.ts';
import {
  createTestDb,
  seedAccountWithProfile,
  seedScan,
  seedScanModule,
  type SeededAccount,
  type TestDb,
} from '../test-utils/test-db.ts';

// BILLING-006: NoUsableOutput branch (§18, D-026/D-027) — zero usable modules
// grants exactly one external retry, then Failed + EXTERNAL_NO_USABLE_OUTPUT
// full refund; at least one usable module means Partial without refund.
// Retry counters never exceed 1.
describe('BILLING-006 NoUsableOutput resolution and refund', () => {
  let db: TestDb;
  let account: SeededAccount;

  beforeAll(async () => {
    db = await createTestDb();
    account = await seedAccountWithProfile(db.prisma);
  });

  afterAll(async () => {
    await db.cleanup();
  });

  it('grants one retry, then fails with NoUsableOutput and a full refund', async () => {
    const { scan, purchase } = await seedScan(db.prisma, { account, status: 'Running' });
    // §18 billing fixture: a completed check without a valid metric/score/
    // finding-with-evidence is still NOT usable output.
    await seedScanModule(db.prisma, {
      scanId: scan.id,
      module: 'SEO',
      runtimeStatus: 'Completed',
      usableOutput: false,
      applicableChecks: 5,
      completedApplicableChecks: 5,
    });
    await seedScanModule(db.prisma, {
      scanId: scan.id,
      module: 'AI SEO / GEO',
      runtimeStatus: 'Unavailable',
      usableOutput: false,
    });

    const first = await resolveScanOutcome(db.prisma, scan.id);
    expect(first.kind).toBe('ExternalRetryGranted');
    const afterRetry = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(afterRetry.status).toBe('Running');
    expect(afterRetry.moduleRetryCount).toBe(1);

    const second = await resolveScanOutcome(db.prisma, scan.id);
    expect(second.kind).toBe('Failed');
    if (second.kind === 'Failed') {
      expect(second.refund?.reasonCode).toBe('EXTERNAL_NO_USABLE_OUTPUT');
      expect(second.refund?.amountUsd).toBe(purchase?.amountUsd);
    }

    const failed = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(failed.status).toBe('Failed');
    expect(failed.statusReason).toBe(STATUS_REASONS.noUsableOutput);
    expect(failed.moduleRetryCount).toBe(1);

    // A third resolution attempt neither bumps the counter nor duplicates the refund.
    await expect(resolveScanOutcome(db.prisma, scan.id)).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
    const settled = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(settled.moduleRetryCount).toBe(1);
    expect(await db.prisma.refundRecord.count({ where: { purchaseId: purchase?.id ?? '' } })).toBe(
      1,
    );
  });

  it('resolves to Partial without refund when at least one module is usable', async () => {
    const { scan, purchase } = await seedScan(db.prisma, { account, status: 'Running' });
    await seedScanModule(db.prisma, {
      scanId: scan.id,
      module: 'SEO',
      runtimeStatus: 'Completed',
      usableOutput: true,
      applicableChecks: 5,
      completedApplicableChecks: 5,
    });
    await seedScanModule(db.prisma, {
      scanId: scan.id,
      module: 'AI SEO / GEO',
      runtimeStatus: 'Unavailable',
      usableOutput: false,
    });

    const outcome = await resolveScanOutcome(db.prisma, scan.id);
    expect(outcome.kind).toBe('Partial');

    const partial = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(partial.status).toBe('Partial');
    expect(partial.statusReason).toBe(STATUS_REASONS.externalModuleFailure);
    expect(await db.prisma.refundRecord.count({ where: { purchaseId: purchase?.id ?? '' } })).toBe(
      0,
    );
  });

  it('resolves to Completed when every module is usable and all checks are closed', async () => {
    const { scan } = await seedScan(db.prisma, { account, status: 'Running' });
    await seedScanModule(db.prisma, {
      scanId: scan.id,
      module: 'SEO',
      runtimeStatus: 'Completed',
      usableOutput: true,
      applicableChecks: 5,
      completedApplicableChecks: 5,
    });
    // Fully Not-applicable modules do not block Completed (D-027 boundary).
    await seedScanModule(db.prisma, {
      scanId: scan.id,
      module: 'Privacy',
      runtimeStatus: 'Not applicable',
      usableOutput: false,
    });

    const outcome = await resolveScanOutcome(db.prisma, scan.id);
    expect(outcome.kind).toBe('Completed');
  });

  it('fails a purchase-less Free scan without creating a refund', async () => {
    const refundsBefore = await db.prisma.refundRecord.count();
    const { scan } = await seedScan(db.prisma, {
      account,
      status: 'Running',
      plan: 'Free',
      withPurchase: false,
      moduleRetryCount: 1,
    });
    await seedScanModule(db.prisma, {
      scanId: scan.id,
      module: 'SEO',
      runtimeStatus: 'Unavailable',
      usableOutput: false,
    });

    const outcome = await resolveScanOutcome(db.prisma, scan.id);
    expect(outcome.kind).toBe('Failed');
    if (outcome.kind === 'Failed') {
      expect(outcome.refund).toBeNull();
    }
    expect(await db.prisma.refundRecord.count()).toBe(refundsBefore);
  });

  it('caps the platform retry at one (platform_retry_count <= 1)', async () => {
    const { scan } = await seedScan(db.prisma, { account, status: 'Failed' });

    await transitionScan(db.prisma, scan.id, 'Failed', 'Queued');
    await transitionScan(db.prisma, scan.id, 'Queued', 'Running');
    await transitionScan(db.prisma, scan.id, 'Running', 'Failed');

    // The single platform retry is spent; the CAS counter guard rejects a second.
    await expect(transitionScan(db.prisma, scan.id, 'Failed', 'Queued')).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
    const settled = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(settled.platformRetryCount).toBe(1);
    expect(settled.status).toBe('Failed');
  });

  it('caps the module retry via Partial -> Running at one', async () => {
    const { scan } = await seedScan(db.prisma, { account, status: 'Partial' });

    await transitionScan(db.prisma, scan.id, 'Partial', 'Running');
    await transitionScan(db.prisma, scan.id, 'Running', 'Partial');

    await expect(transitionScan(db.prisma, scan.id, 'Partial', 'Running')).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
    const settled = await db.prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(settled.moduleRetryCount).toBe(1);
  });
});
