// The states an outbound refund submission can be in, and the only moves between
// them.
//
// A refund is a money write on a provider API with no idempotency key. That one
// fact decides the whole shape of this state machine:
//
//   * "Did it go through?" cannot be answered by trying again, so a submission
//     whose answer never arrived gets its own state — `uncertain` — and NOTHING
//     moves it automatically. Not the sweep, not a redelivery, not a restart.
//   * `submitting` is written BEFORE the request leaves. A process that dies
//     mid-call therefore leaves a row that says "a request may be in flight",
//     which an operator can act on, rather than a `requested` row the next sweep
//     would cheerfully send a second time.
//   * `settled` is only ever written from the provider's own report of the money
//     (its webhook), never inferred from a 200 on the submission. A 200 says the
//     return was created; the buyer's money arriving is a later, separate fact.

export const REFUND_DISPATCH_STATES = {
  /** Recorded, nothing sent. Where the manual policy leaves every refund. */
  requested: 'requested',
  /** A submission is in flight, or a process died while one was. */
  submitting: 'submitting',
  /** The provider accepted it and named its own return id. */
  submitted: 'submitted',
  /** The provider's own webhook later reported the money back. */
  settled: 'settled',
  /** An operator is handling this one outside the API. */
  manual: 'manual',
  /** No answer we can act on. May or may not have refunded the buyer. */
  uncertain: 'uncertain',
  /** The provider refused it outright and said so. No money moved. */
  failed: 'failed',
} as const;

export type RefundDispatchState =
  (typeof REFUND_DISPATCH_STATES)[keyof typeof REFUND_DISPATCH_STATES];

/** States the dispatcher may pick up. Deliberately one. */
export const DISPATCHABLE_STATES: readonly RefundDispatchState[] = [
  REFUND_DISPATCH_STATES.requested,
];

/**
 * States that need a person.
 *
 * `submitting` is here because a row that stayed in it means the process that
 * owned the call is gone: whether the provider received the request is exactly
 * the question the operator has to settle, and the code must not guess.
 */
export const OPERATOR_STATES: readonly RefundDispatchState[] = [
  REFUND_DISPATCH_STATES.submitting,
  REFUND_DISPATCH_STATES.uncertain,
  REFUND_DISPATCH_STATES.failed,
  REFUND_DISPATCH_STATES.manual,
];

/** Nothing moves out of these. */
export const TERMINAL_STATES: readonly RefundDispatchState[] = [REFUND_DISPATCH_STATES.settled];

/** The stable logical key for one purchase's submission. */
export const refundDispatchKey = (purchaseId: string): string => `refund-dispatch:${purchaseId}`;

/**
 * Whether a state may be left for another, as a closed table.
 *
 * Written out rather than derived so that adding a state forces a decision about
 * every move into and out of it. An absent entry is "no".
 */
const ALLOWED_TRANSITIONS: Readonly<Record<RefundDispatchState, readonly RefundDispatchState[]>> = {
  requested: ['submitting', 'manual', 'settled'],
  // Only a person or the provider's own webhook leaves `submitting`.
  submitting: ['submitted', 'failed', 'uncertain', 'settled', 'manual'],
  submitted: ['settled', 'manual'],
  settled: [],
  // A manual dispatch can be handed back to the dispatcher by an operator.
  manual: ['requested', 'settled'],
  // Never back to `requested`: that would be an automatic second money write.
  uncertain: ['settled', 'manual'],
  failed: ['manual', 'requested', 'settled'],
};

/**
 * Whether a stored string is one of the states this release knows.
 *
 * `RefundDispatch.state` is a plain column with no CHECK constraint behind it,
 * so a row written by a later release — or corrupted by hand — can hold anything.
 * Callers ask this instead of casting, because the one place that must not throw
 * on a surprising value is the inbound webhook: it runs in a transaction, and a
 * `TypeError` there fails the provider's own report of the money.
 */
export function isRefundDispatchState(value: string): value is RefundDispatchState {
  return Object.hasOwn(ALLOWED_TRANSITIONS, value);
}

export function canTransition(from: string, to: RefundDispatchState): boolean {
  // An unknown `from` is a refused transition, not an exception: nothing may be
  // moved out of a state whose meaning this release does not know.
  return (ALLOWED_TRANSITIONS[from as RefundDispatchState] ?? []).includes(to);
}
