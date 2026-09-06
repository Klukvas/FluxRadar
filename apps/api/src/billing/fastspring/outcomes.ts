// What a single FastSpring event did, shared by the delivery handler and the
// return/chargeback handlers. Every outcome is stored on the WebhookEvent row so
// a delivery that granted nothing is still auditable.

export const WEBHOOK_OUTCOMES = {
  /** The event moved state forward. */
  processed: 'processed',
  /** Already seen (same event id, or the same order) — no second side effect. */
  deduplicated: 'deduplicated',
  /** Valid but not actionable here: unsupported type, or the other mode. */
  ignored: 'ignored',
  /** Actionable type whose payload failed validation — deliberately not retried. */
  rejected: 'rejected',
  /** Refund/chargeback that arrived before (or without) its order. */
  unlinked: 'unlinked',
} as const;

export type WebhookOutcome = (typeof WEBHOOK_OUTCOMES)[keyof typeof WEBHOOK_OUTCOMES];

export interface DispatchResult {
  readonly outcome: WebhookOutcome;
  readonly reason: string | null;
  readonly accountId: string | null;
  readonly orderId: string | null;
  readonly purchaseId: string | null;
  readonly entitlementId: string | null;
  readonly scanId: string | null;
}

export const NOTHING: DispatchResult = {
  outcome: WEBHOOK_OUTCOMES.ignored,
  reason: null,
  accountId: null,
  orderId: null,
  purchaseId: null,
  entitlementId: null,
  scanId: null,
};

export function rejected(orderId: string | null, reason: string): DispatchResult {
  return { ...NOTHING, outcome: WEBHOOK_OUTCOMES.rejected, orderId, reason };
}
