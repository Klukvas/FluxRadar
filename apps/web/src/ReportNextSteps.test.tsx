// What the report's next-step blocks decide from the issue summary.
//
// The Action Plan block is told whether anything is left to plan, and the
// answer is not "are there open findings": Analytics findings are Google's data
// and never reach a provider, so a report whose only open findings are there is
// refused by the server (409 ACTION_PLAN_NOTHING_TO_PLAN). Asking the block
// directly cannot catch that — the mistake lives in what the report passes it.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReportNextSteps } from './ReportNextSteps';
import type { IssueRuleGroup, IssueSummary, Scan } from './api';

const SCAN: Scan = {
  id: 'scan-next-steps',
  profileId: 'profile-1',
  plan: 'Complete',
  domain: 'https://smile.example',
  status: 'Completed',
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-mvp-0.1',
  progress: { completedModules: 1, totalModules: 1 },
  startedAt: '2026-09-22T00:00:00.000Z',
  completedAt: '2026-09-22T00:01:00.000Z',
  createdAt: '2026-09-22T00:00:00.000Z',
  modules: [],
};

function groupOf(overrides: Partial<IssueRuleGroup> = {}): IssueRuleGroup {
  return {
    ruleId: 'SEO-TECH-001',
    module: 'SEO',
    severity: 'High',
    issues: 2,
    openIssues: 2,
    ...overrides,
  };
}

function summaryOf(groups: readonly IssueRuleGroup[]): IssueSummary {
  return {
    total: groups.reduce((sum, group) => sum + group.issues, 0),
    open: groups.reduce((sum, group) => sum + group.openIssues, 0),
    bySeverity: {},
    groups,
  };
}

/** Answers each of the three requests this component makes, by path. */
function stubFetch(summary: IssueSummary): void {
  const planState = {
    scanId: SCAN.id,
    languages: [],
    running: null,
    lastFailure: null,
    remaining: { successes: 3, attempts: 6 },
    // Far enough ahead that the Plan Window is open whenever this test runs.
    windowEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
    plan: null,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const { pathname } = new URL(String(input), 'http://localhost');
      const data = pathname.endsWith('/issues/summary')
        ? summary
        : pathname.endsWith('/action-plan')
          ? planState
          : null;
      return Promise.resolve(
        new Response(JSON.stringify({ success: true, data, error: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
}

function renderNextSteps() {
  return render(
    <ReportNextSteps
      scan={SCAN}
      language="en"
      onOpenProblem={() => {}}
      onAllProblems={() => {}}
      onUpgrade={() => {}}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ReportNextSteps → Action Plan', () => {
  it('offers the plan while an open finding outside Analytics is left', async () => {
    stubFetch(summaryOf([groupOf(), groupOf({ module: 'Analytics', ruleId: 'ANALYTICS-001' })]));
    renderNextSteps();

    expect(await screen.findByRole('button', { name: 'Write the Action Plan' })).toBeTruthy();
  });

  it('says there is nothing to plan when only Analytics findings are open', async () => {
    stubFetch(
      summaryOf([
        groupOf({ module: 'Analytics', ruleId: 'ANALYTICS-001' }),
        // Settled findings elsewhere: counted in `total`, not in what is open.
        groupOf({ ruleId: 'SEO-TECH-004', openIssues: 0 }),
      ]),
    );
    renderNextSteps();

    // The wording matters in this case specifically: FixFirst still lists the
    // open Analytics findings below, so the line may not call them settled.
    expect(
      await screen.findByText(
        'No open finding on this report can go into a plan — findings in the Analytics section come from your own Google data and are never part of one.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Write the Action Plan' })).toBeNull();
    expect(screen.queryByLabelText('Plan language')).toBeNull();
  });
});
