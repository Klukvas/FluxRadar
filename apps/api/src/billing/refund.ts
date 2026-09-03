import type { RefundReasonCode } from '@fluxradar/contracts';
import type { PrismaClient, RefundRecord, Scan } from '@prisma/client';

import { REFUND_STATUSES, STATUS_REASONS, refundIdempotencyKey } from './constants.ts';
import { BillingNotFoundError, RefundPolicyError } from './errors.ts';
import { isUniqueViolation } from './prisma-errors.ts';

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
    return { record: purchase.refund, deduplicated: true };
  }

  assertRefundAllowed(reasonCode, purchase.scan);

  try {
    const record = await prisma.refundRecord.create({
      data: {
        purchaseId,
        idempotencyKey: refundIdempotencyKey(purchaseId),
        reasonCode,
        status: REFUND_STATUSES.requested,
        amountUsd: purchase.amountUsd,
      },
    });
    return { record, deduplicated: false };
  } catch (error) {
    // Concurrent duplicate: the unique constraint won; return the stored record.
    if (isUniqueViolation(error, 'purchaseId') || isUniqueViolation(error, 'idempotencyKey')) {
      const record = await prisma.refundRecord.findUnique({ where: { purchaseId } });
      if (record) {
        return { record, deduplicated: true };
      }
    }
    throw error;
  }
}

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
      if (scan?.status !== 'Failed' || scan.statusReason !== STATUS_REASONS.noUsableOutput) {
        throw new RefundPolicyError(
          'EXTERNAL_NO_USABLE_OUTPUT refund requires a Failed scan with reason NoUsableOutput',
        );
      }
      return;
    case 'LEGAL_SUPPORT':
      // Legal requirements and support decisions override the automatic policy (§18).
      return;
  }
}
