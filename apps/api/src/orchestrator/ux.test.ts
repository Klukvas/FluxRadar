import type { UxAiFinding } from '@fluxradar/ai';
import type { UxStaticEvidence } from '@fluxradar/rules';
import { describe, expect, it } from 'vitest';

import { scoredUxIssues } from './ux.ts';

// D-218: the UX/Conversion card read "No score" beside a list of checks that
// had found things. The section now scores its findings with the same §15
// formula as every other section, and stays outside the overall score.

const OBSERVED_AT = new Date('2026-09-18T10:00:00.000Z');
const DOMAIN = 'https://example.com';

function evidence(
  pageCount: number,
  findings: UxStaticEvidence['findings'] = [],
): UxStaticEvidence {
  return {
    pages: Array.from({ length: pageCount }, (_, index) => ({
      url: `https://example.com/page-${index}`,
    })) as unknown as UxStaticEvidence['pages'],
    findings,
    summary: {
      pagesAnalyzed: pageCount,
      pagesWithActions: pageCount,
      pagesWithForms: 0,
      pagesWithContactSignals: 0,
      pagesWithHeadings: pageCount,
    },
    limitation: 'static-html-only',
  };
}

function aiFinding(
  ruleId: UxAiFinding['ruleId'],
  targetUrl: string,
  severity: UxAiFinding['severity'],
): UxAiFinding {
  return {
    ruleId,
    targetUrl,
    severity,
    evidence: 'The offer is not stated above the fold.',
    recommendation: 'State the offer in the first screen.',
    confidence: 0.8,
  };
}

describe('the UX/Conversion score', () => {
  it('is 100 when no check found anything', () => {
    const result = scoredUxIssues('scan-1', DOMAIN, evidence(12), [], OBSERVED_AT);

    expect(result).toEqual({ score: 100, issueRows: [] });
  });

  it('charges a static entry-page finding its full weight', () => {
    const result = scoredUxIssues(
      'scan-1',
      DOMAIN,
      evidence(12, [
        {
          ruleId: 'UX-CONV-STATIC-001',
          targetUrl: 'https://example.com/',
          severity: 'Medium',
          evidence: 'No h1.',
          recommendation: 'Add an h1.',
          confidence: 1,
        },
      ]),
      [],
      OBSERVED_AT,
    );

    expect(result.score).toBe(97);
    expect(result.issueRows).toEqual([
      expect.objectContaining({
        ruleId: 'UX-CONV-STATIC-001',
        applicableTargets: 1,
        affectedTargets: 1,
        rulePenalty: 3,
        scoreDelta: -3,
      }),
    ]);
  });

  it('charges an AI rule its highest grade times the share of pages it flagged', () => {
    const result = scoredUxIssues(
      'scan-1',
      DOMAIN,
      evidence(12),
      [
        aiFinding('UX-CONV-AI-003', 'https://example.com/page-1', 'Medium'),
        aiFinding('UX-CONV-AI-003', 'https://example.com/page-2', 'High'),
        aiFinding('UX-CONV-AI-003', 'https://example.com/page-3', 'Low'),
      ],
      OBSERVED_AT,
    );

    // High (10) × 3 of 12 pages = 2.5.
    expect(result.score).toBe(97.5);
    // D-016: every row of the rule carries the rule's own aggregates and penalty,
    // so an export can recompute the penalty from any one of them.
    expect(result.issueRows).toHaveLength(3);
    for (const row of result.issueRows) {
      expect(row).toMatchObject({
        applicableTargets: 12,
        affectedTargets: 3,
        rulePenalty: 2.5,
        scoreDelta: -2.5,
      });
    }
  });

  it('adds the rules together', () => {
    const result = scoredUxIssues(
      'scan-1',
      DOMAIN,
      evidence(4),
      [
        aiFinding('UX-CONV-AI-001', 'https://example.com/page-0', 'High'),
        aiFinding('UX-CONV-AI-002', 'https://example.com/page-0', 'Medium'),
        aiFinding('UX-CONV-AI-002', 'https://example.com/page-1', 'Medium'),
      ],
      OBSERVED_AT,
    );

    // AI-001: 10 × 1/4 = 2.5; AI-002: 3 × 2/4 = 1.5.
    expect(result.score).toBe(96);
  });
});
