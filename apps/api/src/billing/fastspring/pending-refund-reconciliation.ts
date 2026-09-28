import type { PrismaClient } from '@prisma/client';

import type { ApiLogger } from '../../http/logger.ts';
import {
  PENDING_REFUND_SWEEP_BATCH_LIMIT,
  PENDING_REFUND_SWEEP_INTERVAL_MS,
  reconcileProviderPendingRefunds,
  sweepProviderPendingRefunds,
  type PendingRefundReconciliation,
  type PendingRefundSweepOptions,
  type PendingRefundSweepProvider,
} from '../pending-refund-sweep.ts';
import { FASTSPRING_PROVIDER } from './config.ts';
import { applyPendingRefundEvents } from './pending-refunds.ts';

// The FastSpring half of the safety net under the pending-refund replay.
//
// What the sweep is, why the batch is taken after the match, and what its counts
// mean is stated once, in billing/pending-refund-sweep.ts. This module only says
// which rows are FastSpring's and how one of them is replayed: through
// `applyPendingRefundEvents`, the same code the order.completed grant path runs,
// so there is one implementation of "what a stored return does".

export {
  PENDING_REFUND_SWEEP_BATCH_LIMIT,
  PENDING_REFUND_SWEEP_INTERVAL_MS,
  type PendingRefundReconciliation,
  type PendingRefundSweepOptions,
};

const FASTSPRING_SWEEP: PendingRefundSweepProvider = {
  provider: FASTSPRING_PROVIDER,
  applyPending: applyPendingRefundEvents,
};

export function reconcilePendingRefunds(
  prisma: PrismaClient,
  now: Date,
  options: PendingRefundSweepOptions = {},
): Promise<PendingRefundReconciliation> {
  return reconcileProviderPendingRefunds(prisma, now, FASTSPRING_SWEEP, options);
}

/** Runs the FastSpring sweep and reports what it did; never rejects. */
export function sweepPendingRefunds(
  prisma: PrismaClient,
  now: Date,
  logger: ApiLogger,
): Promise<void> {
  return sweepProviderPendingRefunds(prisma, now, logger, FASTSPRING_SWEEP);
}
