// The printed client report carries the comparison as counts and a verdict.
//
// It is the document a buyer hands to a client or a developer, and that reader
// cannot expand a list — so the block is the numbers plus the sentence that
// qualifies them. The sentence is the part that must never be dropped for
// length: "5 resolved" on a printed page, with no statement of what the two
// crawls were, is the claim this feature exists to avoid making.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Dashboard, Scan } from './api';
import type { ReadableComparedScan, ScanComparison } from './comparison-api';
import { PrintReport } from './PrintReport';

function scanOf(plan: Scan['plan'] = 'Complete'): Scan {
  return {
    id: 'scan-print',
    profileId: 'profile-1',
    plan,
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
  } as unknown as Scan;
}

function dashboardOf(plan: Scan['plan'] = 'Complete'): Dashboard {
  return {
    scan: scanOf(plan),
    overall: { verdict: 'ok', score: 90, weightedCoverage: 1, moduleWeights: [] },
    modules: [],
    geoObservations: [],
  };
}

function scope(): ScanComparison['current']['scope'] {
  return {
    entryUrl: 'https://smile.example',
    maxPages: 500,
    maxDepth: 5,
    includeSubdomains: false,
    queryPolicy: 'ignore',
    urlPatterns: [],
    excludePatterns: [],
    seedUrls: [],
    renderJs: false,
    respectRobots: true,
    userAgent: 'desktop',
    egressLocation: 'ua',
    scopeKey: 'scope-v3:same',
  };
}

function comparisonOf(overrides: Partial<ScanComparison> = {}): ScanComparison {
  const side = (id: string, completedAt: string): ReadableComparedScan => ({
    id,
    plan: 'Complete',
    status: 'Completed',
    completedAt,
    pagesRead: 12,
    urlsDiscovered: 12,
    urlsOverLimit: 0,
    scope: scope(),
    readable: true,
  });
  return {
    current: side('scan-print', '2026-09-22T00:01:00.000Z'),
    previous: side('scan-earlier', '2026-09-08T00:01:00.000Z'),
    comparable: { ok: true },
    overall: { previousScore: 61, currentScore: 90, delta: 29 },
    modules: [],
    pages: {
      comparable: { ok: true },
      identity: 'canonical-document',
      added: 2,
      removed: 0,
      kept: 10,
      currentTotal: 12,
      previousTotal: 10,
      addedSample: [],
      removedSample: [],
    },
    issues: {
      new: 1,
      resolved: 7,
      reopened: 0,
      stillOpen: 3,
      settled: 2,
      byModule: [],
      bySeverity: [],
      newSample: [],
      resolvedSample: [],
      firstChecked: {
        known: true,
        count: 0,
        byModule: [],
        bySeverity: [],
        ruleIds: [],
        sample: [],
      },
      noLongerChecked: [],
    },
    ...overrides,
  };
}

