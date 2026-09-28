import type { CheckoutSession, Prisma, PrismaClient } from '@prisma/client';

import { storedExecutionConfig } from '../../profiles/execution-config.ts';
import { claimableCheckoutSessionWhere } from '../checkout-lifecycle.ts';
import { aiConsentSchema, type AiConsentInput } from '../checkout-metadata.ts';
import { CHECKOUT_SESSION_STATUSES } from '../constants.ts';
import { InvalidSignatureError, WebhookValidationError } from '../errors.ts';
import { NOTHING, WEBHOOK_OUTCOMES, rejected, type DispatchResult } from '../webhook-outcomes.ts';
import { createPaidScan, type PaidScanRecords } from '../paid-scan.ts';
import { isPaidPlan } from '../plans.ts';
import { isDuplicateEventId, isDuplicateTransactionId } from '../prisma-errors.ts';
import { CREEM_PROVIDER } from './config.ts';
import {
  CREEM_EVENT_TYPES,
  normalizeCreemEvent,
  creemOrderIdOf,
  parseCreemEnvelope,
  readCreemCheckoutReference,
  readCreemEventLiveFlag,
  type CreemCheckoutCompletedEvent,
  type RawCreemEvent,
} from './events.ts';
import { resolveCreemOrderAmount } from './order-amount.ts';
import { applyPendingCreemRefundEvents } from './pending-refunds.ts';
import { processCreemDispute, processCreemRefund } from './refund-events.ts';
import { verifyCreemSignature } from './signature.ts';

// Creem webhook processing (§18 idempotency contract).
//
// One POST carries one event. It is processed in its own transaction that
// starts by claiming the event id in the dedup table — a redelivery therefore
// does nothing. Creem retries a delivery that is not answered 2xx (30 s, 5 min,
// 30 min, 6 h; nothing after 24 hours), and no retry can fix a tampered amount
// or a foreign order. So once the delivery itself is readable, every per-event
// outcome answers 2xx. Only a failure of the delivery as a whole answers non-2xx
// — a signature that does not verify and a body that is not a Creem event are
// 400, an unconfigured provider is 503 — because those are the ones a
// redelivery could genuinely find fixed.

const TX_OPTIONS = { maxWait: 10_000, timeout: 10_000 } as const;

export interface CreemEventResult {
  readonly eventId: string;
  readonly eventType: string;
  readonly outcome: (typeof WEBHOOK_OUTCOMES)[keyof typeof WEBHOOK_OUTCOMES];
  readonly reason: string | null;
  readonly purchaseId: string | null;
  readonly entitlementId: string | null;
  readonly scanId: string | null;
}

export interface CreemWebhookResult {
  readonly received: number;
  readonly results: readonly CreemEventResult[];
  /** Scans created by this delivery; the HTTP layer queues and announces them. */
  readonly createdScanIds: readonly string[];
}

export interface CreemWebhookOptions {
  readonly secret: string;
  /** true when the API runs against the live Creem environment; test events are ignored. */
  readonly expectLive: boolean;
  readonly now?: Date;
}

/** Everything one event needs beyond the payload itself. */
interface ProcessingContext {
  readonly expectLive: boolean;
  readonly now: Date;
}

/** What a rolled-back claim still has to record once its transaction is gone. */
interface RollbackRecord {
  readonly sessionId: string;
  readonly accountId: string;
  readonly orderId: string;
  readonly reason: string;
}

/**
 * Aborts the transaction that already claimed a checkout session.
 *
 * It is thrown, not returned, precisely because returning commits: the claim,
 * the purchase and the scan are one unit, and a failure after the claim must
 * leave the session exactly as it was so the order can still be recorded — and,
 * if it was our validation that was wrong, redelivered. `processOne` catches it
 * and writes the rejection in a transaction of its own.
 */
class ClaimedSessionRollback extends Error {
  readonly record: RollbackRecord;

