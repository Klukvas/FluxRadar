import type { Prisma, PrismaClient } from '@prisma/client';

import type { ApiLogger } from '../http/logger.ts';
import { WEBHOOK_OUTCOMES } from './fastspring/outcomes.ts';

// The safety net under every provider's pending-refund replay.
//
// A provider module replays a stored refund or chargeback inside the transaction
// that grants the order it belongs to, which covers the case it was written for:
// the refund was already stored when the order arrived. It cannot cover a refund
// that becomes stored *while* the order is being granted. Both transactions read
// a database that does not yet contain the other's work — the refund finds no
// purchase to lock and stays `unlinked`, the grant finds no pending row to
// replay — and once both commit the purchase is `paid`, the entitlement is live,
// and the buyer's money is on its way back. Nothing in the delivery path will
// ever look at that row again.
//
// This sweep is what looks at it. It takes the pending rows whose order now has a
// purchase and replays them through exactly the same code the grant path uses, so
// there is one implementation per provider of "what a stored refund does" and
// the sweep cannot drift from it. Replaying is safe to repeat: a refund is
// counted once per purchase by its own refund line (`ProviderRefund`), the
// purchase and the entitlement only ever move forward, and a row that was already
// applied is no longer `unlinked` and is not picked up again.
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
//
// Each provider wraps this with its own name and its own replay
// (fastspring/pending-refund-reconciliation.ts, creem/pending-refund-reconciliation.ts).

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

/** Matches the webhook handlers: a replay must not sit on a connection longer. */
const TX_OPTIONS = { maxWait: 10_000, timeout: 10_000 } as const;

/** What replaying the stored events did, as every provider's replay reports it. */
export interface PendingRefundReplayResult {
  readonly appliedEventTypes: readonly string[];
}

export interface PendingRefundReplayOptions {
  /**
   * How the row leaving the pending state describes what made it applicable.
   * The grant is only one of the moments that can: an event stored while the
   * order was being granted commits too late for that transaction to see it, and
   * the reconciliation sweep is what picks it up afterwards.
   */
  readonly appliedWhen?: string;
}

/** The one provider-specific piece: which rows, and how a stored one is applied. */
export interface PendingRefundSweepProvider {
  /** The provider name on WebhookEvent and Purchase rows, e.g. `fastspring`. */
  readonly provider: string;
  readonly applyPending: (
    tx: Prisma.TransactionClient,
    orderId: string,
    now: Date,
    options: PendingRefundReplayOptions,
  ) => Promise<PendingRefundReplayResult>;
}

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

export async function reconcileProviderPendingRefunds(
  prisma: PrismaClient,
  now: Date,
  sweep: PendingRefundSweepProvider,
  options: PendingRefundSweepOptions = {},
): Promise<PendingRefundReconciliation> {
  const batchLimit = Math.max(
    1,
    Math.trunc(options.batchLimit ?? PENDING_REFUND_SWEEP_BATCH_LIMIT),
  );
  const pendingRowCount = await prisma.webhookEvent.count({
    where: {
      provider: sweep.provider,
      outcome: WEBHOOK_OUTCOMES.unlinked,
      providerTransactionId: { not: null },
    },
  });
  const batch = await matchedPendingRows(prisma, sweep.provider, batchLimit);
  const matched = [...new Set(batch)];

  let appliedEventCount = 0;
  let failedOrderCount = 0;
  for (const orderId of matched) {
    try {
      const replay = await prisma.$transaction(
        (tx) =>
          sweep.applyPending(tx, orderId, now, {
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
 * purchase of the same provider already exists for the order they name.
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
 * legacy transaction id that happens to equal another provider's order id names
 * an entirely different purchase (same reasoning as the retention purge).
 *
 * The ids are only a work list. Every replay re-reads and locks the purchase
 * inside its own transaction, so a purchase that disappears between this query
 * and the replay costs one failed order, not a wrong write.
 */
async function matchedPendingRows(
  prisma: PrismaClient,
  provider: string,
  batchLimit: number,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ orderId: string }[]>`
    SELECT pending."providerTransactionId" AS "orderId"
    FROM "WebhookEvent" AS pending
    WHERE pending."provider" = ${provider}
      AND pending."outcome" = ${WEBHOOK_OUTCOMES.unlinked}
      AND pending."providerTransactionId" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM "Purchase" AS granted
        WHERE granted."provider" = ${provider}
          AND granted."providerTransactionId" = pending."providerTransactionId"
      )
    ORDER BY pending."processedAt" ASC
    LIMIT ${batchLimit}`;
  return rows.map(({ orderId }) => orderId);
}

/**
 * Runs one provider's sweep and reports what it did.
 *
 * It never rejects: this is background reconciliation and the next pass retries,
 * so a failure here must not take down the boot path or the timer calling it. A
 * pass that applied something is logged at info — a refund that reached a
 * purchase this way means the delivery path missed it, which an operator has to
 * be able to see — and a quiet pass says so too, so "the sweep never ran" and
 * "the sweep found nothing" do not look the same afterwards.
 */
export async function sweepProviderPendingRefunds(
  prisma: PrismaClient,
  now: Date,
  logger: ApiLogger,
  sweep: PendingRefundSweepProvider,
): Promise<void> {
  try {
    const result = await reconcileProviderPendingRefunds(prisma, now, sweep);
    logger.info('pending refund sweep completed', { provider: sweep.provider, ...result });
  } catch (error) {
    logger.error('pending refund sweep failed', {
      provider: sweep.provider,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}
