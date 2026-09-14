import type { UxAiResponseResult } from '@fluxradar/ai';
import { ruleById } from '@fluxradar/contracts';
import type { UxStaticEvidence } from '@fluxradar/rules';
import { describe, expect, it } from 'vitest';

import { ruleCheckSummaries, uxRuleCheckSummaries } from './rule-checks.ts';

type UxAi = Pick<UxAiResponseResult, 'outcome' | 'findings'>;

/** Three analysed pages; only their count matters to the summaries. */
function uxEvidence(
  findings: UxStaticEvidence['findings'],
  pagesWithForms: number,
): UxStaticEvidence {
  return {
    pages: Array.from({ length: 3 }, () => ({})) as unknown as UxStaticEvidence['pages'],
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
    expect(summaries[0]).toMatchObject({
      title: ruleById('UX-CONV-STATIC-001')?.title,
      scoring: 'informational',
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

describe('rule check summaries', () => {
  it('records each evaluated rule with its registry title and its own counts', () => {
    const summaries = ruleCheckSummaries([
      { ruleId: 'A11Y-001', applicableTargets: 5, affectedTargets: 2, findings: [] },
      { ruleId: 'A11Y-011', applicableTargets: 1, affectedTargets: 0, findings: [] },
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
    const [summary] = ruleCheckSummaries([
      { ruleId: 'A11Y-004', applicableTargets: 0, affectedTargets: 0, findings: [] },
    ]);

    expect(summary).toMatchObject({ ruleId: 'A11Y-004', applicableTargets: 0 });
  });

  it('refuses a rule the registry does not know rather than inventing a title', () => {
    expect(() =>
      ruleCheckSummaries([
        { ruleId: 'A11Y-999', applicableTargets: 1, affectedTargets: 0, findings: [] },
      ]),
    ).toThrow(/A11Y-999/);
  });
});
