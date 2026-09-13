import { ruleById } from '@fluxradar/contracts';
import { describe, expect, it } from 'vitest';

import { ruleCheckSummaries } from './rule-checks.ts';

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
