import { describe, expect, it } from 'vitest';

import { geoChecksOf, ruleCheckResult, ruleChecksOf, type RuleCheck } from './module-metadata';

// Module metadata is stored JSON whose shape grew between releases, so these
// readers must turn an old or malformed row into "less to show" — never a throw,
// and never a check the audit did not record.

function check(overrides: Partial<RuleCheck> = {}): RuleCheck {
  return {
    ruleId: 'A11Y-001',
    title: 'text contrast',
    targetKind: 'page',
    informational: false,
    applicableTargets: 3,
    affectedTargets: 0,
    ...overrides,
  };
}

describe('ruleChecksOf', () => {
  it('reads the recorded checks and drops entries it cannot trust', () => {
    const checks = ruleChecksOf({
      ruleChecks: [
        {
          ruleId: 'A11Y-001',
          title: 'text contrast',
          targetKind: 'page',
          scoring: 'scored',
          applicableTargets: 3,
          affectedTargets: 1,
        },
        {
          ruleId: 'A11Y-011',
          title: 'audit transparency',
          targetKind: 'environment',
          scoring: 'informational',
          applicableTargets: 1,
          affectedTargets: 0,
        },
        { ruleId: 'A11Y-002', title: 'alt text', applicableTargets: '3', affectedTargets: 0 },
        null,
        'A11Y-003',
      ],
    });

    expect(checks).toEqual([
      check({ affectedTargets: 1 }),
      check({
        ruleId: 'A11Y-011',
        title: 'audit transparency',
        targetKind: 'environment',
        informational: true,
        applicableTargets: 1,
      }),
    ]);
  });

  it('is empty for a row recorded before checks were stored', () => {
    expect(ruleChecksOf(undefined)).toEqual([]);
    expect(ruleChecksOf({ standard: 'WCAG 2.2 AA' })).toEqual([]);
  });
});

describe('ruleCheckResult', () => {
  it('never calls a check with nothing to look at a pass', () => {
    expect(ruleCheckResult(check({ applicableTargets: 0 }))).toBe('notApplicable');
  });

  it('separates a clean check from one that found something', () => {
    expect(ruleCheckResult(check())).toBe('passed');
    expect(ruleCheckResult(check({ affectedTargets: 2 }))).toBe('issues');
  });

  it('reports what an informational rule found as a note, not an issue', () => {
    expect(ruleCheckResult(check({ informational: true, affectedTargets: 1 }))).toBe('noted');
  });
});

describe('geoChecksOf', () => {
  it('is null for a section that recorded none of its checks', () => {
    expect(geoChecksOf(undefined)).toBeNull();
    expect(geoChecksOf({ standard: 'AI crawler readiness' })).toBeNull();
  });

  it('reads crawler access, page readiness and the generated questions', () => {
    const checks = geoChecksOf({
      robots: {
        status: 'available',
        agents: [
          { userAgent: 'GPTBot', status: 'allowed' },
          { userAgent: 'ClaudeBot', status: 'sometimes' },
        ],
      },
      pages: { checked: 4, extractableContent: 3, structuredData: 1, socialPreview: 0, checks: [] },
      providerVisibility: {
        queryGeneration: {
          status: 'Completed',
          generatedQuestions: ['Which clinics offer implants?', 7],
        },
      },
    });

    expect(checks).toEqual({
      robotsReadable: true,
      crawlers: [{ userAgent: 'GPTBot', status: 'allowed' }],
      pages: { checked: 4, extractableContent: 3, structuredData: 1, socialPreview: 0 },
      queryGeneration: { status: 'Completed', questions: ['Which clinics offer implants?'] },
    });
  });

  it('does not treat an unreadable robots.txt as readable', () => {
    expect(geoChecksOf({ robots: { status: 'unavailable', agents: [] } })).toMatchObject({
      robotsReadable: false,
      pages: null,
      queryGeneration: null,
    });
  });
});
