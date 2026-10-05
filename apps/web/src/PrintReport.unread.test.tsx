// The printable report of a scan that checked nothing.
//
// The document a buyer hands to a client must not read as a clean result when
// no page of the site was read: "Nothing is left open" and "found nothing to
// report" are both true of an empty list and both false of the site.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Dashboard, Scan, ScanModule } from './api';
import type { Language } from './i18n';
import { PrintReport } from './PrintReport';

const REASON = 'SiteReturnedNoReadablePage';

const UNREAD_SCAN: Scan = {
  id: 'scan-print-unread',
  profileId: 'profile-1',
  plan: 'Complete',
  domain: 'https://evagrace.example',
  status: 'Failed',
  statusReason: REASON,
  crawlSummary: {
    reach: 'bad-response',
    startStatus: 500,
    accessControlSignals: [],
    pagesRead: 0,
    pagesFetched: 1,
    urlsDiscovered: 0,
    urlsOverLimit: 0,
    urlsBlockedByRobots: 0,
    limitedBy: null,
    maxPages: 100,
  },
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-mvp-0.1',
  progress: { completedModules: 2, totalModules: 2 },
  startedAt: '2026-10-01T00:00:00.000Z',
  completedAt: '2026-10-01T00:01:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z',
  modules: [],
};

function unreadModule(module: string): ScanModule {
  return {
    module,
    status: 'Unavailable',
    statusReason: REASON,
    coverage: 0,
    score: null,
    applicableChecks: 1,
    completedApplicableChecks: 0,
    usableOutput: false,
    metadata: {},
  };
}

const UNREAD_DASHBOARD: Dashboard = {
  scan: UNREAD_SCAN,
  overall: { verdict: 'unavailable', score: null, weightedCoverage: 0, moduleWeights: [] },
  modules: [unreadModule('SEO'), unreadModule('Accessibility')],
  geoObservations: [],
};

function envelope(data: unknown, meta?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ success: true, data, error: null, ...(meta ?? {}) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(dashboard: Dashboard): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const path = String(input);
      if (path.includes('/action-plan')) return Promise.resolve(envelope(null));
      if (path.includes('/issues/summary')) {
        return Promise.resolve(envelope({ total: 0, open: 0, bySeverity: {}, groups: [] }));
      }
      if (path.includes('/issues')) {
        return Promise.resolve(envelope([], { meta: { total: 0, page: 1, limit: 100 } }));
      }
      return Promise.resolve(envelope(dashboard));
    }),
  );
}

async function printReport(dashboard: Dashboard, language: Language): Promise<void> {
  stubFetch(dashboard);
  render(
    <PrintReport
      scanId={dashboard.scan.id}
      language={language}
      onBack={() => {}}
      onError={() => {}}
    />,
  );
  await screen.findByRole('heading', { level: 1 });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the printable report of a site that could not be read', () => {
  it('says the site could not be opened and that nothing was checked (EN)', async () => {
    await printReport(UNREAD_DASHBOARD, 'en');

    expect(screen.getByText('We could not open your site.')).toBeTruthy();
    // The status, for the developer the document goes to; never the reason code.
    expect(screen.getByText(/a file instead of a page\. \(HTTP 500\)$/)).toBeTruthy();
    expect(screen.getByText(/^Nothing was checked/)).toBeTruthy();
    expect(screen.getByText(/^No problems are listed because nothing was checked/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Nothing is left open in this report/);
    expect(document.body.textContent).not.toMatch(/FluxRadar found nothing to report/);
    expect(document.body.textContent).not.toContain(REASON);
  });

  it('says the same in Ukrainian', async () => {
    await printReport(UNREAD_DASHBOARD, 'uk');

    expect(screen.getByText('Нам не вдалося відкрити ваш сайт.')).toBeTruthy();
    expect(screen.getByText(/\(HTTP 500\)$/)).toBeTruthy();
    expect(screen.getByText(/^Нічого не перевірено/)).toBeTruthy();
    expect(screen.getByText(/^Проблем у списку немає, бо нічого не перевірено/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/У цьому звіті нічого не лишилося відкритим/);
    expect(document.body.textContent).not.toContain(REASON);
  });

  it('prints no "HTTP 0" when the site never answered', async () => {
    const scan: Scan = {
      ...UNREAD_SCAN,
      statusReason: 'SiteUnreachable',
      crawlSummary: { ...UNREAD_SCAN.crawlSummary!, reach: 'unreachable', startStatus: 0 },
    };
    await printReport({ ...UNREAD_DASHBOARD, scan }, 'en');

    expect(screen.getByText(/Your site did not answer/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/HTTP 0/);
    expect(document.body.textContent).not.toContain('SiteUnreachable');
  });

  it('keeps the clean-result sentences for a report that was checked', async () => {
    const scan: Scan = {
      ...UNREAD_SCAN,
      status: 'Completed',
      statusReason: null,
      crawlSummary: null,
    };
    const checked: ScanModule = {
      ...unreadModule('SEO'),
      status: 'Completed',
      statusReason: null,
      coverage: 1,
      score: 95,
      completedApplicableChecks: 1,
      usableOutput: true,
    };
    await printReport({ ...UNREAD_DASHBOARD, scan, modules: [checked] }, 'en');

    expect(screen.getByText('Nothing is left open in this report.')).toBeTruthy();
    expect(screen.queryByText(/We could not open your site/)).toBeNull();
    expect(screen.queryByText(/^Nothing was checked/)).toBeNull();
  });
});
