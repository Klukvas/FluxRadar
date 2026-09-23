import type { RefundReasonCode } from '@fluxradar/contracts';
import type { Prisma, PrismaClient, RefundRecord, Scan } from '@prisma/client';

import {
  NO_USABLE_OUTPUT_STATUS_REASONS,
  REFUND_STATUSES,
  STATUS_REASONS,
  refundIdempotencyKey,
} from './constants.ts';
import { BillingNotFoundError, RefundPolicyError } from './errors.ts';
import { isUniqueViolation } from './prisma-errors.ts';
import { readRefundDispatchConfig } from './refunds/config.ts';
import { recordRefundDispatch } from './refunds/outbox.ts';
import { REFUND_DISPATCH_STATES } from './refunds/states.ts';

export interface RefundResult {
  readonly record: RefundRecord;
  /** True when an existing record was returned instead of creating a new one. */
  readonly deduplicated: boolean;
}

/**
 * Refund flow (§18 idempotency contract): the stable logical key is
 * `refund:{purchase_id}`; unique constraints on both purchaseId and the key
 * make a second refund impossible regardless of reason code. A repeated call
 * returns the stored record unchanged.
 */
export async function requestRefund(
  prisma: PrismaClient,
  purchaseId: string,
  reasonCode: RefundReasonCode,
): Promise<RefundResult> {
  const purchase = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    include: { scan: true, refund: true },
  });
  if (!purchase) {
    throw new BillingNotFoundError(`purchase ${purchaseId} not found`);
  }
  if (purchase.refund) {
    // The decision already exists. Its outbound row may not — a record written
    // before the outbox existed, or by a release that had none — so the orphan
    // is adopted here too. `recordRefundDispatch` never changes an existing row.
    await adoptOrphanedRefund(prisma, purchase.refund);
    return { record: purchase.refund, deduplicated: true };
  }

  assertRefundAllowed(reasonCode, purchase.scan);

  try {
    // ONE TRANSACTION, BECAUSE THE TWO ROWS ARE ONE DECISION. A crash between
    // them used to leave a refund nobody would ever send: `dispatchPendingRefunds`
    // reads the dispatch table, so a decision with no dispatch row is invisible
    // to the queue, to the "needs an operator" alert, and to every person.
    const record = await prisma.$transaction(async (tx) => {
      const created = await tx.refundRecord.create({
        data: {
          purchaseId,
          idempotencyKey: refundIdempotencyKey(purchaseId),
          reasonCode,
          status: REFUND_STATUSES.requested,
          amountUsd: purchase.amountUsd,
          currency: purchase.currency,
          provider: purchase.provider,
          providerTransactionId: purchase.providerTransactionId,
          priceId: purchase.priceId,
          refundRequestId: `refund-request:${purchaseId}`,
          refundReasonCode: reasonCode,
        },
      });
      await recordOutboundRefund(tx, created);
      return created;
    });
    return { record, deduplicated: false };
  } catch (error) {
    // Concurrent duplicate: the unique constraint won; return the stored record.
    if (isUniqueViolation(error, 'purchaseId') || isUniqueViolation(error, 'idempotencyKey')) {
      const record = await prisma.refundRecord.findUnique({ where: { purchaseId } });
      if (record) {
        await adoptOrphanedRefund(prisma, record);
        return { record, deduplicated: true };
      }
    }
    throw error;
  }
}

/**
 * Records the outbound half of the refund: one row per purchase saying whether
 * anything is to be sent, and where it got to.
 *
 * It does NOT send. Where it leaves the row is decided by the deployment's
 * configuration, and every configuration this repository ships with leaves it
 * `manual` — the policy in force today, where a refund is issued from the
 * provider's own console. A deployment that switched the
 * dispatcher on gets `requested`, which is the only state the sweep picks up.
 */
