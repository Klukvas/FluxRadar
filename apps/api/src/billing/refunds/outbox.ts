// The stored side of an outbound refund: one row per purchase, and every move
// between its states written as a compare-and-set.
//
// WHY CAS EVERYWHERE. Two API processes run the same sweep, and a redelivered
// webhook can arrive while one of them is mid-submission. `update` by id would
// let the slower writer overwrite the faster one's conclusion — the worst case
// being a row that says `requested` again after a submission left, which the next
// sweep would send a second time. So every write states the state it expects to
// find, and `updateMany` reporting zero rows changed is a normal, meaningful
// answer: somebody else got there first, and this caller does nothing.
//
// The row is also the duplicate guard. `purchaseId` and `idempotencyKey` are both
// unique, so a second dispatch for one purchase cannot exist however many times
// the refund decision is re-evaluated.

import type { Prisma, PrismaClient, RefundDispatch, RefundRecord } from '@prisma/client';

import { isUniqueViolation } from '../prisma-errors.ts';
import {
  REFUND_DISPATCH_STATES,
  canTransition,
  isRefundDispatchState,
  refundDispatchKey,
  type RefundDispatchState,
} from './states.ts';

type Db = PrismaClient | Prisma.TransactionClient;

/** Where a refund decision leaves its submission row when it is first recorded. */
export type InitialDispatchState =
  typeof REFUND_DISPATCH_STATES.requested | typeof REFUND_DISPATCH_STATES.manual;

export interface RecordDispatchInput {
  readonly record: RefundRecord;
  readonly initialState: InitialDispatchState;
  readonly stateReason: string | null;
  readonly now: Date;
}

/**
 * Records the submission row for a refund decision, or returns the existing one.
 *
 * It never changes a row that is already there: the first decision to be recorded
 * owns the state, and a later re-evaluation of the same purchase must not reset a
 * submission that has since gone out.
 */
export async function recordRefundDispatch(
  db: Db,
  input: RecordDispatchInput,
): Promise<RefundDispatch> {
  const { record } = input;
  try {
    return await db.refundDispatch.create({
      data: {
        refundRecordId: record.id,
        purchaseId: record.purchaseId,
        provider: record.provider,
        idempotencyKey: refundDispatchKey(record.purchaseId),
        state: input.initialState,
        stateReason: input.stateReason,
        amountUsd: record.amountUsd,
        currency: record.currency ?? 'USD',
        providerOrderId: record.providerTransactionId,
        requestedAt: input.now,
      },
    });
  } catch (error) {
    if (
      isUniqueViolation(error, 'purchaseId') ||
      isUniqueViolation(error, 'refundRecordId') ||
      isUniqueViolation(error, 'idempotencyKey')
    ) {
      const existing = await db.refundDispatch.findUnique({
        where: { purchaseId: record.purchaseId },
      });
      if (existing !== null) return existing;
    }
    throw error;
  }
}

/** One state change, refused unless the transition table allows it. */
interface TransitionInput {
  readonly id: string;
  readonly from: RefundDispatchState;
  readonly to: RefundDispatchState;
  readonly reason: string | null;
  readonly now: Date;
  readonly providerRefundId?: string | null;
  readonly providerReasonCode?: string | null;
  readonly resolvedBy?: string | null;
  /** Counts the attempt. Only the claim does this. */
  readonly countAttempt?: boolean;
}

/**
 * Applies one transition if the row is still in `from`.
 *
 * Returns false when it was not — which is how the caller learns that another
 * process owns this dispatch, and is the reason a losing sweep never submits.
 */
export async function transitionDispatch(db: Db, input: TransitionInput): Promise<boolean> {
  if (!canTransition(input.from, input.to)) {
    throw new Error(
      `refund dispatch may not move from ${input.from} to ${input.to}: see billing/refunds/states.ts`,
    );
  }
  const { count } = await db.refundDispatch.updateMany({
    where: { id: input.id, state: input.from },
    data: {
      state: input.to,
      stateReason: input.reason,
      ...(input.countAttempt === true ? { attempts: { increment: 1 } } : {}),
      ...(input.providerRefundId === undefined ? {} : { providerRefundId: input.providerRefundId }),
      ...(input.providerReasonCode === undefined
        ? {}
        : { providerReasonCode: input.providerReasonCode }),
      ...(input.resolvedBy === undefined ? {} : { resolvedBy: input.resolvedBy }),
      ...(input.to === REFUND_DISPATCH_STATES.submitted ? { submittedAt: input.now } : {}),
      ...(input.to === REFUND_DISPATCH_STATES.settled ? { settledAt: input.now } : {}),
    },
  });
  return count === 1;
}

