import { ENTITLEMENT_DAYS, RULESET_VERSION } from '@fluxradar/contracts';
import type { Prisma, PrismaClient } from '@prisma/client';

import {
  DEFAULT_SCOPE_JSON,
  JOB_STATUSES,
  JOB_TYPES,
  PURCHASE_STATUSES,
  REFUND_STATUSES,
} from './constants.ts';
import { InvalidSignatureError, WebhookValidationError } from './errors.ts';
import { getPaddleWebhookSecret, verifyPaddleSignature } from './paddle-signature.ts';
import { isUniqueViolation } from './prisma-errors.ts';
import { findPriceMismatch, paddleWebhookEventSchema } from './webhook-schema.ts';
import type { PaddleEventType, PaddleWebhookEvent } from './webhook-schema.ts';

export interface WebhookHandlingResult {
  /** True when the event (or its transaction) was already processed. */
  readonly deduplicated: boolean;
  readonly eventId: string;
  readonly eventType: PaddleEventType;
  readonly purchaseId: string | null;
  readonly entitlementId: string | null;
  readonly scanId: string | null;
}

export interface WebhookHandlerOptions {
  /** Defaults to PADDLE_WEBHOOK_SECRET from the environment (D-029). */
  readonly secret?: string;
  readonly now?: Date;
}

const TX_OPTIONS = { maxWait: 10_000, timeout: 10_000 } as const;

/**
 * MockPaddle webhook handler (§18 idempotency contract, D-029).
 *
 * verify signature -> zod-validate -> check amount/currency/priceId against
 * TARIFFS -> in ONE database transaction: insert the event into the dedup
 * table (unique paddleEventId), create Purchase + Entitlement (30 days) +
 * Scan (Pending) + Job. A redelivered event returns the stored result without
 * side effects; a second event for the same paddleTransactionId never creates
 * a second purchase; out-of-order events do not roll state back (monotonic).
 */
export async function handlePaddleWebhook(
  prisma: PrismaClient,
  rawBody: string,
  signature: string,
  options: WebhookHandlerOptions = {},
): Promise<WebhookHandlingResult> {
  const secret = options.secret ?? getPaddleWebhookSecret();
  if (!verifyPaddleSignature(rawBody, signature, secret)) {
    throw new InvalidSignatureError();
  }

  const event = parseEvent(rawBody);
  if (event.eventType === 'transaction.paid') {
    const mismatch = findPriceMismatch(event);
    if (mismatch) {
      throw new WebhookValidationError(mismatch);
    }
  }

  // Attempt 2 only fires after a lost paddleTransactionId race: the first
  // transaction rolled back fully, the rerun takes the dedup read path.
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(
        (tx) => processEvent(tx, event, rawBody, signature, options.now ?? new Date()),
        TX_OPTIONS,
      );
    } catch (error) {
      if (isUniqueViolation(error, 'paddleEventId')) {
        return storedResult(prisma, event);
      }
      if (isUniqueViolation(error, 'paddleTransactionId') && attempt === 1) {
        continue;
      }
      throw error;
    }
  }
}

