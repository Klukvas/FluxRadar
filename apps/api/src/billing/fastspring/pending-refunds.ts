import type { Prisma } from '@prisma/client';

import { FASTSPRING_PROVIDER } from './config.ts';
import {
  FASTSPRING_EVENT_TYPES,
  normalizeEvent,
  parseEnvelope,
  type ChargebackCreatedEvent,
  type ReturnCreatedEvent,
} from './events.ts';
import { WEBHOOK_OUTCOMES, type WebhookOutcome } from './outcomes.ts';
import { processChargeback, processReturn } from './refund-events.ts';

// Refunds and chargebacks that arrived before the order they belong to.
//
// FastSpring does not guarantee delivery order, and a return can legitimately
// reach us before the order.completed that created the purchase — a redelivery
// after an outage reorders a whole backlog. Such an event is stored as
// `unlinked` and answered 2xx, because retrying it changes nothing while the
// purchase does not exist yet.
//
// What must not happen is that the event is then forgotten: the buyer's money
// went back and the report would stay readable. So the stored event is replayed
// from its own recorded payload the moment its order shows up, inside the same
// transaction that grants the purchase. Access is therefore never live between
// the grant and the suspension, and the replay is idempotent — the WebhookEvent
// row leaves the `unlinked` state as it is applied, and the return/chargeback
// handlers only ever move a purchase forward.
//
// THE GRANT IS NOT THE ONLY MOMENT. A return whose transaction started before the
// purchase existed and committed after this replay read the pending rows is
// invisible to it: the two transactions never see each other's uncommitted work,
// so the return finds no purchase to lock and the grant finds no row to replay,
// and the money is back while the report stays readable. The same is true of a
// row written by a release that had no replay at all. Every order.completed
// therefore replays — the granting one and a later redelivery of it alike — and
// `pending-refund-reconciliation.ts` sweeps whatever neither of them reached.

/** What replaying the stored events did, for the order.completed outcome text. */
export interface PendingRefundReplay {
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

export async function applyPendingRefundEvents(
  tx: Prisma.TransactionClient,
  orderId: string,
  now: Date,
  options: PendingRefundReplayOptions = {},
): Promise<PendingRefundReplay> {
  const appliedWhen = options.appliedWhen ?? `applied when order ${orderId} arrived`;
  const stored = await tx.webhookEvent.findMany({
    where: {
      provider: FASTSPRING_PROVIDER,
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
      event.kind === FASTSPRING_EVENT_TYPES.returnCreated
        ? await processReturn(tx, event, now, row.providerEventId)
        : await processChargeback(tx, event);
    if (!applied(result.outcome)) {
      // Still not applicable (a return whose order id we cannot resolve).
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
 * the same return reached the purchase under another delivery, so its effect is
 * in the sum and the row must leave the pending state with it.
 */
function applied(outcome: WebhookOutcome): boolean {
  return outcome === WEBHOOK_OUTCOMES.processed || outcome === WEBHOOK_OUTCOMES.deduplicated;
}

/**
 * The stored delivery, re-read as the single event this row recorded.
 *
 * The payload is our own copy of what FastSpring signed, but it is re-validated
 * rather than trusted: a row written by an older release, or a delivery whose
 * body was truncated, must be skipped instead of throwing inside the transaction
 * that is granting a purchase.
 */
function replayableEvent(
  rawBody: string,
  providerEventId: string,
): ReturnCreatedEvent | ChargebackCreatedEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }
  const raw = parseEnvelope(json)?.find((candidate) => candidate.id === providerEventId);
  if (raw === undefined) {
    return null;
  }
  const normalized = normalizeEvent(raw);
  if (!normalized.ok) {
    return null;
  }
  const event = normalized.event;
  return event.kind === FASTSPRING_EVENT_TYPES.returnCreated ||
    event.kind === FASTSPRING_EVENT_TYPES.chargebackCreated
    ? event
    : null;
}
