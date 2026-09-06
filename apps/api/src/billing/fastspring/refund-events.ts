import type { Prisma } from '@prisma/client';

import { PURCHASE_STATUSES, REFUND_STATUSES, refundIdempotencyKey } from '../constants.ts';
import { FASTSPRING_PROVIDER } from './config.ts';
import {
  FASTSPRING_EVENT_TYPES,
  type ChargebackCreatedEvent,
  type ReturnCreatedEvent,
} from './events.ts';
import { NOTHING, WEBHOOK_OUTCOMES, type DispatchResult } from './outcomes.ts';
import {
  chargeBasisOf,
  cumulativeRefund,
  resolveReturnLine,
  type ChargeBasis,
  type CumulativeRefund,
} from './refund-amounts.ts';

// What a FastSpring return or chargeback does to a purchase we already granted.
//
// Both are monotonic: they only ever move a purchase forward (paid -> Refunded /
// Disputed) so a redelivery or an out-of-order event cannot restore access. A
// full refund also suspends the entitlement — a buyer whose money was returned
// must not keep the report the money paid for.
//
// DISPUTED IS TERMINAL, AND SO IS REFUNDED. The two end states are not ranked by
// arrival order: whichever is written first stays. A chargeback is a bank-forced
// reversal — it carries a fee, it counts against the merchant account, and it is
// the thing an operator has to be able to find afterwards — so a return that
// FastSpring reports for the same order once the dispute is under way (a seller
// refunding to settle it is the ordinary case) must not quietly relabel the
// purchase `Refunded` and erase that. Both writes are therefore compare-and-set
// on the state they are allowed to leave, `paid`, rather than "anything that is
// not the other one".
//
// Nothing about the money is dropped by that: the return still writes its
// `ProviderRefund` line, still updates the `RefundRecord` aggregate, still
// suspends the entitlement, and the delivery is still stored with its own
// `WebhookEvent` row and outcome. Only `Purchase.status` — one label, and the one
// an operator reads first — keeps naming the stronger fact, and the outcome
// reason says so in as many words.
//
// REFUNDS ACCUMULATE. FastSpring can return a charge in instalments, and each
// `return.created` states only its own amount. The decision is therefore taken on
// everything returned so far, not on the event in hand: every return is stored as
// its own ProviderRefund line, keyed on the FastSpring return id, and the lines
// are summed on the purchase's charged basis (see refund-amounts.ts). Two $27.50
// returns against a $55 order suspend the entitlement; the same return
// redelivered under a new webhook event id does not, because the line already
// exists and the insert does nothing.
//
// A return that carries no return id of its own is keyed on the delivery instead.
// That is the one case a redelivery can double-count — which errs towards
// suspending, and says so in the line's stored reason.

function findPurchase(tx: Prisma.TransactionClient, orderId: string) {
  return tx.purchase.findUnique({
    where: {
      provider_providerTransactionId: {
        provider: FASTSPRING_PROVIDER,
        providerTransactionId: orderId,
      },
    },
    include: { entitlement: true, scan: true, refund: true },
  });
}

/**
 * The same purchase, with its row locked for the rest of the transaction.
 *
 * Two returns for one order delivered at the same time would otherwise each read
 * the sum before the other's line was committed, both conclude "partial", and
 * leave a fully refunded report readable — the exact failure this handler exists
 * to prevent. The lock makes the read-sum-decide sequence below serial per
 * purchase. A row that does not exist yet cannot be locked, which is the
 * `unlinked` path: the pending replay applies the event when the order lands.
 */
