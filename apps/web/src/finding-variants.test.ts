// One problem's findings, folded: how many pages they are on and where they
// differ. The header rules put the same sentence on every page, so the fold is
// what tells an owner whether the list below is one fix or several.

import { describe, expect, it } from 'vitest';

import type { Issue } from './api';
import { findingEvidence, problemBreakdown } from './finding-variants';

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-1',
    scanId: 'scan-1',
    ruleId: 'SEC-PASSIVE-002',
    module: 'Security',
    fingerprint: 'fp-1',
    severity: 'Medium',
    category: 'http',
    status: 'New',
    targetUrl: 'https://shop.example.com/',
    evidenceType: 'http',
    evidenceRef: 'issue/issue-1',
    evidenceExcerpt: 'The HTML response is missing security headers (1): Referrer-Policy',
    recommendation: 'Send the missing headers with HTML responses.',
    confidence: 1,
    affectedTargets: 1,
    applicableTargets: 1,
    rulePenalty: 0,
    scoreDelta: 0,
    observedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('a finding’s evidence', () => {
  it('is the reader’s language when the API rendered one', () => {
    const rendered = issue({
      localized: {
        en: { evidenceExcerpt: 'missing: Referrer-Policy', recommendation: null },
        uk: { evidenceExcerpt: 'не вистачає: Referrer-Policy', recommendation: null },
      },
    });

    expect(findingEvidence(rendered, 'uk')).toBe('не вистачає: Referrer-Policy');
  });

  it('falls back to the stored text, and to null when there is none', () => {
    expect(findingEvidence(issue({ localized: null }), 'uk')).toBe(
      'The HTML response is missing security headers (1): Referrer-Policy',
    );
    expect(findingEvidence(issue({ evidenceExcerpt: null }), 'en')).toBeNull();
  });
});

describe('the breakdown of one problem’s loaded findings', () => {
  it('counts a page once however many findings it has', () => {
    const breakdown = problemBreakdown(
      [
        issue({ id: 'a', targetUrl: 'https://shop.example.com/', evidenceExcerpt: 'cookie sid' }),
        issue({ id: 'b', targetUrl: 'https://shop.example.com/', evidenceExcerpt: 'cookie cart' }),
        issue({
          id: 'c',
          targetUrl: 'https://shop.example.com/help',
          evidenceExcerpt: 'cookie sid',
        }),
      ],
      'en',
    );

    expect(breakdown.findings).toBe(3);
    expect(breakdown.pages).toBe(2);
  });

  it('folds identical evidence and puts the most common difference first', () => {
    const breakdown = problemBreakdown(
      [
        issue({ id: 'a', targetUrl: 'https://a.example/', evidenceExcerpt: 'missing: 1 header' }),
        issue({ id: 'b', targetUrl: 'https://b.example/', evidenceExcerpt: 'missing: 3 headers' }),
        issue({ id: 'c', targetUrl: 'https://c.example/', evidenceExcerpt: 'missing: 3 headers' }),
      ],
      'en',
    );

    expect(breakdown.variants).toEqual([
      { evidence: 'missing: 3 headers', findings: 2 },
      { evidence: 'missing: 1 header', findings: 1 },
    ]);
  });

  it('reads the variants in the report language, not the stored one', () => {
    const localized = (en: string, uk: string): Partial<Issue> => ({
      localized: {
        en: { evidenceExcerpt: en, recommendation: null },
        uk: { evidenceExcerpt: uk, recommendation: null },
      },
    });
    const issues = [
      issue({ id: 'a', targetUrl: 'https://a.example/', ...localized('no CSP', 'немає CSP') }),
      issue({ id: 'b', targetUrl: 'https://b.example/', ...localized('no CSP', 'немає CSP') }),
    ];

    expect(problemBreakdown(issues, 'uk').variants).toEqual([
      { evidence: 'немає CSP', findings: 2 },
    ]);
  });

  it('lists no variant for findings that carry no evidence at all', () => {
    const breakdown = problemBreakdown(
      [
        issue({ evidenceExcerpt: null, localized: null }),
        issue({ id: 'b', evidenceExcerpt: '  ' }),
      ],
      'en',
    );

    expect(breakdown.findings).toBe(2);
    expect(breakdown.variants).toEqual([]);
  });
});