  constructor(record: RollbackRecord) {
    super(record.reason);
    this.name = 'ClaimedSessionRollback';
    this.record = record;
  }
}

export async function handleCreemWebhook(
  prisma: PrismaClient,
  rawBody: Buffer | string,
  signature: string,
  options: CreemWebhookOptions,
): Promise<CreemWebhookResult> {
  if (!verifyCreemSignature(rawBody, signature, options.secret)) {
    throw new InvalidSignatureError('Creem webhook signature verification failed');
  }
  const text = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new WebhookValidationError('webhook body is not valid JSON');
  }
  const events = parseCreemEnvelope(json);
  if (events === null) {
    throw new WebhookValidationError('webhook body is not a Creem event');
  }

  const context: ProcessingContext = {
    expectLive: options.expectLive,
    now: options.now ?? new Date(),
  };
  const results: CreemEventResult[] = [];
  for (const raw of events) {
    results.push(await processOne(prisma, raw, text, signature, context));
  }
  return {
    received: events.length,
    results,
    createdScanIds: results.flatMap((result) =>
      result.outcome === WEBHOOK_OUTCOMES.processed && result.scanId !== null
        ? [result.scanId]
        : [],
    ),
  };
}

async function processOne(
  prisma: PrismaClient,
  raw: RawCreemEvent,
  rawBody: string,
  signature: string,
  context: ProcessingContext,
): Promise<CreemEventResult> {
  // Attempt 2 only fires after a lost order-id race: the first transaction rolled
  // back fully, so the rerun takes the "already paid" path.
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(
        (tx) => runInTransaction(tx, raw, rawBody, signature, context),
        TX_OPTIONS,
      );
    } catch (error) {
      if (isDuplicateEventId(error)) {
        return outcomeOnly(raw, WEBHOOK_OUTCOMES.deduplicated, 'event already processed');
      }
      if (error instanceof ClaimedSessionRollback) {
        return recordRolledBackClaim(prisma, raw, rawBody, signature, context, error.record);
      }
      if (isDuplicateTransactionId(error) && attempt === 1) {
        continue;
      }
      throw error;
    }
  }
}

/**
 * Records an order whose grant was rolled back. The previous transaction left no
 * trace, so this one claims the event id itself and marks the session with what
 * happened — the session is back in the state the claim found it in, so the same
 * compare-and-set that guards a rejection anywhere else applies here too.
 */
async function recordRolledBackClaim(
  prisma: PrismaClient,
  raw: RawCreemEvent,
  rawBody: string,
  signature: string,
  context: ProcessingContext,
  record: RollbackRecord,
): Promise<CreemEventResult> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.webhookEvent.create({
        data: {
          provider: CREEM_PROVIDER,
          providerEventId: raw.id,
          providerTransactionId: record.orderId,
          accountId: record.accountId,
          eventType: raw.eventType,
          outcome: WEBHOOK_OUTCOMES.rejected,
          outcomeReason: record.reason,
          rawBody,
          signature,
          processedAt: context.now,
        },
      });
      await markSessionRejected(tx, record.sessionId, record.reason);
    }, TX_OPTIONS);
  } catch (error) {
    if (!isDuplicateEventId(error)) {
      throw error;
    }
    return outcomeOnly(raw, WEBHOOK_OUTCOMES.deduplicated, 'event already processed');
  }
  return outcomeOnly(raw, WEBHOOK_OUTCOMES.rejected, record.reason);
}

