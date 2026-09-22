import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PrintReport } from './PrintReport';
import type { PlanLanguage } from './action-plan';
import type { Dashboard, Scan } from './api';

// The client report with its AI Action Plan (D-232): the plan follows the scan
// summary, labelled as AI-written, in the language the report showed. The
// JSON and CSV exports never carry it; only this document does.

const SCAN = {
  id: 'scan-print',
  profileId: 'profile-1',
  plan: 'Complete',
  domain: 'https://clinic.example',
  status: 'Completed',
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-mvp-0.1',
  progress: { completedModules: 1, totalModules: 1 },
  startedAt: '2026-09-21T10:00:00.000Z',
  completedAt: '2026-09-21T11:00:00.000Z',
  createdAt: '2026-09-21T10:00:00.000Z',
  modules: [],
} as Scan;

const DASHBOARD: Dashboard = {
  scan: SCAN,
  overall: {
    verdict: 'ok',
    score: 80,
    weightedCoverage: 1,
    moduleWeights: [{ module: 'SEO', tariffWeight: 1, effectiveWeight: 1 }],
  },
  modules: [],
  geoObservations: [],
};

const PLAN_STATE = {
  language: 'de',
  availability: 'available',
  languages: ['de'],
  run: null,
  lastFailure: null,
  remaining: { successes: 2, attempts: 5 },
  windowEndsAt: '2026-09-24T11:00:00.000Z',
  plan: {
    language: 'de',
    generatedAt: '2026-09-21T12:00:00.000Z',
    modelId: 'claude-opus-5',
    overview: 'Die Website funktioniert, sendet Suchmaschinen aber widersprüchliche Signale.',
    actions: [
      {
        title: 'Kanonische Adressen setzen',
        why: 'Suchmaschinen indexieren falsche Adressen.',
        steps: ['Den Canonical-Link im Seitentemplate setzen.'],
        effort: 'small',
        rules: [{ ruleId: 'SEO-TECH-004', openIssues: 2, totalIssues: 2 }],
        openIssues: 2,
        totalIssues: 2,
        settled: false,
      },
    ],
    reach: { addressed: 2, open: 2, rules: 1 },
    caveats: [],
  },
};

function envelope(data: unknown, status = 200): Response {
  const body =
    status < 400
      ? { success: true, data, error: null }
      : { success: false, data: null, error: { code: 'ACTION_PLAN_COMPLETE_ONLY', message: 'no' } };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockApi(actionPlan: () => Response) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/dashboard')) return Promise.resolve(envelope(DASHBOARD));
    if (url.pathname.endsWith('/issues/summary')) {
      return Promise.resolve(envelope({ total: 0, open: 0, bySeverity: {}, groups: [] }));
    }
    if (url.pathname.endsWith('/issues')) return Promise.resolve(envelope([]));
    if (url.pathname.endsWith('/action-plan')) return Promise.resolve(actionPlan());
    return Promise.resolve(envelope(null));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPrint(planLanguage: PlanLanguage) {
  render(
    <PrintReport
      scanId="scan-print"
      language="en"
      planLanguage={planLanguage}
      onBack={() => {}}
      onError={() => {}}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the printable client report', () => {
  it('prints the Action Plan in the report’s language after the summary, labelled as AI-written', async () => {
    const fetchMock = mockApi(() => envelope(PLAN_STATE));
    renderPrint('de');

    const overview = await screen.findByText(PLAN_STATE.plan.overview);
    const heading = screen.getByRole('heading', { name: /Action Plan/ });
    expect(heading).toHaveTextContent('AI-generated');
    expect(screen.getByText('Kanonische Adressen setzen')).toBeInTheDocument();
    expect(screen.getByText('Den Canonical-Link im Seitentemplate setzen.')).toBeInTheDocument();
    // After the summary, before the sections.
    const summary = screen.getByRole('heading', { name: 'Summary' });
    const sections = screen.getByRole('heading', { name: 'Sections' });
    expect(
      summary.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      heading.compareDocumentPosition(sections) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(overview).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith('/scans/scan-print/action-plan?language=de'),
      ),
    ).toBe(true);
  });

  it('prints without the section when the scan has no plan to read', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockApi(() => envelope(null, 403));
    renderPrint('en');

    expect(await screen.findByRole('heading', { name: 'Sections' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Action Plan/ })).not.toBeInTheDocument();
    // A Basic scan answers 403 by design: nothing went wrong.
    expect(errors).not.toHaveBeenCalled();
  });

  it('prints without the section when the plan cannot be read, and logs why', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockApi(() => envelope(null, 500));
    renderPrint('en');

    expect(await screen.findByRole('heading', { name: 'Sections' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Action Plan/ })).not.toBeInTheDocument();
    expect(errors).toHaveBeenCalledWith(
      'FluxRadar action plan could not be printed',
      expect.any(Error),
    );
  });
});
