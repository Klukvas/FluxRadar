// The sweep that sends recorded refunds to the payment provider — and, in every
// configuration this repository ships with, the sweep that deliberately does not.
//
// FOUR RULES, ALL OF THEM ABOUT MONEY THAT CANNOT BE UNSENT:
//
//   1. IT IS OFF UNLESS A DEPLOYMENT TURNED IT ON. `readRefundDispatchConfig`
//      defaults to `manual`, and `auto` needs a second variable naming the
//      provider whose returns API was actually tested. Without that the sweep
//      reads the queue, logs it, and writes nothing to any provider.
//   2. ONE SUBMISSION PER PURCHASE, EVER. The dispatch row is unique per purchase
//      and is claimed with a compare-and-set before the request leaves. A second
//      process sweeping at the same moment loses the CAS and does nothing.
//   3. NOTHING IS RETRIED. There is no idempotency key on FastSpring's
//      `POST /returns`, so a call whose answer never arrived cannot be repeated
//      without risking a second refund. It ends as `uncertain` and waits for a
//      person or for the provider's own webhook.
//   4. A REFUND THE PROVIDER ALREADY TOUCHED IS NOT OURS TO SEND. A purchase with
//      a partial return already reported is handed to an operator: the remainder
//      has to be stated per product, in the order's currency, and this code does
//      not hold those facts well enough to put money behind them.

import type { PrismaClient, RefundDispatch, RefundRecord } from '@prisma/client';

import type { ApiLogger } from '../../http/logger.ts';
import { PURCHASE_STATUSES } from '../constants.ts';
import { adoptOrphanedRefunds } from '../refund.ts';
import { readRefundDispatchConfig, type RefundDispatchConfig } from './config.ts';
import { claimDispatchForSubmission, refundDispatchQueue, transitionDispatch } from './outbox.ts';
import type { RefundProviderAdapter } from './provider.ts';
import { REFUND_DISPATCH_STATES, type RefundDispatchState } from './states.ts';

/**
 * Money writes per sweep. Small on purpose: the queue is an exception path, and a
 * sweep that submitted fifty refunds because of a bug would be fifty refunds.
 */
export const MAX_DISPATCHES_PER_SWEEP = 5;

export interface RefundDispatcherDeps {
  readonly prisma: PrismaClient;
  readonly logger: ApiLogger;
  readonly now: () => Date;
  /** Adapters this process can submit through, keyed by their own provider name. */
  readonly adapters?: readonly RefundProviderAdapter[];
  /** Test seam; production reads process.env. */
  readonly env?: NodeJS.ProcessEnv;
  readonly maxPerSweep?: number;
}

export interface RefundSweepSummary {
  readonly mode: RefundDispatchConfig['state'];
  /** Dispatches in each state when the sweep started. */
  readonly queue: Readonly<Record<string, number>>;
  readonly submitted: number;
  readonly refused: number;
  readonly uncertain: number;
  readonly handedToOperator: number;
  /** Rows another process had already claimed. */
  readonly lost: number;
  /** Refund decisions that had no submission row and were given one. */
  readonly adopted: number;
}

const EMPTY_SUMMARY = {
  submitted: 0,
  refused: 0,
  uncertain: 0,
  handedToOperator: 0,
  lost: 0,
} as const;

/** A dispatch with the decision behind it, which is where the reason code lives. */
type PendingDispatch = RefundDispatch & { readonly refundRecord: RefundRecord };

/**
 * Why this dispatch is not something the code may submit, or null when it is.
 *
 * Each answer is a sentence stored on the row: the operator reading the queue is
 * told what to do rather than being handed a state with no reason.
 */
async function operatorReason(
  prisma: PrismaClient,
  dispatch: RefundDispatch,
): Promise<string | null> {
  if (dispatch.providerOrderId === null || dispatch.providerOrderId === '') {
    return 'no provider order id was recorded for this purchase, so no return can be addressed';
  }
  const purchase = await prisma.purchase.findUnique({
    where: { id: dispatch.purchaseId },
    select: { status: true, currency: true, settledAmount: true },
  });
  if (purchase === null) {
    return 'the purchase this refund belongs to is gone';
  }
  if (purchase.status === PURCHASE_STATUSES.disputed) {
    return 'the purchase is disputed; a chargeback is already reversing it';
  }
  const reported = await prisma.providerRefund.aggregate({
    where: { purchaseId: dispatch.purchaseId },
    _count: { _all: true },
    _sum: { amountUsd: true },
  });
  if (reported._count._all > 0) {
    return (
      `the provider already reported ${reported._count._all} return(s) totalling ` +
      `${reported._sum.amountUsd ?? 0} USD against this order; any remainder has to be issued by hand`
    );
  }
  if (purchase.status === PURCHASE_STATUSES.refunded) {
    return 'the purchase is already marked refunded, with no provider return recorded to match';
  }
  return null;
}

