import type { PrismaClient, RefundRecord } from '@prisma/client';

import { STATUS_REASONS } from './constants.ts';
import { BillingNotFoundError, InvalidTransitionError } from './errors.ts';
import { requestRefund } from './refund.ts';
import { transitionScan } from './state-machine.ts';

export interface CancelScanResult {
  readonly cancelledFrom: 'Pending' | 'Queued' | 'Running';
  /** Present only for the pre-queue branch: 100% refund per §18. */
  readonly refund: RefundRecord | null;
}

/**
 * User-initiated cancellation. The refund branch follows §18 exactly:
 * - before queueing (Pending)  -> Cancelled + automatic PRE_QUEUE_CANCEL refund;
 * - after queueing or mid-run  -> Cancelled, the run counts as used, no refund.
 *
 * Each branch is an atomic CAS, so a concurrent worker claim and a user cancel
 * cannot both win the same state.
 */
export async function cancelScan(prisma: PrismaClient, scanId: string): Promise<CancelScanResult> {
  if (await tryCancel(prisma, scanId, 'Pending', STATUS_REASONS.preQueueCancel)) {
    const scan = await prisma.scan.findUnique({ where: { id: scanId } });
    if (!scan) {
      throw new BillingNotFoundError(`scan ${scanId} disappeared after cancellation`);
    }
    const refund =
      scan.purchaseId === null
        ? null
        : (await requestRefund(prisma, scan.purchaseId, 'PRE_QUEUE_CANCEL')).record;
    return { cancelledFrom: 'Pending', refund };
  }
  if (await tryCancel(prisma, scanId, 'Queued', STATUS_REASONS.postQueueCancel)) {
    return { cancelledFrom: 'Queued', refund: null };
  }
  if (await tryCancel(prisma, scanId, 'Running', STATUS_REASONS.midRunCancel)) {
    return { cancelledFrom: 'Running', refund: null };
  }
  throw new InvalidTransitionError(`scan ${scanId} cannot be cancelled from its current state`);
}

async function tryCancel(
  prisma: PrismaClient,
  scanId: string,
  from: 'Pending' | 'Queued' | 'Running',
  statusReason: string,
): Promise<boolean> {
  try {
    await transitionScan(prisma, scanId, from, 'Cancelled', { statusReason });
    return true;
  } catch (error) {
    if (error instanceof InvalidTransitionError) {
      return false;
    }
    throw error;
  }
}