async function lockPurchase(tx: Prisma.TransactionClient, orderId: string) {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Purchase"
    WHERE "provider" = ${FASTSPRING_PROVIDER} AND "providerTransactionId" = ${orderId}
    FOR UPDATE`;
  return locked.length === 0 ? null : findPurchase(tx, orderId);
}

function unlinked(orderId: string): DispatchResult {
  // Out-of-order event: the order.completed may still arrive. Store, do nothing.
  return {
    ...NOTHING,
    outcome: WEBHOOK_OUTCOMES.unlinked,
    orderId,
    reason: 'no purchase for this order yet',
  };
}

/**
 * Applies one `return.created`.
 *
 * `deliveryEventId` is the id of the webhook delivery carrying the event; it is
 * the fallback dedup key for a payload that states no return id of its own.
 */
export async function processReturn(
  tx: Prisma.TransactionClient,
  event: ReturnCreatedEvent,
  now: Date,
  deliveryEventId: string,
): Promise<DispatchResult> {
  if (event.originalOrderId === null) {
    return { ...NOTHING, reason: 'return.created payload has no original order id' };
  }
  const purchase = await lockPurchase(tx, event.originalOrderId);
  if (purchase === null) {
    return unlinked(event.originalOrderId);
  }

  const basis = chargeBasisOf(purchase);
  const line = resolveReturnLine(event, basis);
  const refundId = event.returnId ?? deliveryEventId;
  // INSERT ... ON CONFLICT DO NOTHING: the line is what makes the sum idempotent,
  // so a return already counted must neither be inserted again nor overwrite the
  // figures the first delivery recorded.
  const inserted = await tx.providerRefund.createMany({
    data: {
      purchaseId: purchase.id,
      provider: FASTSPRING_PROVIDER,
      providerRefundId: refundId,
      eventType: FASTSPRING_EVENT_TYPES.returnCreated,
      amountCharged: line.amountCharged,
      amountUsd: line.amountUsd,
      currency: line.currency,
      reason: lineReason(line.reason, event.returnId === null ? deliveryEventId : null),
    },
    skipDuplicates: true,
  });
  const alreadyCounted = inserted.count === 0;

  const totals = await tx.providerRefund.aggregate({
    where: { purchaseId: purchase.id },
    _sum: { amountCharged: true, amountUsd: true },
  });
  const refunded = cumulativeRefund(totals._sum, basis);

  if (refunded.isFull) {
    // Compare-and-set from `paid` only: a purchase already `Disputed` keeps that
    // status (the chargeback is the stronger fact and must stay findable), and a
    // concurrent chargeback that commits between the lock above and this write
    // therefore wins the label without either transaction losing its record.
    await tx.purchase.updateMany({
      where: { id: purchase.id, status: PURCHASE_STATUSES.paid },
      data: { status: PURCHASE_STATUSES.refunded },
    });
    if (purchase.entitlement !== null) {
      await tx.entitlement.update({
        where: { id: purchase.entitlement.id },
        data: { suspended: true },
      });
    }
  }

  const refundFields = {
    status: REFUND_STATUSES.paid,
    // The aggregate states everything returned so far, not the last instalment.
    amountUsd: refunded.amountUsd,
    // amountUsd is USD-normalised, so the record names USD rather than the
    // buyer's currency; the charged figure stays on the purchase.
    currency: 'USD',
    provider: FASTSPRING_PROVIDER,
    providerTransactionId: event.originalOrderId,
    providerEventId: refundId,
    priceId: purchase.priceId,
    refundRequestId: refundId,
    // FastSpring's free-text reason is not our closed reason enum (§18); a
    // seller-initiated return is recorded as a support decision.
    refundReasonCode: 'LEGAL_SUPPORT',
    processedAt: now,
  };
  if (purchase.refund === null) {
    await tx.refundRecord.create({
      data: {
        purchaseId: purchase.id,
        idempotencyKey: refundIdempotencyKey(purchase.id),
        reasonCode: 'LEGAL_SUPPORT',
        requestedAt: now,
        ...refundFields,
      },
    });
  } else {
    await tx.refundRecord.update({ where: { id: purchase.refund.id }, data: refundFields });
  }

  return {
    outcome: alreadyCounted ? WEBHOOK_OUTCOMES.deduplicated : WEBHOOK_OUTCOMES.processed,
    reason: returnReason(refunded, basis, alreadyCounted ? refundId : null, purchase.status),
    accountId: purchase.accountId,
    orderId: event.originalOrderId,
    purchaseId: purchase.id,
    entitlementId: purchase.entitlement?.id ?? null,
    scanId: purchase.scan?.id ?? null,
  };
}

export async function processChargeback(
  tx: Prisma.TransactionClient,
  event: ChargebackCreatedEvent,
): Promise<DispatchResult> {
  if (event.orderId === null) {
    return { ...NOTHING, reason: 'chargeback.created payload has no order id' };
  }
  const purchase = await findPurchase(tx, event.orderId);
  if (purchase === null) {
    return unlinked(event.orderId);
  }
  // The same compare-and-set from `paid` the return uses: a purchase already
  // `Refunded` keeps that status, and one already `Disputed` is not rewritten.
  await tx.purchase.updateMany({
    where: { id: purchase.id, status: PURCHASE_STATUSES.paid },
    data: { status: PURCHASE_STATUSES.disputed },
  });
  if (purchase.entitlement !== null) {
    await tx.entitlement.update({
      where: { id: purchase.entitlement.id },
      data: { suspended: true },
    });
  }
  return {
    outcome: WEBHOOK_OUTCOMES.processed,
    reason: null,
    accountId: purchase.accountId,
    orderId: event.orderId,
    purchaseId: purchase.id,
    entitlementId: purchase.entitlement?.id ?? null,
    scanId: purchase.scan?.id ?? null,
  };
}

/**
 * What the line records beyond its figures: how it was measured, and — for a
 * payload with no return id — that its dedup key is the delivery, so the same
 * return redelivered under a new event id would be counted a second time.
 */
function lineReason(measured: string | null, deliveryEventId: string | null): string | null {
  const keyed =
    deliveryEventId === null
      ? null
      : `return.created carries no return id; counted once per delivery (${deliveryEventId})`;
  const parts = [measured, keyed].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join('; ');
}

/** The outcome text: what is back so far, and whether access survived it. */
function returnReason(
  refunded: CumulativeRefund,
  basis: ChargeBasis,
  duplicateOf: string | null,
  statusBeforeThisReturn: string,
): string | null {
  const counted = `${refunded.amountCharged} of ${basis.total} ${basis.currency} returned so far`;
  if (duplicateOf !== null) {
    return `return ${duplicateOf} was already counted; ${counted}`;
  }
  if (refunded.isFull) {
    // A full return against a charge that was already disputed is the only case
    // where the recorded status does not follow the event, so it is the one case
    // that has to be said out loud.
    return statusBeforeThisReturn === PURCHASE_STATUSES.disputed
      ? `full return recorded; ${counted}; the purchase stays ${PURCHASE_STATUSES.disputed} ` +
          'because a chargeback was recorded against it first, and access stays suspended'
      : // Nothing to explain: the whole charge is back and access is gone with it.
        null;
  }
  return `partial return recorded; ${counted}; access left in place`;
}
