import type { Prisma } from '@prisma/client';

import { WEBHOOK_OUTCOMES, type WebhookOutcome } from '../fastspring/outcomes.ts';
import type {
  PendingRefundReplayOptions,
  PendingRefundReplayResult,
} from '../pending-refund-sweep.ts';
import { CREEM_PROVIDER } from './config.ts';
import {
  CREEM_EVENT_TYPES,
  normalizeCreemEvent,
  parseCreemEnvelope,
  type CreemDisputeCreatedEvent,
  type CreemRefundCreatedEvent,
} from './events.ts';
import { processCreemDispute, processCreemRefund } from './refund-events.ts';

// Refunds and disputes that arrived before the order they belong to.
//
// Creem does not guarantee delivery order either — it retries each delivery on
// its own schedule (30 s, 5 min, 30 min, 6 h) — so a refund.created can reach us
// before the checkout.completed that creates the purchase. Such an event is
// stored as `unlinked` and answered 2xx, because retrying it changes nothing
// while the purchase does not exist yet.
//
// What must not happen is that the event is then forgotten: the buyer's money
// went back and the report would stay readable. So the stored event is replayed
// from its own recorded payload the moment its order shows up, inside the same
// transaction that grants the purchase. Access is therefore never live between
// the grant and the suspension, and the replay is idempotent — the WebhookEvent
// row leaves the `unlinked` state as it is applied, and the refund/dispute
// handlers only ever move a purchase forward.
//
// THE GRANT IS NOT THE ONLY MOMENT. A refund whose transaction started before the
// purchase existed and committed after this replay read the pending rows is
// invisible to it. Every checkout.completed therefore replays — the granting one
// and a later redelivery of it alike — and the pending-refund sweep
// (pending-refund-reconciliation.ts) sweeps whatever neither of them reached.

export async function applyPendingCreemRefundEvents(
  tx: Prisma.TransactionClient,
  orderId: string,
  now: Date,
  options: PendingRefundReplayOptions = {},
): Promise<PendingRefundReplayResult> {
  const appliedWhen = options.appliedWhen ?? `applied when order ${orderId} arrived`;
  const stored = await tx.webhookEvent.findMany({
    where: {
      provider: CREEM_PROVIDER,
      providerTransactionId: orderId,
      outcome: WEBHOOK_OUTCOMES.unlinked,
    },
    orderBy: { processedAt: 'asc' },
  });

  const appliedEventTypes: string[] = [];
  for (const row of stored) {
    const event = replayableEvent(row.rawBody, row.providerEventId);
    if (event === null) {
      continue;
    }
    const result =
      event.kind === CREEM_EVENT_TYPES.refundCreated
        ? await processCreemRefund(tx, event, now, row.providerEventId)
        : await processCreemDispute(tx, event);
    if (!applied(result.outcome)) {
      // Still not applicable (an event whose order id we cannot resolve).
      // Leaving the row `unlinked` keeps it visible to an operator.
      continue;
    }
    await tx.webhookEvent.update({
      where: { id: row.id },
      data: {
        outcome: result.outcome,
        outcomeReason: appliedWhen,
        ...(result.accountId !== null ? { accountId: result.accountId } : {}),
      },
    });
    appliedEventTypes.push(row.eventType);
  }
  return { appliedEventTypes };
}

/**
 * Whether the replay accounted for the stored event. `deduplicated` counts:
 * the same refund reached the purchase under another delivery, so its effect is
 * in the sum and the row must leave the pending state with it.
 */
function applied(outcome: WebhookOutcome): boolean {
  return outcome === WEBHOOK_OUTCOMES.processed || outcome === WEBHOOK_OUTCOMES.deduplicated;
}

/**
 * The stored delivery, re-read as the single event this row recorded.
 *
 * The payload is our own copy of what Creem signed, but it is re-validated
 * rather than trusted: a row written by an older release, or a delivery whose
 * body was truncated, must be skipped instead of throwing inside the transaction
 * that is granting a purchase.
 */
function replayableEvent(
  rawBody: string,
  providerEventId: string,
): CreemRefundCreatedEvent | CreemDisputeCreatedEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }
  const raw = parseCreemEnvelope(json)?.find((candidate) => candidate.id === providerEventId);
  if (raw === undefined) {
    return null;
  }
  const normalized = normalizeCreemEvent(raw);
  if (!normalized.ok) {
    return null;
  }
  const event = normalized.event;
  return event.kind === CREEM_EVENT_TYPES.refundCreated ||
    event.kind === CREEM_EVENT_TYPES.disputeCreated
    ? event
    : null;
}
