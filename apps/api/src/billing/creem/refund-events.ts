import type { Prisma } from '@prisma/client';

import { PURCHASE_STATUSES, REFUND_STATUSES, refundIdempotencyKey } from '../constants.ts';
import { NOTHING, WEBHOOK_OUTCOMES, type DispatchResult } from '../fastspring/outcomes.ts';
import {
  chargeBasisOf,
  cumulativeRefund,
  type ChargeBasis,
  type CumulativeRefund,
} from '../refund-basis.ts';
import {
  notePartialProviderRefund,
  reconcileDispatchFromProviderRefund,
} from '../refunds/outbox.ts';
import { CREEM_PROVIDER } from './config.ts';
import {
  CREEM_EVENT_TYPES,
  type CreemDisputeCreatedEvent,
  type CreemRefundCreatedEvent,
} from './events.ts';
import { resolveCreemRefundLine } from './refund-line.ts';

// What a Creem refund or dispute does to a purchase we already granted.
//
// The same rules as FastSpring's return/chargeback handling, on Creem's events:
//
// Both are monotonic: they only ever move a purchase forward (paid -> Refunded /
// Disputed) so a redelivery or an out-of-order event cannot restore access. A
// full refund also suspends the entitlement — a buyer whose money was returned
// must not keep the report the money paid for.
//
// DISPUTED IS TERMINAL, AND SO IS REFUNDED. The two end states are not ranked by
// arrival order: whichever is written first stays. A dispute is a bank-forced
// reversal — it carries a fee, it counts against the merchant account, and it is
// the thing an operator has to be able to find afterwards — so a refund that
// Creem reports for the same order once the dispute is under way must not
// quietly relabel the purchase `Refunded` and erase that. Both writes are
// therefore compare-and-set on the state they are allowed to leave, `paid`.
//
// REFUNDS ACCUMULATE. Creem can refund a charge in part, and each `refund.created`
// states only its own amount. The decision is therefore taken on everything
// refunded so far: every refund is stored as its own ProviderRefund line, keyed
// on the Creem refund id, and the lines are summed on the purchase's charged
// basis (billing/refund-basis.ts). The same refund redelivered under a new
// webhook event id is not counted twice, because the line already exists and the
// insert does nothing.
//
// A refund that carries no id of its own is keyed on the delivery instead. That
// is the one case a redelivery can double-count — which errs towards suspending,
// and says so in the line's stored reason.

function findPurchase(tx: Prisma.TransactionClient, orderId: string) {
  return tx.purchase.findUnique({
    where: {
      provider_providerTransactionId: {
        provider: CREEM_PROVIDER,
        providerTransactionId: orderId,
      },
    },
    include: { entitlement: true, scan: true, refund: true },
  });
}

/**
 * The same purchase, with its row locked for the rest of the transaction.
 *
 * Two refunds for one order delivered at the same time would otherwise each read
 * the sum before the other's line was committed, both conclude "partial", and
 * leave a fully refunded report readable — the exact failure this handler exists
 * to prevent. The lock makes the read-sum-decide sequence below serial per
 * purchase. A row that does not exist yet cannot be locked, which is the
 * `unlinked` path: the pending replay applies the event when the order lands.
 */
