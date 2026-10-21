// The Action Plan can name GEO-VIS-009, "AI answers differ from your site".
// That rule has no Issue rows — GEO findings are informational — so its chip
// must open the AI SEO / GEO section, where the summary shows it, and never an
// Issue Center filtered to nothing.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ActionPlanState, Dashboard, Scan } from './api';
import { ResultsScreen } from './Report';

const SCAN: Scan = {
  id: 'scan-geo',
  profileId: 'profile-1',
  plan: 'Basic',
  domain: 'https://smile.example',
  status: 'Completed',
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-mvp-0.1',
  progress: { completedModules: 2, totalModules: 2 },
  startedAt: '2026-10-20T00:00:00.000Z',
  completedAt: '2026-10-20T00:01:00.000Z',
  createdAt: '2026-10-20T00:00:00.000Z',
  modules: [],
};

const DASHBOARD: Dashboard = {
  scan: SCAN,
  overall: {
    verdict: 'ok',
    score: 90,
    weightedCoverage: 1,
    moduleWeights: [{ module: 'SEO', tariffWeight: 1, effectiveWeight: 1 }],
  },
  modules: [
    {
      module: 'AI SEO / GEO',
      status: 'Completed',
      statusReason: null,
      coverage: 1,
      score: null,
      applicableChecks: 3,
      completedApplicableChecks: 3,
      usableOutput: true,
      metadata: {
        providerVisibility: {
          answerDigest: {
            facts: {
              answersChecked: 3,
              differenceCount: 1,
              groups: [
                {
                  source: {
                    key: 'page:https://smile.example/prices',
                    kind: 'page',
                    label: 'Prices',
                    url: 'https://smile.example/prices',
                  },
                  differences: [
                    {
                      claim: 'Implants cost $2,000.',
                      providers: ['openai'],
                      answerQuote: 'implants from $2,000',
                      sourceQuote: 'Implants from $500.',
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    },
  ],
  geoObservations: [
    {
      purpose: 'discovery',
      question: 'Which clinics place implants in Kyiv?',
      status: 'answered',
      reason: null,
      provider: 'openai',
      modelId: 'gpt-5.6-luna',
      answer: 'Smile Clinic places implants from $2,000.',
      citations: [],
      mentions: { brand: 'mentioned', domain: 'not-mentioned' },
    },
  ],
};

const PLAN_STATE: ActionPlanState = {
  scanId: SCAN.id,
  languages: ['en'],
  running: null,
  lastFailure: null,
  remaining: { successes: 2, attempts: 5 },
  windowEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  plan: {
    language: 'en',
    overview: 'Two assistants describe your prices differently from your site.',
    actions: [
      {
        title: 'State your implant prices plainly',
        why: 'Assistants quote an older price.',
        steps: ['Put the current price on the prices page'],
        effort: 'small',
        ruleIds: ['GEO-VIS-009'],
        openIssues: 1,
        totalIssues: 1,
        settled: false,
      },
    ],
    reach: null,
    caveats: [],
    generatedAt: '2026-10-20T12:00:00.000Z',
    modelId: 'claude-opus-5',
    noticeVersion: 'action-plan-notice-v1',
  },
};

function envelope(data: unknown): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify({ success: true, data, error: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function stubApi(plan: ActionPlanState = PLAN_STATE): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const url = String(input);
      if (url.includes('/dashboard')) return envelope(DASHBOARD);
      if (url.includes('/action-plan')) return envelope(plan);
      if (url.includes('/issues/summary')) {
        return envelope({ total: 0, open: 0, bySeverity: {}, groups: [] });
      }
      return envelope(null);
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a GEO rule named by the Action Plan', () => {
  it('offers generation when GEO differences are the only findings', async () => {
    stubApi({ ...PLAN_STATE, languages: [], plan: null });
    render(
      <ResultsScreen
        scan={SCAN}
        language="en"
        onScan={() => {}}
        onIssues={() => {}}
        onReports={() => {}}
        onError={() => {}}
      />,
    );

    expect(await screen.findByRole('button', { name: 'Write the Action Plan' })).toBeEnabled();
    expect(screen.queryByText(/No open finding on this report can go into a plan/)).toBeNull();
    expect(screen.queryByText(/No open problems — nothing in this report/)).toBeNull();
  });

  it('opens the AI SEO / GEO section and its summary, not the Issue Center', async () => {
    stubApi();
    const opened: string[] = [];
    render(
      <ResultsScreen
        scan={SCAN}
        language="en"
        onScan={() => {}}
        onIssues={() => {}}
        onOpenProblem={(ruleId) => opened.push(ruleId)}
        onReports={() => {}}
        onError={() => {}}
      />,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'AI answers differ from your site' }),
    );

    expect(opened).toEqual([]);
    expect(await screen.findByText('What AI says about your business')).toBeTruthy();
    expect(screen.getByText('Implants cost $2,000.')).toBeTruthy();
    expect(screen.queryByText(/No open finding on this report can go into a plan/)).toBeNull();
  });
});
