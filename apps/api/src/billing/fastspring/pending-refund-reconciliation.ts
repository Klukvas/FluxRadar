import type { PrismaClient } from '@prisma/client';

import type { ApiLogger } from '../../http/logger.ts';
import { FASTSPRING_PROVIDER } from './config.ts';
import { WEBHOOK_OUTCOMES } from './outcomes.ts';
import { applyPendingRefundEvents } from './pending-refunds.ts';

// The safety net under the pending-refund replay.
//
// `pending-refunds.ts` replays a stored return or chargeback inside the
// order.completed transaction that makes it applicable, which covers the case it
// was written for: the refund was already stored when the order arrived. It
// cannot cover a refund that becomes stored *while* the order is being granted.
// Both transactions read a database that does not yet contain the other's work —
// the return finds no purchase to lock and stays `unlinked`, the grant finds no
// pending row to replay — and once both commit the purchase is `paid`, the
// entitlement is live, and the buyer's money is on its way back. Nothing in the
// delivery path will ever look at that row again.
//
// This sweep is what looks at it. It takes the pending rows whose order now has a
// purchase and replays them through exactly the same code the grant path uses, so
// there is one implementation of "what a stored refund does" and the sweep cannot
// drift from it. Replaying is safe to repeat: a return is counted once per
// purchase by its own refund line (`ProviderRefund`), the purchase and the
// entitlement only ever move forward, and a row that was already applied is no
// longer `unlinked` and is not picked up again.
//
// It is also the only thing that reaches rows written before the replay existed
// at all, and rows a transient failure left behind.
//
// THE BATCH IS TAKEN AFTER THE MATCH, NOT BEFORE IT. A refund whose order never
// arrives — a foreign order, an order rejected on its amount — stays `unlinked`
// for the whole 30-day retention window, and those rows are the OLDEST pending
// rows there are. Taking the oldest N pending rows and only then asking which of
// them have a purchase is therefore a head-of-line block: N such orphans fill
// every pass, and the refund that could be applied waits behind them until they
// age out. So the match is part of the query — `EXISTS (SELECT … FROM Purchase)`
// evaluated before `LIMIT` — and the bound now counts rows the sweep can actually
// act on. An orphan costs one index probe on Purchase's unique key and is skipped.

/**
 * How many *applicable* pending rows one pass takes.
 *
 * The sweep is bounded for the same reason the retention purge is: a backlog must
 * cost the next pass, not one unbounded query. What it leaves behind is taken by
 * the following pass, and `batchLimitReached` says when that happened. Pending
 * rows whose order has no purchase do not count against it (see above).
 */
export const PENDING_REFUND_SWEEP_BATCH_LIMIT = 500;

/** How often the sweep runs; the upper bound on how long a stranded refund lives. */
export const PENDING_REFUND_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** Matches the webhook handler: a replay must not sit on a connection longer. */
const TX_OPTIONS = { maxWait: 10_000, timeout: 10_000 } as const;

export interface PendingRefundSweepOptions {
  /** Applicable pending rows taken by this pass; the rest wait for the next one. */
  readonly batchLimit?: number;
}

export interface PendingRefundReconciliation {
  /**
   * Every pending refund/chargeback row there is, applicable or not — the
   * backlog. A number that stays high while `matchedOrderCount` is 0 is a pile of
   * refunds for orders that never arrived, not a sweep falling behind.
   */
  readonly pendingRowCount: number;
  /** Distinct orders this pass replayed against: their purchase exists. */
  readonly matchedOrderCount: number;
  readonly appliedEventCount: number;
  /** Orders whose replay failed; they stay pending for the next pass. */
  readonly failedOrderCount: number;
  /** The pass filled its batch, so applicable rows may still be waiting. */
  readonly batchLimitReached: boolean;
}