async function runInTransaction(
  tx: Prisma.TransactionClient,
  raw: RawCreemEvent,
  rawBody: string,
  signature: string,
  context: ProcessingContext,
): Promise<CreemEventResult> {
  // Claiming the event id first makes every path below idempotent: a redelivery
  // loses the unique constraint before it can touch billing state.
  const stored = await tx.webhookEvent.create({
    data: {
      provider: CREEM_PROVIDER,
      providerEventId: raw.id,
      eventType: raw.eventType,
      outcome: WEBHOOK_OUTCOMES.ignored,
      rawBody,
      signature,
      processedAt: context.now,
    },
  });

  const result = await dispatchSafely(tx, raw, context);
  await tx.webhookEvent.update({
    where: { id: stored.id },
    data: {
      outcome: result.outcome,
      outcomeReason: result.reason,
      ...(result.accountId !== null ? { accountId: result.accountId } : {}),
      ...(result.orderId !== null ? { providerTransactionId: result.orderId } : {}),
    },
  });
  return {
    eventId: raw.id,
    eventType: raw.eventType,
    outcome: result.outcome,
    reason: result.reason,
    purchaseId: result.purchaseId,
    entitlementId: result.entitlementId,
    scanId: result.scanId,
  };
}

/**
 * A payload our own validation refuses is recorded as `rejected` and answered
 * 2xx: no Creem retry can turn a foreign order into a valid one. Anything else
 * (a database or infrastructure failure) still propagates, because that IS
 * worth retrying.
 */
async function dispatchSafely(
  tx: Prisma.TransactionClient,
  raw: RawCreemEvent,
  context: ProcessingContext,
): Promise<DispatchResult> {
  try {
    return await dispatch(tx, raw, context);
  } catch (error) {
    if (error instanceof WebhookValidationError) {
      return { ...NOTHING, outcome: WEBHOOK_OUTCOMES.rejected, reason: error.message };
    }
    throw error;
  }
}

async function dispatch(
  tx: Prisma.TransactionClient,
  raw: RawCreemEvent,
  context: ProcessingContext,
): Promise<DispatchResult> {
  const normalized = normalizeCreemEvent(raw);
  if (!normalized.ok) {
    return { ...NOTHING, reason: normalized.reason };
  }
  // A test-environment order must never grant access on a live deployment, and
  // the reverse would silently accept unpaid orders while testing. An event that
  // states no mode at all is NOT assumed to be test-mode: doing so would drop a
  // real payment on the floor. Its mode is decided by the checkout session it
  // names instead, which records the mode it was opened in.
  const liveFlag = readCreemEventLiveFlag(raw);
  if (liveFlag !== null && liveFlag !== context.expectLive) {
    return {
      ...NOTHING,
      orderId: creemOrderIdOf(normalized.event),
      reason: `event is from the ${liveFlag ? 'live' : 'test'} Creem environment, which does not match the configured mode`,
    };
  }
  switch (normalized.event.kind) {
    case CREEM_EVENT_TYPES.checkoutCompleted:
      return processCheckoutCompleted(tx, normalized.event, context);
    case CREEM_EVENT_TYPES.refundCreated:
      // The delivery id is the fallback dedup key for a refund that states none.
      return processCreemRefund(tx, normalized.event, context.now, raw.id);
    case CREEM_EVENT_TYPES.disputeCreated:
      return processCreemDispute(tx, normalized.event);
  }
}