/** Applies one adapter answer to the claimed row. */
async function applyOutcome(
  deps: RefundDispatcherDeps,
  dispatch: PendingDispatch,
  adapter: RefundProviderAdapter,
): Promise<keyof typeof EMPTY_SUMMARY> {
  const now = deps.now();
  const result = await adapter.submit({
    providerOrderId: dispatch.providerOrderId ?? '',
    amountUsd: dispatch.amountUsd,
    currency: dispatch.currency,
    // FluxRadar's own reason code (§18) lives on the decision, not on the
    // submission row; the adapter is what translates it into the provider's.
    reasonCode: dispatch.refundRecord.reasonCode,
    idempotencyKey: dispatch.idempotencyKey,
  });
  const move = (
    to: RefundDispatchState,
    reason: string,
    extra: { providerRefundId?: string; providerReasonCode?: string } = {},
  ) =>
    transitionDispatch(deps.prisma, {
      id: dispatch.id,
      from: REFUND_DISPATCH_STATES.submitting,
      to,
      reason,
      now,
      ...extra,
    });
  switch (result.outcome) {
    case 'submitted':
      await move(
        REFUND_DISPATCH_STATES.submitted,
        result.providerReference === null
          ? 'provider accepted the return'
          : `provider accepted the return (${result.providerReference})`,
        {
          providerRefundId: result.providerRefundId,
          providerReasonCode: result.providerReasonCode,
        },
      );
      return 'submitted';
    case 'refused':
      await move(REFUND_DISPATCH_STATES.failed, result.reason);
      return 'refused';
    case 'uncertain':
      // Terminal for the machine, open for a person: whether the buyer was
      // refunded is not knowable from here, and guessing either way is worse
      // than saying so.
      await move(REFUND_DISPATCH_STATES.uncertain, result.reason);
      return 'uncertain';
  }
}

/**
 * One pass over the outbox.
 *
 * Callable and called: `startServer` runs it on an interval (src/index.ts). In
 * every configuration that has not explicitly switched outbound refunds on, the
 * pass reports the queue and returns without touching a provider.
 */
export async function dispatchPendingRefunds(
  deps: RefundDispatcherDeps,
): Promise<RefundSweepSummary> {
  const config = readRefundDispatchConfig(deps.env ?? process.env);
  // Before anything is counted: a refund decision written by a release that had
  // no outbox has no row in this table, and would otherwise never be seen by the
  // sweep, the queue figures or the operator alert. Adoption is always safe —
  // it creates `manual` rows, which nothing sends.
  const adopted = await adoptOrphanedRefunds(deps.prisma);
  if (adopted > 0) {
    deps.logger.info('refund decisions without a submission row were adopted', { adopted });
  }
  const queue = await refundDispatchQueue(deps.prisma);
  const waiting = queue[REFUND_DISPATCH_STATES.requested] ?? 0;
  const stuck =
    (queue[REFUND_DISPATCH_STATES.uncertain] ?? 0) +
    (queue[REFUND_DISPATCH_STATES.submitting] ?? 0) +
    (queue[REFUND_DISPATCH_STATES.failed] ?? 0);
  if (stuck > 0) {
    // The one line an operator is meant to alert on: these do not resolve
    // themselves, and each one is a buyer whose money is in an unknown place.
    deps.logger.error('refund dispatches need an operator', { count: stuck, queue });
  }
  if (config.state !== 'active') {
    if (waiting > 0 || stuck > 0) {
      deps.logger.info('refund dispatch is not active; queue left untouched', {
        mode: config.state === 'invalid' ? 'invalid' : config.mode,
        queue,
      });
    }
    return { mode: config.state, queue, adopted, ...EMPTY_SUMMARY };
  }

  const adapter = (deps.adapters ?? []).find((candidate) => candidate.provider === config.provider);
  if (adapter === undefined) {
    deps.logger.error('refund dispatch is active but no adapter is wired for the provider', {
      provider: config.provider,
    });
    return { mode: config.state, queue, adopted, ...EMPTY_SUMMARY };
  }

  const pending: readonly PendingDispatch[] = await deps.prisma.refundDispatch.findMany({
    where: { state: REFUND_DISPATCH_STATES.requested, provider: adapter.provider },
    orderBy: { requestedAt: 'asc' },
    take: deps.maxPerSweep ?? MAX_DISPATCHES_PER_SWEEP,
    include: { refundRecord: true },
  });

  const tally = { ...EMPTY_SUMMARY } as { -readonly [K in keyof typeof EMPTY_SUMMARY]: number };
  for (const dispatch of pending) {
    const reason = await operatorReason(deps.prisma, dispatch);
    if (reason !== null) {
      await transitionDispatch(deps.prisma, {
        id: dispatch.id,
        from: REFUND_DISPATCH_STATES.requested,
        to: REFUND_DISPATCH_STATES.manual,
        reason,
        now: deps.now(),
      });
      tally.handedToOperator += 1;
      continue;
    }
    const claimed = await claimDispatchForSubmission(deps.prisma, dispatch.id, deps.now());
    if (!claimed) {
      tally.lost += 1;
      continue;
    }
    const outcome = await applyOutcome(deps, dispatch, adapter);
    tally[outcome] += 1;
  }
  deps.logger.info('refund dispatch sweep completed', { provider: adapter.provider, ...tally });
  return { mode: config.state, queue, adopted, ...tally };
}
