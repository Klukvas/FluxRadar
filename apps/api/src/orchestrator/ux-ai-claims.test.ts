// The §14 proof of an AI review that lost part of its answer.
//
// The defect this file pins: a rule that produced one usable finding and one
// rejected claim is deliberately absent from `rejectedRuleIds` — its surviving
// finding belongs in the report — and the coverage proof therefore certified
// EVERY page of that rule as re-checked, including the page whose verdict was
// thrown away. The next scan of the same plan reads that proof and closes a
// previous finding on that page as fixed.

import type { UnsupportedUxClaim, UxAiFinding } from '@fluxradar/ai';
import type { UxStaticEvidence } from '@fluxradar/rules';
import { describe, expect, it } from 'vitest';

import { uxAiReviewOutcome } from './ux-ai-claims.ts';
import { uxRuleCoverage, type UxAiPhase } from './ux.ts';

const HOME = 'https://example.com/';
const PRICING = 'https://example.com/pricing';

function evidence(urls: readonly string[]): UxStaticEvidence {
  return {
    // `forms` is read by the submit check's page list; the rest of a page's
    // evidence plays no part in coverage.
    pages: urls.map((url) => ({ url, forms: [] })) as unknown as UxStaticEvidence['pages'],
    findings: [],
    summary: {
      pagesAnalyzed: urls.length,
      pagesWithActions: urls.length,
      pagesWithForms: 0,
      pagesWithContactSignals: 0,
      pagesWithHeadings: urls.length,
    },
    limitation: 'static-html-only',
  };
}

function aiFinding(ruleId: UxAiFinding['ruleId'], targetUrl: string): UxAiFinding {
  return {
    ruleId,
    targetUrl,
    severity: 'Medium',
    evidence: 'The first heading names the company but not what it sells.',
    recommendation: 'Name the offering in the first heading.',
    confidence: 0.7,
  };
}

function rejectedClaim(ruleId: UxAiFinding['ruleId'], targetUrl: string): UnsupportedUxClaim {
  return { finding: aiFinding(ruleId, targetUrl), reason: 'visual-hierarchy' };
}

function answeredPhase(
  findings: readonly UxAiFinding[],
  unsupportedClaims: readonly UnsupportedUxClaim[],
): UxAiPhase {
  return {
    status: 'Completed',
    statusReason: null,
    // Only `outcome.kind` is read here; the rest of the adapter result is not
    // part of the judgement under test.
    outcome: { kind: 'response' },
    findings,
    unsupportedClaims,
  } as unknown as UxAiPhase;
}

function checkedTargetsOf(phase: UxAiPhase, ruleId: string): readonly string[] {
  const coverage = uxRuleCoverage({ staticEvidence: evidence([HOME, PRICING]), ai: phase });
  return coverage.find((rule) => rule.ruleId === ruleId)?.checkedTargets ?? [];
}

describe('a rule that lost some of its claims', () => {
  const phase = answeredPhase(
    [aiFinding('UX-CONV-AI-003', HOME)],
    [rejectedClaim('UX-CONV-AI-003', PRICING)],
  );

  it('keeps the page it judged out of the proof only for the page it lost', () => {
    expect(checkedTargetsOf(phase, 'UX-CONV-AI-003')).toEqual([HOME]);
  });

  it('stays out of rejectedRuleIds so its surviving finding is still reported', () => {
    const review = uxAiReviewOutcome(phase);

    expect(review.rejectedRuleIds).toEqual([]);
    expect(review.verified).toBe(true);
    expect(review.rejectedTargets).toEqual([{ ruleId: 'UX-CONV-AI-003', targetUrl: PRICING }]);
  });

  it('does not narrow the proof of the AI rules that answered cleanly', () => {
    expect(checkedTargetsOf(phase, 'UX-CONV-AI-001')).toEqual([HOME, PRICING]);
  });
});

describe('the coverage of an AI rule', () => {
  it('is the whole page set when nothing was rejected', () => {
    const phase = answeredPhase([aiFinding('UX-CONV-AI-001', HOME)], []);

    expect(checkedTargetsOf(phase, 'UX-CONV-AI-001')).toEqual([HOME, PRICING]);
  });

  it('is empty for a rule whose every claim was rejected', () => {
    const phase = answeredPhase(
      [aiFinding('UX-CONV-AI-001', HOME)],
      [rejectedClaim('UX-CONV-AI-002', HOME), rejectedClaim('UX-CONV-AI-002', PRICING)],
    );

    expect(checkedTargetsOf(phase, 'UX-CONV-AI-002')).toEqual([]);
    expect(uxAiReviewOutcome(phase).rejectedRuleIds).toEqual(['UX-CONV-AI-002']);
  });

  it('is empty for every AI rule when the review lost its whole answer', () => {
    const phase = answeredPhase([], [rejectedClaim('UX-CONV-AI-001', HOME)]);

    expect(checkedTargetsOf(phase, 'UX-CONV-AI-001')).toEqual([]);
    expect(checkedTargetsOf(phase, 'UX-CONV-AI-003')).toEqual([]);
  });

  it('is empty when a dropped claim names a page the rule did not look at', () => {
    // Unreachable through the adapter, which accepts only a supplied page URL —
    // and the safe answer if it ever happens: an unaccounted verdict certifies
    // nothing rather than everything.
    const phase = answeredPhase(
      [aiFinding('UX-CONV-AI-003', HOME)],
      [rejectedClaim('UX-CONV-AI-003', 'https://example.com/gone')],
    );

    expect(checkedTargetsOf(phase, 'UX-CONV-AI-003')).toEqual([]);
  });

  it('is empty when a dropped claim is not a URL at all', () => {
    const phase = answeredPhase(
      [aiFinding('UX-CONV-AI-003', HOME)],
      [rejectedClaim('UX-CONV-AI-003', 'the pricing page')],
    );

    expect(checkedTargetsOf(phase, 'UX-CONV-AI-003')).toEqual([]);
  });
});