async function processCheckoutCompleted(
  tx: Prisma.TransactionClient,
  event: CreemCheckoutCompletedEvent,
  context: ProcessingContext,
): Promise<DispatchResult> {
  const existing = await tx.purchase.findUnique({
    where: {
      provider_providerTransactionId: {
        provider: CREEM_PROVIDER,
        providerTransactionId: event.orderId,
      },
    },
    include: { entitlement: true, scan: true },
  });
  if (existing !== null) {
    // Same order under a new event id (a manual retry, or a Creem redelivery):
    // it grants nothing a second time. It is still a moment at which a pending
    // refund for this order becomes applicable — one stored while the grant was
    // in flight was invisible to that transaction's replay — so the redelivery
    // is what heals it, well before the sweep would.
    const replay = await applyPendingCreemRefundEvents(tx, event.orderId, context.now, {
      appliedWhen: `applied when order ${event.orderId} was redelivered`,
    });
    const preempted = replay.appliedEventTypes.length > 0;
    return {
      outcome: WEBHOOK_OUTCOMES.deduplicated,
      reason: preempted ? refundHealedReason(replay.appliedEventTypes) : 'order already granted',
      accountId: existing.accountId,
      orderId: event.orderId,
      purchaseId: existing.id,
      entitlementId: existing.entitlement?.id ?? null,
      // Access was just taken back, so the scan this order bought is not named
      // as one this delivery makes available.
      scanId: preempted ? null : (existing.scan?.id ?? null),
    };
  }

  const reference = readCreemCheckoutReference(event);
  if (reference === null) {
    return rejected(event.orderId, 'checkout carries no FluxRadar checkout reference');
  }
  const session = await tx.checkoutSession.findUnique({ where: { reference } });
  if (session === null || session.provider !== CREEM_PROVIDER) {
    return rejected(event.orderId, 'checkout reference does not belong to this environment');
  }
  // The session records the mode it was opened in, so it also settles the mode of
  // an event that carried no mode.
  if (session.liveMode !== context.expectLive) {
    const problem = 'checkout session was opened in the other Creem mode';
    await markSessionRejected(tx, session.id, problem);
    return { ...rejected(event.orderId, problem), accountId: session.accountId };
  }
  if (!isPaidPlan(session.plan)) {
    const problem = 'stored plan is not a paid plan';
    await markSessionRejected(tx, session.id, problem);
    return { ...rejected(event.orderId, problem), accountId: session.accountId };
  }
  // Bound to the checkout we opened: the product the order sold has to be the
  // product the session was opened for. A payload that names no product cannot
  // be checked and is refused rather than assumed.
  if (event.productId !== session.productPath) {
    const problem =
      event.productId === null
        ? `order names no product; the checkout was opened for ${session.productPath}`
        : `order is for product ${event.productId}, not ${session.productPath}`;
    await markSessionRejected(tx, session.id, problem);
    return { ...rejected(event.orderId, problem), accountId: session.accountId };
  }
  const amount = resolveCreemOrderAmount(session, event, session.plan);
  if (amount.kind === 'rejected') {
    await markSessionRejected(tx, session.id, amount.reason);
    return { ...rejected(event.orderId, amount.reason), accountId: session.accountId };
  }

  // One reference grants access once: a second order quoting the same reference
  // loses this compare-and-set and is rejected instead of buying a second scan.
  // A session the retention sweep closed as abandoned is still claimable — it
  // granted nothing — so housekeeping can never swallow a late real payment.
  const claimed = await tx.checkoutSession.updateMany({
    where: { id: session.id, ...claimableCheckoutSessionWhere() },
    data: {
      status: CHECKOUT_SESSION_STATUSES.completed,
      statusReason: amount.unverifiedReason,
      settledAmount: amount.settledAmount,
      settledCurrency: amount.settledCurrency,
    },
  });
  if (claimed.count !== 1) {
    return {
      ...rejected(event.orderId, 'checkout reference was already used by another order'),
      accountId: session.accountId,
    };
  }

  // From here the session says `completed`, so everything that still has to
  // happen for that to be true must either happen or be undone. A validation
  // failure inside createPaidScan is therefore not returned as a rejection —
  // returning would COMMIT the claim and leave a session marked completed with
  // no purchase, burning the reference for an order that granted nothing. It
  // aborts the transaction instead and is recorded in a fresh one.
  let records: PaidScanRecords;
  try {
    records = await createPaidScan(tx, {
      provider: CREEM_PROVIDER,
      providerTransactionId: event.orderId,
      accountId: session.accountId,
      siteProfileId: session.siteProfileId,
      plan: session.plan,
      amount: amount.amountUsd,
      currency: 'USD',
      ...settledFields(amount.settledAmount, amount.settledCurrency),
      priceId: session.productPath,
      scopeJson: session.scopeJson,
      profileConfigVersion: session.profileConfigVersion,
      executionConfig: storedExecutionConfig(session.executionConfigJson) ?? undefined,
      aiConsent: readStoredConsent(session),
      now: context.now,
    });
    await tx.checkoutSession.update({
      where: { id: session.id },
      data: { purchaseId: records.purchaseId },
    });
  } catch (error) {
    if (error instanceof WebhookValidationError) {
      throw new ClaimedSessionRollback({
        sessionId: session.id,
        accountId: session.accountId,
        orderId: event.orderId,
        reason: error.message,
      });
    }
    throw error;
  }

  // A refund or a dispute for this order may have been delivered before it.
  // Such an event was stored, not applied — there was no purchase to apply it to
  // — and this is the moment it becomes applicable. Replaying it here, in the
  // transaction that grants the purchase, is what keeps a refunded order from
  // leaving a readable report behind.
  const replay = await applyPendingCreemRefundEvents(tx, event.orderId, context.now);
  const preempted = replay.appliedEventTypes.length > 0;

  return {
    outcome: WEBHOOK_OUTCOMES.processed,
    reason: preempted
      ? refundPreemptedReason(replay.appliedEventTypes, amount.unverifiedReason)
      : amount.unverifiedReason,
    accountId: session.accountId,
    orderId: event.orderId,
    purchaseId: records.purchaseId,
    entitlementId: records.entitlementId,
    // The scan row stays as the record of what was bought, but the access it
    // represents was taken back in this same transaction, so it is not handed to
    // the queue and the buyer is not told it is ready.
    scanId: preempted ? null : records.scanId,
  };
}

