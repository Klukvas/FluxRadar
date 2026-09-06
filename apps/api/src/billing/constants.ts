// Internal status literals shared by the billing services. Scan/module status
// values come from @fluxradar/contracts; these are the free-form statusReason
// strings and queue constants that the state machine writes.

export const STATUS_REASONS = {
  /** Pending → Cancelled by the user before queueing: 100% refund branch (§18). */
  preQueueCancel: 'UserCancelledPreQueue',
  /** Queued → Cancelled: stop after queueing, no automatic refund (§18). */
  postQueueCancel: 'UserCancelledAfterQueue',
  /** Running → Cancelled: the run counts as used, no automatic refund (§18). */
  midRunCancel: 'UserCancelledAfterStart',
  /** Failed with zero usable modules after the allowed retry (§18, D-026/D-027). */
  noUsableOutput: 'NoUsableOutput',
  /** Partial: at least one module lost to an external failure (§18). */
  externalModuleFailure: 'ExternalModuleFailure',
  /** Partial: modules usable but not all applicable checks are closed (§18). */
  incompleteChecks: 'IncompleteChecks',
} as const;

export const JOB_TYPES = { scan: 'scan' } as const;

export const JOB_STATUSES = {
  pending: 'Pending',
  claimed: 'Claimed',
  done: 'Done',
} as const;

export const PURCHASE_STATUSES = {
  paid: 'paid',
  refunded: 'Refunded',
  disputed: 'Disputed',
} as const;

/**
 * Why paid checkout is switched off, as a closed set the browser may see.
 *
 * The full explanation — which FASTSPRING_* variables are absent, what the
 * provider objected to — names how this deployment is wired and stays in the
 * server log. A client gets one of these two codes and writes its own sentence:
 * enough to tell "payments were never switched on here" from "switched on and
 * broken", and nothing an attacker probing the checkout could act on.
 */
export const CHECKOUT_UNAVAILABLE_REASONS = {
  /** No provider variable is set at all: this deployment does not sell scans. */
  notConfigured: 'not_configured',
  /** Set, but not usably so. An operator problem, not a buyer problem. */
  misconfigured: 'misconfigured',
} as const;

export type CheckoutUnavailableReason =
  (typeof CHECKOUT_UNAVAILABLE_REASONS)[keyof typeof CHECKOUT_UNAVAILABLE_REASONS];

/**
 * Lifecycle of a server-side checkout binding. `created` is the only state a
 * provider webhook may still act on; the other two are terminal.
 */
export const CHECKOUT_SESSION_STATUSES = {
  created: 'created',
  completed: 'completed',
  rejected: 'rejected',
} as const;

export const REFUND_STATUSES = {
  requested: 'requested',
  processing: 'processing',
  paid: 'paid',
  failed: 'failed',
} as const;

/**
 * Scope stored on webhook-created scans. The real scope arrives with the scan
 * request wired in T-12; the webhook itself only knows the plan (§18).
 */
export const DEFAULT_SCOPE_JSON = JSON.stringify({ includeSubdomains: false });

export const refundIdempotencyKey = (purchaseId: string): string => `refund:${purchaseId}`;