/**
 * Takes ownership of a dispatch for one submission.
 *
 * `submitting` is written before the request leaves, so the row can always say
 * that a call may be in flight. Nothing puts it back: a process that dies here
 * leaves work for a person, which is the correct outcome for a money write with
 * no idempotency key.
 */
export function claimDispatchForSubmission(db: Db, id: string, now: Date): Promise<boolean> {
  return transitionDispatch(db, {
    id,
    from: REFUND_DISPATCH_STATES.requested,
    to: REFUND_DISPATCH_STATES.submitting,
    reason: 'submission in flight',
    now,
    countAttempt: true,
  });
}

/**
 * What a reconciliation attempt actually did.
 *
 * `unresolved` exists because the alternative was a lie: the old code reported
 * "already settled" whenever the compare-and-set matched no row, including when
 * the row had merely moved on to `submitting` between the read and the write.
 * The provider's settlement — the one fact only the webhook may write — was then
 * dropped with nothing said. A caller that gets `unresolved` has a row that
 * needs a person, and the observed state to put in the log line.
 */
export type DispatchReconciliation =
  | { readonly outcome: 'settled' }
  | { readonly outcome: 'already-settled' }
  | { readonly outcome: 'no-dispatch' }
  | {
      readonly outcome: 'unresolved';
      readonly observedState: string;
      readonly reason: 'lost-race' | 'transition-refused';
    };

/**
 * Attempts this many reads before giving up on a row another writer keeps
 * moving. Three is enough for the only real contention there is — one sweep
 * claiming the row while the webhook settles it — and small enough that a row
 * being rewritten in a loop is reported rather than spun on.
 */
const RECONCILE_ATTEMPTS = 3;

/**
 * Records the provider's own settlement of a refund.
 *
 * This is the ONLY writer of `settled`, and it is driven by the provider's report
 * of the money (its webhook), never by the response to our submission: a 200 says
 * a return was created, and the buyer's money arriving is a later fact.
 *
 * It also closes the loop for a submission whose answer never arrived — an
 * `uncertain` row that the provider then reports a return for was, in fact, sent.
 *
 * WHY IT RE-READS. The state is read, then written with a compare-and-set on
 * that state. Between the two, the dispatcher may have claimed the row
 * (`requested → submitting`). Losing that race is not "already settled": the
 * money came back and the row still says a submission is in flight. So the row
 * is read again and the settlement re-applied from whatever state it is now in,
 * which the transition table allows from every non-terminal one.
 */
export async function reconcileDispatchFromProviderRefund(
  db: Db,
  input: {
    readonly purchaseId: string;
    readonly providerRefundId: string;
    readonly now: Date;
    readonly reason: string;
  },
): Promise<DispatchReconciliation> {
  let observed = '';
  for (let attempt = 0; attempt < RECONCILE_ATTEMPTS; attempt += 1) {
    const dispatch = await db.refundDispatch.findUnique({
      where: { purchaseId: input.purchaseId },
    });
    if (dispatch === null) return { outcome: 'no-dispatch' };
    observed = dispatch.state;
    if (dispatch.state === REFUND_DISPATCH_STATES.settled) return { outcome: 'already-settled' };
    if (!canTransition(dispatch.state, REFUND_DISPATCH_STATES.settled)) {
      // An unknown or unmovable state. Refusing loudly is the only safe answer:
      // this function must never invent a settlement it could not write.
      return { outcome: 'unresolved', observedState: observed, reason: 'transition-refused' };
    }
    const moved = await transitionDispatch(db, {
      id: dispatch.id,
      from: dispatch.state as RefundDispatchState,
      to: REFUND_DISPATCH_STATES.settled,
      reason: input.reason,
      now: input.now,
      // The id the provider itself reported wins: for an `uncertain` row it is
      // the first identifier we have for the return, and for a `submitted` one
      // it confirms the id we stored.
      providerRefundId: input.providerRefundId,
    });
    if (moved) return { outcome: 'settled' };
  }
  return { outcome: 'unresolved', observedState: observed, reason: 'lost-race' };
}