export async function reconcilePendingRefunds(
  prisma: PrismaClient,
  now: Date,
  options: PendingRefundSweepOptions = {},
): Promise<PendingRefundReconciliation> {
  const batchLimit = Math.max(
    1,
    Math.trunc(options.batchLimit ?? PENDING_REFUND_SWEEP_BATCH_LIMIT),
  );
  const pendingRowCount = await prisma.webhookEvent.count({
    where: {
      provider: FASTSPRING_PROVIDER,
      outcome: WEBHOOK_OUTCOMES.unlinked,
      providerTransactionId: { not: null },
    },
  });
  const batch = await matchedPendingRows(prisma, batchLimit);
  const matched = [...new Set(batch)];

  let appliedEventCount = 0;
  let failedOrderCount = 0;
  for (const orderId of matched) {
    try {
      const replay = await prisma.$transaction(
        (tx) =>
          applyPendingRefundEvents(tx, orderId, now, {
            appliedWhen: `applied by the pending-refund sweep; order ${orderId} was already granted`,
          }),
        TX_OPTIONS,
      );
      appliedEventCount += replay.appliedEventTypes.length;
    } catch {
      // One order that cannot be replayed — a lock timeout, a purchase deleted
      // mid-pass — must not stop the rest of the batch. The row stays `unlinked`,
      // so the next pass tries it again; the counts say it happened.
      failedOrderCount += 1;
    }
  }
  return {
    pendingRowCount,
    matchedOrderCount: matched.length,
    appliedEventCount,
    failedOrderCount,
    batchLimitReached: batch.length >= batchLimit,
  };
}

/**
 * The oldest pending rows that can actually be applied: outcome `unlinked` and a
 * FastSpring purchase already exists for the order they name.
 *
 * Raw SQL because the two tables are not related in the Prisma schema — a webhook
 * event names an order id, not a purchase — so the match cannot be expressed as a
 * relation filter, and doing it in JavaScript is exactly the head-of-line block
 * described above. The scan is served by the
 * `(provider, outcome, processedAt)` index, so it walks the pending rows in
 * delivery order and stops at the first `batchLimit` applicable ones rather than
 * reading the whole table.
 *
 * The provider is part of the match: order ids are unique per provider, and a
 * legacy transaction id that happens to equal a FastSpring order id names an
 * entirely different purchase (same reasoning as the retention purge).
 *
 * The ids are only a work list. Every replay re-reads and locks the purchase
 * inside its own transaction, so a purchase that disappears between this query
 * and the replay costs one failed order, not a wrong write.
 */
async function matchedPendingRows(prisma: PrismaClient, batchLimit: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ orderId: string }[]>`
    SELECT pending."providerTransactionId" AS "orderId"
    FROM "WebhookEvent" AS pending
    WHERE pending."provider" = ${FASTSPRING_PROVIDER}
      AND pending."outcome" = ${WEBHOOK_OUTCOMES.unlinked}
      AND pending."providerTransactionId" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM "Purchase" AS granted
        WHERE granted."provider" = ${FASTSPRING_PROVIDER}
          AND granted."providerTransactionId" = pending."providerTransactionId"
      )
    ORDER BY pending."processedAt" ASC
    LIMIT ${batchLimit}`;
  return rows.map(({ orderId }) => orderId);
}

/**
 * Runs the sweep and reports what it did.
 *
 * It never rejects: this is background reconciliation and the next pass retries,
 * so a failure here must not take down the boot path or the timer calling it. A
 * pass that applied something is logged at info — a refund that reached a
 * purchase this way means the delivery path missed it, which an operator has to
 * be able to see — and a quiet pass says so too, so "the sweep never ran" and
 * "the sweep found nothing" do not look the same afterwards.
 */
export async function sweepPendingRefunds(
  prisma: PrismaClient,
  now: Date,
  logger: ApiLogger,
): Promise<void> {
  try {
    const result = await reconcilePendingRefunds(prisma, now);
    logger.info('pending refund sweep completed', { ...result });
  } catch (error) {
    logger.error('pending refund sweep failed', {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}
