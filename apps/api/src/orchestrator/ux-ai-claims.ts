// What the UX AI review produced once the claims the evidence cannot back are
// removed (`packages/ai/src/ux-module.ts`).
//
// The adapter returns both halves — the findings a report may show, and the ones
// it rejected. Reading only the first half is how a review whose every claim was
// rejected reached the screen as a `Completed` section with no findings, which
// reads as "the AI looked and found nothing wrong". It looked and produced
// nothing usable, and those are different facts about a paid stage.
//
// Deliberately free of the module's own types so the check list, the coverage
// proof and the module row can all read it without importing each other.

import type { UnsupportedClaimReason, UnsupportedUxClaim, UxAiFinding } from '@fluxradar/ai';

/** The part of the AI phase this judgement needs. */
export interface UxAiClaimsInput {
  readonly outcome: { readonly kind: string } | null;
  readonly findings: readonly UxAiFinding[];
  readonly unsupportedClaims?: readonly UnsupportedUxClaim[];
}

export interface UxAiReviewOutcome {
  /** The provider answered and the answer parsed. */
  readonly answered: boolean;
  /**
   * The review can be reported as a completed check: it answered, and it did not
   * spend its whole answer on claims that were dropped.
   */
  readonly verified: boolean;
  /** Every finding the provider sent was rejected — the review yielded nothing. */
  readonly rejectedOnly: boolean;
  /** How many findings were dropped; 0 on every path that produced none. */
  readonly rejectedFindings: number;
  /**
   * The AI rules that produced only rejected findings.
   *
   * Such a rule is not "passed": nothing it returned survived. It is left out of
   * the check list and out of the §14 coverage proof for the same reason a review
   * that never ran is — a rule that produced no usable verdict must not let the
   * next scan close a finding, and must not be shown as a clean result.
   */
  readonly rejectedRuleIds: readonly string[];
  /**
   * Every page whose verdict was dropped, with the rule that produced it —
   * including a rule that also produced a surviving finding somewhere else.
   *
   * `rejectedRuleIds` cannot carry this: a rule with one usable finding on page
   * A and a dropped claim on page B is deliberately absent from that list,
   * because its surviving finding must stay in the report. But page B still has
   * no verdict this scan may be held to, and the §14 coverage proof used to
   * certify every page of such a rule — which is how the next scan could close a
   * previous finding on B with a verdict that was thrown away.
   *
   * Targets are the provider's own page URLs, unnormalized: the consumer that
   * compares them with issue targets owns the normalization (`ux.ts`).
   */
  readonly rejectedTargets: readonly RejectedClaimTarget[];
  /** Which classes of claim were dropped, first seen first, without duplicates. */
  readonly rejectedReasons: readonly UnsupportedClaimReason[];
}

/** One dropped verdict, as the pair the coverage proof reasons about. */
export interface RejectedClaimTarget {
  readonly ruleId: string;
  readonly targetUrl: string;
}

export function uxAiReviewOutcome(ai: UxAiClaimsInput): UxAiReviewOutcome {
  const answered = ai.outcome?.kind === 'response';
  const rejected = ai.unsupportedClaims ?? [];
  const supportedRuleIds = new Set(ai.findings.map((finding) => finding.ruleId));
  const rejectedRuleIds = [
    ...new Set(
      rejected
        .map((claim) => claim.finding.ruleId)
        .filter((ruleId) => !supportedRuleIds.has(ruleId)),
    ),
  ];
  const rejectedOnly = answered && rejected.length > 0 && ai.findings.length === 0;
  return {
    answered,
    verified: answered && !rejectedOnly,
    rejectedOnly,
    rejectedFindings: rejected.length,
    rejectedRuleIds,
    rejectedTargets: rejected.map((claim) => ({
      ruleId: claim.finding.ruleId,
      targetUrl: claim.finding.targetUrl,
    })),
    rejectedReasons: [...new Set(rejected.map((claim) => claim.reason))],
  };
}
