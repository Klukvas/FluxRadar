import type { PrismaClient, RefundRecord } from '@prisma/client';

import { pausedFromReason } from '../orchestrator/pause.ts';
import { STATUS_REASONS } from './constants.ts';
import { BillingNotFoundError, InvalidTransitionError } from './errors.ts';
import { requestRefund } from './refund.ts';
import { transitionScan } from './state-machine.ts';

export interface CancelScanResult {
  readonly cancelledFrom: 'Pending' | 'Queued' | 'Running' | 'Paused';
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
  const paused = await cancelPaused(prisma, scanId);
  if (paused !== null) {
    return paused;
  }
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

/**
 * Cancels a paused scan, refunding exactly as the state it was paused from
 * would have.
 *
 * Pausing does not consume the run, so a scan paused before it was ever queued
 * is still a pre-queue cancellation and still refunds in full (§18). The state
 * it was paused from is recorded in `statusReason` by the pause itself, because
 * once the status reads `Paused` nothing else can tell the two apart. Returns
 * null when the scan is not paused, so the ordinary branches below decide.
 */
async function cancelPaused(
  prisma: PrismaClient,
  scanId: string,
): Promise<CancelScanResult | null> {
  const scan = await prisma.scan.findUnique({ where: { id: scanId } });
  if (scan === null || scan.status !== 'Paused') {
    return null;
  }
  const pausedFrom = pausedFromReason(scan.statusReason);
  const reason =
    pausedFrom === 'Pending' ? STATUS_REASONS.preQueueCancel : STATUS_REASONS.postQueueCancel;
  if (!(await tryCancel(prisma, scanId, 'Paused', reason))) {
    // Resumed between the read and the compare-and-set: let the live branches
    // below take it, so the two paths cannot both act.
    return null;
  }
  const refund =
    pausedFrom !== 'Pending' || scan.purchaseId === null
      ? null
      : (await requestRefund(prisma, scan.purchaseId, 'PRE_QUEUE_CANCEL')).record;
  return { cancelledFrom: 'Paused', refund };
}

async function tryCancel(
  prisma: PrismaClient,
  scanId: string,
  from: 'Pending' | 'Queued' | 'Running' | 'Paused',
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