function envelope(data: unknown, meta?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ success: true, data, error: null, ...(meta ?? {}) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(options: {
  readonly dashboard: Dashboard;
  readonly comparison?: ScanComparison | 'refused';
}): { paths: string[] } {
  const paths: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const path = String(input);
      paths.push(path);
      if (path.includes('/comparison')) {
        if (options.comparison === undefined || options.comparison === 'refused') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                success: false,
                data: null,
                error: { code: 'COMPARISON_NOT_IN_PLAN', message: 'not in this plan' },
              }),
              { status: 403, headers: { 'content-type': 'application/json' } },
            ),
          );
        }
        return Promise.resolve(envelope(options.comparison));
      }
      if (path.includes('/action-plan')) return Promise.resolve(envelope(null));
      if (path.includes('/issues/summary')) {
        return Promise.resolve(envelope({ total: 0, open: 0, bySeverity: {}, groups: [] }));
      }
      if (path.includes('/issues')) {
        return Promise.resolve(envelope([], { meta: { total: 0, page: 1, limit: 100 } }));
      }
      return Promise.resolve(envelope(options.dashboard));
    }),
  );
  return { paths };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the printable report and the comparison', () => {
  it('prints the counts and what they are measured against', async () => {
    stubFetch({ dashboard: dashboardOf(), comparison: comparisonOf() });
    render(<PrintReport scanId="scan-print" language="en" onBack={() => {}} onError={() => {}} />);

    expect(await screen.findByText('Compared with the previous scan')).toBeInTheDocument();
    expect(screen.getByText(/Against the Complete report of 8 September 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Overall score: 61.00 → 90.00 \(up 29.00\)/)).toBeInTheDocument();
    expect(screen.getByText(/Resolved: 7/)).toBeInTheDocument();
    expect(screen.getByText(/Appeared: 2/)).toBeInTheDocument();
  });

  it('prints the reason, not a number, when the two scans do not compare', async () => {
    stubFetch({
      dashboard: dashboardOf(),
      comparison: comparisonOf({ comparable: { ok: false, reason: 'scope-changed' } }),
    });
    render(<PrintReport scanId="scan-print" language="en" onBack={() => {}} onError={() => {}} />);

    expect(await screen.findByText(/not asked for the same pages/i)).toBeInTheDocument();
    expect(screen.queryByText(/Resolved: 7/)).toBeNull();
  });

  it('prints the block in Ukrainian', async () => {
    stubFetch({ dashboard: dashboardOf(), comparison: comparisonOf() });
    render(<PrintReport scanId="scan-print" language="uk" onBack={() => {}} onError={() => {}} />);

    expect(await screen.findByText('Порівняння з попередньою перевіркою')).toBeInTheDocument();
    expect(screen.getByText(/Виправлені: 7/)).toBeInTheDocument();
  });

  it('prints the document without the block when the endpoint refuses it', async () => {
    stubFetch({ dashboard: dashboardOf(), comparison: 'refused' });
    render(<PrintReport scanId="scan-print" language="en" onBack={() => {}} onError={() => {}} />);

    await screen.findByRole('button', { name: 'Print or save as PDF' });
    await waitFor(() => expect(screen.queryByText('Compared with the previous scan')).toBeNull());
  });

  it('adds nothing to a Basic document, which buys no finding history', async () => {
    // Belt-and-braces with the server's own 403: even handed a comparison, the
    // document of a plan without history does not print one.
    stubFetch({ dashboard: dashboardOf('Basic'), comparison: comparisonOf() });
    render(<PrintReport scanId="scan-print" language="en" onBack={() => {}} onError={() => {}} />);

    await screen.findByRole('button', { name: 'Print or save as PDF' });
    await waitFor(() => expect(screen.queryByText('Compared with the previous scan')).toBeNull());
  });

  it.each(['Basic', 'Free'] as const)(
    'does not ask for a comparison at all when printing a %s report',
    async (plan) => {
      // A refusal is still a request, and it counts against the comparison rate
      // limit every time such a report is printed — so the plan decides before
      // the read, not after it.
      const { paths } = stubFetch({ dashboard: dashboardOf(plan), comparison: comparisonOf() });
      render(
        <PrintReport scanId="scan-print" language="en" onBack={() => {}} onError={() => {}} />,
      );

      await screen.findByRole('button', { name: 'Print or save as PDF' });
      await waitFor(() => expect(paths.some((path) => path.includes('/dashboard'))).toBe(true));
      expect(paths.some((path) => path.includes('/comparison'))).toBe(false);
    },
  );

  it('still asks for it on a plan that includes it', async () => {
    const { paths } = stubFetch({ dashboard: dashboardOf(), comparison: comparisonOf() });
    render(<PrintReport scanId="scan-print" language="en" onBack={() => {}} onError={() => {}} />);

    expect(await screen.findByText('Compared with the previous scan')).toBeInTheDocument();
    expect(paths.some((path) => path.includes('/comparison'))).toBe(true);
  });

  it('prints the sentence when nobody knows which checks the previous scan ran', async () => {
    // A printed "1 new" with no such note is the claim itself, and the reader
    // cannot expand anything to find out otherwise.
    stubFetch({
      dashboard: dashboardOf(),
      comparison: comparisonOf({
        issues: {
          ...comparisonOf().issues,
          firstChecked: {
            known: false,
            count: 0,
            byModule: [],
            bySeverity: [],
            ruleIds: [],
            sample: [],
          },
        },
      }),
    });
    render(<PrintReport scanId="scan-print" language="en" onBack={() => {}} onError={() => {}} />);

    expect(
      await screen.findByText(/Which checks ran in the previous scan is no longer recorded/i),
    ).toBeInTheDocument();
  });

  it('prints the settled count and the first-checked findings beside the rest', async () => {
    stubFetch({
      dashboard: dashboardOf(),
      comparison: comparisonOf({
        issues: {
          ...comparisonOf().issues,
          settled: 2,
          firstChecked: {
            known: true,
            count: 4,
            byModule: [{ module: 'SEO', count: 4 }],
            bySeverity: [{ severity: 'High', count: 4 }],
            ruleIds: ['SEO-TECH-010'],
            sample: [],
          },
        },
      }),
    });
    render(<PrintReport scanId="scan-print" language="en" onBack={() => {}} onError={() => {}} />);

    expect(await screen.findByText(/Settled by you: 2/)).toBeInTheDocument();
    expect(screen.getByText('Checked for the first time: 4')).toBeInTheDocument();
  });
});