async function recordOutboundRefund(
  db: PrismaClient | Prisma.TransactionClient,
  record: RefundRecord,
): Promise<void> {
  const config = readRefundDispatchConfig();
  const active = config.state === 'active';
  await recordRefundDispatch(db, {
    record,
    initialState: active ? REFUND_DISPATCH_STATES.requested : REFUND_DISPATCH_STATES.manual,
    stateReason: active
      ? 'waiting for the refund dispatcher'
      : 'outbound refunds are not switched on in this deployment; issue it in the provider console',
    now: new Date(),
  });
}

/**
 * Gives a refund decision that has no dispatch row one — as a person's job.
 *
 * Deliberately `manual` even where the dispatcher is switched on. A record
 * without a dispatch row is by definition historical now that the pair is
 * written in one transaction: it was decided by a release that had no outbox, or
 * issued from the provider's console. Queueing it as `requested` would hand a
 * years-old decision to the sweep, and the sweep sends money. `manual` puts it
 * in front of an operator with its own reason instead, which is the only safe
 * direction for a write that cannot be taken back.
 */
export async function adoptOrphanedRefund(
  prisma: PrismaClient,
  record: RefundRecord,
): Promise<void> {
  await recordRefundDispatch(prisma, {
    record,
    initialState: REFUND_DISPATCH_STATES.manual,
    stateReason:
      'recovered: this refund decision had no submission row. Check the provider console for a ' +
      'return against this order before queueing it',
    now: new Date(),
  });
}

/**
 * Gives every refund decision that still has no dispatch row one, newest first.
 *
 * The sweep reads `RefundDispatch`, so before this existed an orphaned decision
 * was invisible to it forever. Bounded per pass, because this is a repair path
 * and not a queue: whatever it does not reach this time it reaches next time.
 */
export async function adoptOrphanedRefunds(
  prisma: PrismaClient,
  limit = ORPHAN_SWEEP_LIMIT,
): Promise<number> {
  const orphans = await prisma.refundRecord.findMany({
    where: { dispatch: null },
    orderBy: { requestedAt: 'desc' },
    take: limit,
  });
  for (const record of orphans) await adoptOrphanedRefund(prisma, record);
  return orphans.length;
}

/** Decisions adopted per sweep. A repair path, not a queue. */
export const ORPHAN_SWEEP_LIMIT = 50;

/**
 * Reason codes are a closed enum and each has an objective precondition (§18):
 * no branch may count as both platform failure and external failure.
 */
function assertRefundAllowed(reasonCode: RefundReasonCode, scan: Scan | null): void {
  switch (reasonCode) {
    case 'PRE_QUEUE_CANCEL':
      // Only the Pending -> Cancelled CAS writes this reason, so its presence
      // proves the scan never reached the queue.
      if (scan?.status !== 'Cancelled' || scan.statusReason !== STATUS_REASONS.preQueueCancel) {
        throw new RefundPolicyError(
          'PRE_QUEUE_CANCEL refund requires a scan cancelled before queueing',
        );
      }
      return;
    case 'PLATFORM_FAILURE_AFTER_RETRY':
      if (scan?.status !== 'Failed' || scan.platformRetryCount < 1) {
        throw new RefundPolicyError(
          'PLATFORM_FAILURE_AFTER_RETRY refund requires a Failed scan after the platform retry',
        );
      }
      return;
    case 'EXTERNAL_NO_USABLE_OUTPUT':
      // Any reason in the zero-usable-output branch, not the one literal: a
      // scan Failed because the site refused the crawl is the same purchase
      // failure, and refusing its refund over the wording would be the worst
      // possible reading of this guard.
      if (
        scan?.status !== 'Failed' ||
        scan.statusReason === null ||
        !NO_USABLE_OUTPUT_STATUS_REASONS.has(scan.statusReason)
      ) {
        throw new RefundPolicyError(
          'EXTERNAL_NO_USABLE_OUTPUT refund requires a Failed scan with a no-usable-output reason',
        );
      }
      return;
    case 'LEGAL_SUPPORT':
      // Legal requirements and support decisions override the automatic policy (§18).
      return;
  }
}
