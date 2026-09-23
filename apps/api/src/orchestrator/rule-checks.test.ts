import type { UxAiResponseResult } from '@fluxradar/ai';
import { ruleById } from '@fluxradar/contracts';
import type { ModuleRunResult, UxStaticEvidence } from '@fluxradar/rules';
import { describe, expect, it } from 'vitest';

import { ruleCheckSummaries, uxRuleCheckSummaries } from './rule-checks.ts';

type UxAi = Pick<UxAiResponseResult, 'outcome' | 'findings'>;

/**
 * Three analysed pages, the first `pagesWithForms` of them carrying a form.
 *
 * The forms matter: the submit check counts the pages that have one, and that
 * same list is the proof of what it re-checked (uxRulePages).
 */
function uxEvidence(
  findings: UxStaticEvidence['findings'],
  pagesWithForms: number,
): UxStaticEvidence {
  return {
    pages: Array.from({ length: 3 }, (_unused, index) => ({
      url: `https://example.com/page-${index}`,
      forms: index < pagesWithForms ? ['form 1: 2 controls, 0 submit controls'] : [],
    })) as unknown as UxStaticEvidence['pages'],
    findings,
    summary: {
      pagesAnalyzed: 3,
      pagesWithActions: 3,
      pagesWithForms,
      pagesWithContactSignals: 0,
      pagesWithHeadings: 2,
    },
    limitation: 'static-html-only',
  };
}

function staticFinding(
  ruleId: UxStaticEvidence['findings'][number]['ruleId'],
  targetUrl: string,
): UxStaticEvidence['findings'][number] {
  return { ruleId, targetUrl, severity: 'Low', evidence: '', recommendation: '', confidence: 1 };
}

describe('UX/Conversion check summaries', () => {
  it('counts each static check on the pages it can look at', () => {
    const summaries = uxRuleCheckSummaries(
      uxEvidence(
        [
          staticFinding('UX-CONV-STATIC-001', 'https://example.com/'),
          // Two forms without a submit button on one page are one affected page.
          staticFinding('UX-CONV-STATIC-003', 'https://example.com/contact'),
          staticFinding('UX-CONV-STATIC-003', 'https://example.com/contact'),
        ],
        2,
      ),
      { outcome: { kind: 'unavailable' }, findings: [] } as unknown as UxAi,
    );

    expect(
      summaries.map(({ ruleId, applicableTargets, affectedTargets }) => ({
        ruleId,
        applicableTargets,
        affectedTargets,
      })),
    ).toEqual([
      { ruleId: 'UX-CONV-STATIC-001', applicableTargets: 1, affectedTargets: 1 },
      { ruleId: 'UX-CONV-STATIC-002', applicableTargets: 1, affectedTargets: 0 },
      { ruleId: 'UX-CONV-STATIC-003', applicableTargets: 2, affectedTargets: 1 },
    ]);
    // D-218: UX findings now cost the section's own score, so the list shows
    // them as issues rather than neutral observations.
    expect(summaries[0]).toMatchObject({
      title: ruleById('UX-CONV-STATIC-001')?.title,
      scoring: 'scored',
    });
  });

  it('lists the AI checks only when the provider answered', () => {
    const summaries = uxRuleCheckSummaries(uxEvidence([], 0), {
      outcome: { kind: 'response' },
      findings: [
        { ruleId: 'UX-CONV-AI-002', targetUrl: 'https://example.com/' },
        { ruleId: 'UX-CONV-AI-002', targetUrl: 'https://example.com/pricing' },
      ],
    } as unknown as UxAi);

    expect(summaries.slice(3)).toEqual([
      expect.objectContaining({
        ruleId: 'UX-CONV-AI-001',
        applicableTargets: 3,
        affectedTargets: 0,
      }),
      expect.objectContaining({
        ruleId: 'UX-CONV-AI-002',
        applicableTargets: 3,
        affectedTargets: 2,
      }),
      expect.objectContaining({
        ruleId: 'UX-CONV-AI-003',
        applicableTargets: 3,
        affectedTargets: 0,
      }),
    ]);
  });
});

// The report's module cards open a list of the checks a section ran. Totals on
// the module row could not say which checks those were, or which of them found
// something, so the row records one summary per evaluated rule.

/** A rule evaluation reduced to what the check list reads from it. */
function evaluation(
  ruleId: string,
  applicableTargets: number,
  affectedTargets: number,
): ModuleRunResult['evaluations'][number] {
  return {
    ruleId,
    applicableTargets,
    affectedTargets,
    findings: [],
    checkedTargets: [],
    inputTargets: [],
    requestedInputs: undefined,
  };
}

describe('rule check summaries', () => {
  it('records each evaluated rule with its registry title and its own counts', () => {
    const summaries = ruleCheckSummaries([
      evaluation('A11Y-001', 5, 2),
      evaluation('A11Y-011', 1, 0),
    ]);

    expect(summaries).toEqual([
      {
        ruleId: 'A11Y-001',
        title: ruleById('A11Y-001')?.title,
        targetKind: 'page',
        scoring: 'scored',
        applicableTargets: 5,
        affectedTargets: 2,
      },
      {
        ruleId: 'A11Y-011',
        title: ruleById('A11Y-011')?.title,
        targetKind: 'environment',
        scoring: 'informational',
        applicableTargets: 1,
        affectedTargets: 0,
      },
    ]);
  });

  it('keeps a rule that had nothing to look at, so the report can say so', () => {
    const [summary] = ruleCheckSummaries([evaluation('A11Y-004', 0, 0)]);

    expect(summary).toMatchObject({ ruleId: 'A11Y-004', applicableTargets: 0 });
  });

  it('refuses a rule the registry does not know rather than inventing a title', () => {
    expect(() => ruleCheckSummaries([evaluation('A11Y-999', 1, 0)])).toThrow(/A11Y-999/);
  });
});