/**
 * Records that the provider returned part of the charge.
 *
 * A partial return is not a settled dispatch — the rest of the money is still
 * owed — and it is also not something this code may finish: the remainder has to
 * be stated per product, in the order's currency, against what is still
 * returnable. So the row is handed to an operator with the figures in its reason.
 *
 * It also closes a real double-refund hole: a dispatch still in `requested` when
 * a return arrives from the provider's console is taken off the sweep's queue
 * instead of being sent on top of it.
 */
export async function notePartialProviderRefund(
  db: Db,
  input: { readonly purchaseId: string; readonly reason: string; readonly now: Date },
): Promise<
  | { readonly outcome: 'handed-to-operator' }
  | { readonly outcome: 'already-settled' }
  | { readonly outcome: 'no-dispatch' }
  | {
      readonly outcome: 'unresolved';
      readonly observedState: string;
      readonly reason: 'lost-race' | 'transition-refused';
    }
> {
  let observed = '';
  for (let attempt = 0; attempt < RECONCILE_ATTEMPTS; attempt += 1) {
    const dispatch = await db.refundDispatch.findUnique({
      where: { purchaseId: input.purchaseId },
    });
    if (dispatch === null) return { outcome: 'no-dispatch' };
    observed = dispatch.state;
    if (dispatch.state === REFUND_DISPATCH_STATES.settled) return { outcome: 'already-settled' };
    if (dispatch.state === REFUND_DISPATCH_STATES.manual) {
      // Already a person's to finish; only the figures in the reason are newer.
      const { count } = await db.refundDispatch.updateMany({
        where: { id: dispatch.id, state: REFUND_DISPATCH_STATES.manual },
        data: { stateReason: input.reason },
      });
      if (count === 1) return { outcome: 'handed-to-operator' };
      continue;
    }
    if (!canTransition(dispatch.state, REFUND_DISPATCH_STATES.manual)) {
      return { outcome: 'unresolved', observedState: observed, reason: 'transition-refused' };
    }
    // The result is checked, not discarded: a row that moved under us has not
    // been handed to anybody, and saying it was is how a partial return gets
    // lost between two writers.
    const moved = await transitionDispatch(db, {
      id: dispatch.id,
      from: dispatch.state as RefundDispatchState,
      to: REFUND_DISPATCH_STATES.manual,
      reason: input.reason,
      now: input.now,
    });
    if (moved) return { outcome: 'handed-to-operator' };
  }
  return { outcome: 'unresolved', observedState: observed, reason: 'lost-race' };
}

/**
 * An operator's decision on a dispatch the code refused to finish.
 *
 * The three answers are the three real ones: the money is back (`settled`), this
 * one is being handled outside the API (`manual`), or it has been checked in the
 * provider's console and genuinely never went out, so it may be queued again
 * (`requested`). Nothing here invents a settlement: passing `settled` is a person
 * stating that they saw the refund, and `resolvedBy` records who.
 */
export async function resolveRefundDispatch(
  db: Db,
  input: {
    readonly purchaseId: string;
    readonly resolution: 'settled' | 'manual' | 'requested';
    readonly resolvedBy: string;
    readonly note: string;
    readonly now: Date;
  },
): Promise<boolean> {
  const dispatch = await db.refundDispatch.findUnique({ where: { purchaseId: input.purchaseId } });
  if (dispatch === null) return false;
  // A state this release does not know is "did not move": there is no entry in
  // the transition table to decide by, and an operator action is not the place
  // to guess. A state it DOES know but may not leave still throws, because that
  // is the table refusing a move somebody explicitly asked for — `uncertain`
  // back into the queue is the one that would refund a buyer twice.
  if (!isRefundDispatchState(dispatch.state)) return false;
  return transitionDispatch(db, {
    id: dispatch.id,
    from: dispatch.state,
    to: REFUND_DISPATCH_STATES[input.resolution],
    reason: `${input.resolution} by ${input.resolvedBy}: ${input.note}`,
    now: input.now,
    resolvedBy: input.resolvedBy,
  });
}

/** How many dispatches are in each state, for the sweep's own log line. */
export async function refundDispatchQueue(db: Db): Promise<Readonly<Record<string, number>>> {
  const grouped = await db.refundDispatch.groupBy({ by: ['state'], _count: { _all: true } });
  return Object.fromEntries(grouped.map((row) => [row.state, row._count._all]));
}
