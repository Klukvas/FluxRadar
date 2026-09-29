import type { PrismaClient } from '@prisma/client';

import type { ApiLogger } from '../../http/logger.ts';
import {
  reconcileProviderPendingRefunds,
  sweepProviderPendingRefunds,
  type PendingRefundReconciliation,
  type PendingRefundSweepOptions,
  type PendingRefundSweepProvider,
} from '../pending-refund-sweep.ts';
import { CREEM_PROVIDER } from './config.ts';
import { applyPendingCreemRefundEvents } from './pending-refunds.ts';

// The Creem half of the safety net under the pending-refund replay. What the
// sweep is and what its counts mean is stated once, in
// billing/pending-refund-sweep.ts; this module only says which rows are Creem's
// and how one of them is replayed — through the same code the checkout.completed
// grant path runs.

const CREEM_SWEEP: PendingRefundSweepProvider = {
  provider: CREEM_PROVIDER,
  applyPending: applyPendingCreemRefundEvents,
};

export function reconcileCreemPendingRefunds(
  prisma: PrismaClient,
  now: Date,
  options: PendingRefundSweepOptions = {},
): Promise<PendingRefundReconciliation> {
  return reconcileProviderPendingRefunds(prisma, now, CREEM_SWEEP, options);
}

/** Runs the Creem sweep and reports what it did; never rejects. */
export function sweepCreemPendingRefunds(
  prisma: PrismaClient,
  now: Date,
  logger: ApiLogger,
): Promise<void> {
  return sweepProviderPendingRefunds(prisma, now, logger, CREEM_SWEEP);
}
