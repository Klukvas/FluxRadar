// The printable client report carries the Action Plan; JSON and CSV never do.
//
// The plan is AI's opinion and changes when it is rewritten, so it is not a
// canonical record (D-232). It belongs in the document a buyer hands over, and
// nowhere in the export contract.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ActionPlanState, Dashboard, Scan } from './api';
import { PrintReport } from './PrintReport';

const SCAN: Scan = {
  id: 'scan-print',
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

const DASHBOARD: Dashboard = {
  scan: SCAN,
  overall: { verdict: 'ok', score: 90, weightedCoverage: 1, moduleWeights: [] },
  modules: [],
  geoObservations: [],
};

const PLAN_STATE: ActionPlanState = {
  scanId: SCAN.id,
  languages: ['en'],
  running: null,
  lastFailure: null,
  remaining: { successes: 2, attempts: 5 },
  windowEndsAt: '2026-09-25T00:01:00.000Z',
  plan: {
    language: 'en',
    overview: 'Search engines cannot read your site’s basic instructions yet.',
    actions: [
      {
        title: 'Publish a robots.txt',
        why: 'Without it, crawlers guess what they may read.',
        steps: ['Create /robots.txt'],
        effort: 'small',
        ruleIds: ['SEO-TECH-001'],
        openIssues: 2,
        totalIssues: 3,
        settled: false,
      },
    ],
    reach: { share: 0.5, addressedOpenIssues: 2, totalOpenIssues: 4, rules: 1 },
    caveats: [],
    generatedAt: '2026-09-22T12:00:00.000Z',
    modelId: 'claude-opus-5',
    noticeVersion: 'core-ai-processing-notice-v4',
  },
};

function envelope(data: unknown, meta?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ success: true, data, error: null, ...(meta ?? {}) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(planResponse: () => Response): { paths: string[] } {
  const paths: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const path = String(input);
      paths.push(path);
      if (path.includes('/action-plan')) return Promise.resolve(planResponse());
      if (path.includes('/issues/summary')) {
        return Promise.resolve(envelope({ total: 0, open: 0, bySeverity: {}, groups: [] }));
      }
      if (path.includes('/issues')) {
        return Promise.resolve(envelope([], { meta: { total: 0, page: 1, limit: 100 } }));
      }
      return Promise.resolve(envelope(DASHBOARD));
    }),
  );
  return { paths };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the printable report and the Action Plan', () => {
  it('includes the plan, its Actions and its AI label', async () => {
    const { paths } = stubFetch(() => envelope(PLAN_STATE));
    render(<PrintReport scanId={SCAN.id} language="en" onBack={() => {}} onError={() => {}} />);

    expect(await screen.findByText(/Search engines cannot read/)).toBeTruthy();
    expect(screen.getByText('Publish a robots.txt')).toBeTruthy();
    expect(screen.getByText('(AI-generated)')).toBeTruthy();
    expect(paths.some((path) => path.includes('/action-plan?language=en'))).toBe(true);
  });

  it('prints the document without a plan when there is none, or the request fails', async () => {
    stubFetch(() => envelope({ ...PLAN_STATE, plan: null }));
    render(<PrintReport scanId={SCAN.id} language="en" onBack={() => {}} onError={() => {}} />);

    await screen.findByRole('button', { name: 'Print or save as PDF' });
    await waitFor(() => expect(screen.queryByText('AI Action Plan')).toBeNull());
  });

  it('treats an unrecognised response as no plan rather than an empty one', async () => {
    // A dashboard object is what a stale route or a broad test mock answers.
    stubFetch(() => envelope(DASHBOARD));
    render(<PrintReport scanId={SCAN.id} language="en" onBack={() => {}} onError={() => {}} />);

    await screen.findByRole('button', { name: 'Print or save as PDF' });
    await waitFor(() => expect(screen.queryByText('AI Action Plan')).toBeNull());
  });

  it('asks for the plan language the link requested', async () => {
    const { paths } = stubFetch(() => envelope(PLAN_STATE));
    render(
      <PrintReport
        scanId={SCAN.id}
        language="en"
        planLanguage="uk"
        onBack={() => {}}
        onError={() => {}}
      />,
    );

    await screen.findByRole('button', { name: 'Print or save as PDF' });
    await waitFor(() =>
      expect(paths.some((path) => path.includes('/action-plan?language=uk'))).toBe(true),
    );
  });
});