/** Says that a refund left pending against an already-granted order is now applied. */
function refundHealedReason(appliedEventTypes: readonly string[]): string {
  return (
    `order already granted; a pending ${appliedEventTypes.join(' and ')} for it was applied ` +
    'on this delivery and access is suspended'
  );
}

/** Says that the money was already going back before the order was recorded. */
function refundPreemptedReason(
  appliedEventTypes: readonly string[],
  unverifiedReason: string | null,
): string {
  const applied =
    `${appliedEventTypes.join(' and ')} for this order was delivered before it and has been ` +
    'applied; the purchase is recorded and access stays suspended';
  return unverifiedReason === null ? applied : `${applied}; ${unverifiedReason}`;
}

/** A charge already in USD needs no separate settled figure. */
function settledFields(
  settledAmount: number,
  settledCurrency: string,
): { settledAmount?: number; settledCurrency?: string } {
  return settledCurrency === 'USD' ? {} : { settledAmount, settledCurrency };
}

function readStoredConsent(session: CheckoutSession): AiConsentInput | undefined {
  if (session.aiConsentJson === null) {
    return undefined;
  }
  // Unreadable consent must not block a paid scan; the GEO module then reports
  // Unavailable/ConsentMissing instead of reaching an AI provider without consent.
  try {
    const parsed = aiConsentSchema.safeParse(JSON.parse(session.aiConsentJson) as unknown);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Records why an order could not be honoured on the session it named. Same
 * states as the claim: a session the sweep closed as abandoned is still open to
 * a verdict, so the stored reason describes what actually happened to it.
 */
async function markSessionRejected(
  tx: Prisma.TransactionClient,
  sessionId: string,
  reason: string,
): Promise<void> {
  await tx.checkoutSession.updateMany({
    where: { id: sessionId, ...claimableCheckoutSessionWhere() },
    data: { status: CHECKOUT_SESSION_STATUSES.rejected, statusReason: reason },
  });
}

function outcomeOnly(
  raw: RawCreemEvent,
  outcome: CreemEventResult['outcome'],
  reason: string,
): CreemEventResult {
  return {
    eventId: raw.id,
    eventType: raw.eventType,
    outcome,
    reason,
    purchaseId: null,
    entitlementId: null,
    scanId: null,
  };
}