function parseEvent(rawBody: string): PaddleWebhookEvent {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new WebhookValidationError('webhook body is not valid JSON');
  }
  const parsed = paddleWebhookEventSchema.safeParse(json);
  if (!parsed.success) {
    throw new WebhookValidationError(`webhook payload invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

async function processEvent(
  tx: Prisma.TransactionClient,
  event: PaddleWebhookEvent,
  rawBody: string,
  signature: string,
  now: Date,
): Promise<WebhookHandlingResult> {
  await tx.webhookEvent.create({
    data: {
      paddleEventId: event.eventId,
      eventType: event.eventType,
      rawBody,
      signature,
      processedAt: now,
    },
  });
  return event.eventType === 'transaction.paid'
    ? processPaid(tx, event, now)
    : processRefunded(tx, event);
}

async function processPaid(
  tx: Prisma.TransactionClient,
  event: PaddleWebhookEvent,
  now: Date,
): Promise<WebhookHandlingResult> {
  const existing = await tx.purchase.findUnique({
    where: { paddleTransactionId: event.transactionId },
    include: { entitlement: true, scan: true },
  });
  if (existing) {
    // Same transaction under a new event id: record the event, change nothing.
    return {
      deduplicated: true,
      eventId: event.eventId,
      eventType: event.eventType,
      purchaseId: existing.id,
      entitlementId: existing.entitlement?.id ?? null,
      scanId: existing.scan?.id ?? null,
    };
  }

  const profile = await tx.siteProfile.findUnique({ where: { id: event.siteProfileId } });
  if (!profile || profile.accountId !== event.accountId) {
    throw new WebhookValidationError(
      `site profile ${event.siteProfileId} not found for account ${event.accountId}`,
    );
  }

  const purchase = await tx.purchase.create({
    data: {
      accountId: event.accountId,
      siteProfileId: event.siteProfileId,
      plan: event.plan,
      paddleTransactionId: event.transactionId,
      amountUsd: event.amountUsd,
      currency: event.currency,
      status: PURCHASE_STATUSES.paid,
    },
  });
  const entitlement = await tx.entitlement.create({
    data: { purchaseId: purchase.id, expiresAt: addDays(now, ENTITLEMENT_DAYS) },
  });
  const scan = await tx.scan.create({
    data: {
      purchaseId: purchase.id,
      accountId: event.accountId,
      siteProfileId: event.siteProfileId,
      plan: event.plan,
      domain: profile.domain,
      status: 'Pending',
      scopeJson: DEFAULT_SCOPE_JSON,
      rulesetVersion: RULESET_VERSION,
    },
  });
  await tx.job.create({
    data: { scanId: scan.id, type: JOB_TYPES.scan, status: JOB_STATUSES.pending },
  });

  return {
    deduplicated: false,
    eventId: event.eventId,
    eventType: event.eventType,
    purchaseId: purchase.id,
    entitlementId: entitlement.id,
    scanId: scan.id,
  };
}

async function processRefunded(
  tx: Prisma.TransactionClient,
  event: PaddleWebhookEvent,
): Promise<WebhookHandlingResult> {
  const purchase = await tx.purchase.findUnique({
    where: { paddleTransactionId: event.transactionId },
    include: { refund: true, scan: true, entitlement: true },
  });
  if (!purchase) {
    // Out-of-order refund before paid: store the event, roll nothing forward.
    return {
      deduplicated: false,
      eventId: event.eventId,
      eventType: event.eventType,
      purchaseId: null,
      entitlementId: null,
      scanId: null,
    };
  }

  // Monotonic: only move forward to Refunded, never back.
  await tx.purchase.updateMany({
    where: { id: purchase.id, NOT: { status: PURCHASE_STATUSES.refunded } },
    data: { status: PURCHASE_STATUSES.refunded },
  });
  if (purchase.refund) {
    await tx.refundRecord.updateMany({
      where: {
        id: purchase.refund.id,
        status: { in: [REFUND_STATUSES.requested, REFUND_STATUSES.processing] },
      },
      data: { status: REFUND_STATUSES.paid },
    });
  }

  return {
    deduplicated: false,
    eventId: event.eventId,
    eventType: event.eventType,
    purchaseId: purchase.id,
    entitlementId: purchase.entitlement?.id ?? null,
    scanId: purchase.scan?.id ?? null,
  };
}

/** Redelivered paddleEventId: reconstruct the stored result, no side effects. */
async function storedResult(
  prisma: PrismaClient,
  event: PaddleWebhookEvent,
): Promise<WebhookHandlingResult> {
  const purchase = await prisma.purchase.findUnique({
    where: { paddleTransactionId: event.transactionId },
    include: { entitlement: true, scan: true },
  });
  return {
    deduplicated: true,
    eventId: event.eventId,
    eventType: event.eventType,
    purchaseId: purchase?.id ?? null,
    entitlementId: purchase?.entitlement?.id ?? null,
    scanId: purchase?.scan?.id ?? null,
  };
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}
