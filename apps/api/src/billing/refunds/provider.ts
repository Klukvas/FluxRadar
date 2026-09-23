// The provider-neutral shape of one outbound refund.
//
// FluxRadar's refund policy is its own (§18: four reason codes, one refund per
// purchase, decided from the scan's outcome). What a provider calls it — a
// "return" at FastSpring, a "refund" elsewhere — belongs to the adapter, and so
// does every field name in its payload. Everything above this seam speaks only
// the vocabulary below, which is what makes the stored state readable after a
// provider change and what keeps the state machine free of FastSpring's spelling.
//
// THE THREE OUTCOMES ARE NOT INTERCHANGEABLE, and the middle one is the reason
// this type exists:
//
//   submitted — the provider accepted the request and named its own id. The money
//               is its problem now; its webhook will report the settlement.
//   refused   — the provider declined, on the merits, and said why. No money
//               moved, and sending the same request again would be declined
//               again. Safe to leave for a person.
//   uncertain — we do not know. A timeout, a 5xx, a body that did not parse. The
//               buyer may or may not have been refunded. Retrying is a second
//               money write with no idempotency key to protect it, so nothing
//               retries this.

/** What FluxRadar asks a provider to return, in FluxRadar's own terms. */
export interface RefundSubmission {
  /** The provider's identifier for the order being returned. */
  readonly providerOrderId: string;
  /** The whole charge, in the currency the provider states it in. */
  readonly amountUsd: number;
  readonly currency: string;
  /** FluxRadar's own reason code (§18), not the provider's vocabulary. */
  readonly reasonCode: string;
  /** Stable key for this submission, for a provider that can use one. */
  readonly idempotencyKey: string;
}

export type RefundSubmissionOutcome =
  | {
      readonly outcome: 'submitted';
      /** The provider's own id for the return it created. */
      readonly providerRefundId: string;
      /** The provider's human reference, when it states one. */
      readonly providerReference: string | null;
      /**
       * Whether the provider says the return is already complete. It is recorded
       * and never treated as settlement: the money is confirmed by the webhook.
       */
      readonly completedByProvider: boolean;
      /**
       * The provider's own reason code the submission carried. Stored verbatim so
       * a refund can be reconciled against the provider's console afterwards.
       */
      readonly providerReasonCode: string;
    }
  | { readonly outcome: 'refused'; readonly reason: string }
  | { readonly outcome: 'uncertain'; readonly reason: string };

export interface RefundProviderAdapter {
  /** The provider name stored on the dispatch row, e.g. `fastspring`. */
  readonly provider: string;
  /**
   * Submits one refund. Must not throw: every failure is one of the outcomes
   * above, because "the adapter threw" tells the state machine nothing about
   * whether money moved.
   */
  submit(submission: RefundSubmission): Promise<RefundSubmissionOutcome>;
}