async function lockPurchase(tx: Prisma.TransactionClient, orderId: string) {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Purchase"
    WHERE "provider" = ${CREEM_PROVIDER} AND "providerTransactionId" = ${orderId}
    FOR UPDATE`;
  return locked.length === 0 ? null : findPurchase(tx, orderId);
}

function unlinked(orderId: string): DispatchResult {
  // Out-of-order event: the checkout.completed may still arrive. Store, do nothing.
  return {
    ...NOTHING,
    outcome: WEBHOOK_OUTCOMES.unlinked,
    orderId,
    reason: 'no purchase for this order yet',
  };
}

/**
 * Applies one `refund.created`.
 *
 * `deliveryEventId` is the id of the webhook delivery carrying the event; it is
 * the fallback dedup key for a payload that states no refund id of its own.
 */
export async function processCreemRefund(
  tx: Prisma.TransactionClient,
  event: CreemRefundCreatedEvent,
  now: Date,
  deliveryEventId: string,
): Promise<DispatchResult> {
  if (event.orderId === null) {
    return { ...NOTHING, reason: 'refund.created payload has no order id' };
  }
  const purchase = await lockPurchase(tx, event.orderId);
  if (purchase === null) {
    return unlinked(event.orderId);
  }

  const basis = chargeBasisOf(purchase);
  const line = resolveCreemRefundLine(event, basis);
  const refundId = event.refundId ?? deliveryEventId;
  // INSERT ... ON CONFLICT DO NOTHING: the line is what makes the sum idempotent,
  // so a refund already counted must neither be inserted again nor overwrite the
  // figures the first delivery recorded.
  const inserted = await tx.providerRefund.createMany({
    data: {
      purchaseId: purchase.id,
      provider: CREEM_PROVIDER,
      providerRefundId: refundId,
      eventType: CREEM_EVENT_TYPES.refundCreated,
      amountCharged: line.amountCharged,
      amountUsd: line.amountUsd,
      currency: line.currency,
      reason: lineReason(line.reason, event, deliveryEventId),
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
    // status (the dispute is the stronger fact and must stay findable), and a
    // concurrent dispute that commits between the lock above and this write
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
    // The aggregate states everything refunded so far, not the last instalment.
    amountUsd: refunded.amountUsd,
    // amountUsd is USD-normalised, so the record names USD rather than the
    // buyer's currency; the charged figure stays on the purchase.
    currency: 'USD',
    provider: CREEM_PROVIDER,
    providerTransactionId: event.orderId,
    providerEventId: refundId,
    priceId: purchase.priceId,
    refundRequestId: refundId,
    // Creem's free-text reason is not our closed reason enum (§18); a
    // seller-initiated refund is recorded as a support decision.
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

  // The outbound half, reconciled against what the provider actually did. This is
  // the only writer of a settled dispatch: our own submission getting a 200 says a
  // refund was created, and this event is the money arriving. It also takes a
  // dispatch that was still queued off the sweep's list, so a refund issued from
  // the Creem dashboard cannot be followed by a second one from here.
  const reconciled = refunded.isFull
    ? await reconcileDispatchFromProviderRefund(tx, {
        purchaseId: purchase.id,
        providerRefundId: refundId,
        now,
        reason: `provider reported the full charge refunded (${refundId})`,
      })
    : await notePartialProviderRefund(tx, {
        purchaseId: purchase.id,
        reason:
          `provider refunded ${refunded.amountCharged} of ${basis.total} ${basis.currency}; ` +
          'the remainder has to be issued by hand',
        now,
      });

  return {
    outcome: alreadyCounted ? WEBHOOK_OUTCOMES.deduplicated : WEBHOOK_OUTCOMES.processed,
    // A dispatch row this handler could not move is stated in the stored
    // outcome rather than dropped. It is the money half of the event: the
    // purchase and the refund record are correct, and one row still needs a
    // person, which nobody would ever learn from a silent return value.
    reason: withDispatchNote(
      refundReason(refunded, basis, alreadyCounted ? refundId : null, purchase.status, event),
      reconciled,
    ),
    accountId: purchase.accountId,
    orderId: event.orderId,
    purchaseId: purchase.id,
    entitlementId: purchase.entitlement?.id ?? null,
    scanId: purchase.scan?.id ?? null,
  };
}

/** Appends the unresolved-dispatch fact to a webhook outcome's stored reason. */
function withDispatchNote(
  reason: string | null,
  reconciled: { readonly outcome: string; readonly observedState?: string },
): string | null {
  if (reconciled.outcome !== 'unresolved') return reason;
  const note =
    `the refund dispatch row could not be moved (it reads ${reconciled.observedState ?? 'unknown'}) ` +
    'and needs an operator';
  return reason === null ? note : `${reason}; ${note}`;
}

export async function processCreemDispute(
  tx: Prisma.TransactionClient,
  event: CreemDisputeCreatedEvent,
): Promise<DispatchResult> {
  if (event.orderId === null) {
    return { ...NOTHING, reason: 'dispute.created payload has no order id' };
  }
  const purchase = await findPurchase(tx, event.orderId);
  if (purchase === null) {
    return unlinked(event.orderId);
  }
  // The same compare-and-set from `paid` the refund uses: a purchase already
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
 * What the line records beyond its figures: how it was measured, whether Creem
 * reported the refund as anything but succeeded, and — for a payload with no
 * refund id — that its dedup key is the delivery, so the same refund redelivered
 * under a new event id would be counted a second time.
 */
function lineReason(
  measured: string | null,
  event: CreemRefundCreatedEvent,
  deliveryEventId: string,
): string | null {
  const status =
    event.status === null || event.status === 'succeeded'
      ? null
      : `refund.created reports status ${event.status}; counted as money back regardless`;
  const keyed =
    event.refundId === null
      ? `refund.created carries no refund id; counted once per delivery (${deliveryEventId})`
      : null;
  const parts = [measured, status, keyed].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join('; ');
}

/** The outcome text: what is back so far, and whether access survived it. */
function refundReason(
  refunded: CumulativeRefund,
  basis: ChargeBasis,
  duplicateOf: string | null,
  statusBeforeThisRefund: string,
  event: CreemRefundCreatedEvent,
): string | null {
  const counted = `${refunded.amountCharged} of ${basis.total} ${basis.currency} refunded so far`;
  if (duplicateOf !== null) {
    return `refund ${duplicateOf} was already counted; ${counted}`;
  }
  const pending =
    event.status === null || event.status === 'succeeded'
      ? ''
      : `; Creem reports the refund as ${event.status}`;
  if (refunded.isFull) {
    // A full refund against a charge that was already disputed is the only case
    // where the recorded status does not follow the event, so it is the one case
    // that has to be said out loud.
    return statusBeforeThisRefund === PURCHASE_STATUSES.disputed
      ? `full refund recorded; ${counted}; the purchase stays ${PURCHASE_STATUSES.disputed} ` +
          `because a dispute was recorded against it first, and access stays suspended${pending}`
      : pending === ''
        ? // Nothing to explain: the whole charge is back and access is gone with it.
          null
        : `full refund recorded${pending}`;
  }
  return `partial refund recorded; ${counted}; access left in place${pending}`;
}
