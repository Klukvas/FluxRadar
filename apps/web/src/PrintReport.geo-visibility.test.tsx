// The printed client report mirrors the "Visibility by engine" block compactly:
// a small table, one row per engine — no answer cards, matching how the print
// document already summarizes every other module.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Dashboard, GeoObservation, GeoProviderVisibility, Scan } from './api';
import { PrintReport } from './PrintReport';

function scanOf(): Scan {
  return {
    id: 'scan-print-geo',
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
  } as unknown as Scan;
}

function observation(): GeoObservation {
  return {
    purpose: 'closed-book',
    question: 'What do you know about this business?',
    status: 'answered',
    reason: null,
    provider: 'anthropic',
    modelId: 'claude-sonnet-5',
    answer: 'Smile Clinic is a dental clinic in Kyiv.',
    citations: [],
    mentions: { brand: 'mentioned', domain: 'not-mentioned' },
  };
}

function providerVisibility(): GeoProviderVisibility {
  return {
    provider: 'anthropic',
    label: 'Claude · Anthropic',
    questionsAsked: 3,
    questionsAnswered: 3,
    questionsUnavailable: 0,
    brandMentionedCount: 2,
    brandMentionedShare: 2 / 3,
    domainCitedCount: 1,
    domainCitedShare: 1 / 3,
    visibilityScore: 53,
    byPurpose: {
      'closed-book': { asked: 2, answered: 2, brandMentioned: 1, domainMentioned: 1 },
      awareness: { asked: 0, answered: 0, brandMentioned: 0, domainMentioned: 0 },
      discovery: { asked: 1, answered: 1, brandMentioned: 1, domainMentioned: 0 },
    },
    citedInstead: [],
  };
}

function dashboardOf(options: {
  geoObservations: readonly GeoObservation[];
  geoVisibilitySummary?: Dashboard['geoVisibilitySummary'];
}): Dashboard {
  return {
    scan: scanOf(),
    overall: { verdict: 'ok', score: 90, weightedCoverage: 1, moduleWeights: [] },
    modules: [],
    geoObservations: options.geoObservations,
    ...(options.geoVisibilitySummary === undefined
      ? {}
      : { geoVisibilitySummary: options.geoVisibilitySummary }),
  };
}

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
      if (path.includes('/comparison')) {
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the printable report and GEO visibility', () => {
  it('prints a compact table with the score and shares', async () => {
    stubFetch(
      dashboardOf({
        geoObservations: [observation()],
        geoVisibilitySummary: {
          minAnsweredForScore: 3,
          weightBrand: 0.6,
          weightDomain: 0.4,
          providers: [providerVisibility()],
        },
      }),
    );
    render(
      <PrintReport scanId="scan-print-geo" language="en" onBack={() => {}} onError={() => {}} />,
    );

    expect(await screen.findByText('Visibility by engine')).toBeInTheDocument();
    expect(screen.getByText('Claude · Anthropic')).toBeInTheDocument();
    expect(screen.getByText('53/100')).toBeInTheDocument();
  });

  it('prints the pre-release sentence for a scan with answers but no stored summary', async () => {
    stubFetch(dashboardOf({ geoObservations: [observation()], geoVisibilitySummary: null }));
    render(
      <PrintReport scanId="scan-print-geo" language="en" onBack={() => {}} onError={() => {}} />,
    );

    expect(
      await screen.findByText(/This summary is available for scans run after/),
    ).toBeInTheDocument();
  });

  it('prints nothing GEO-related for a scan with no GEO observations', async () => {
    stubFetch(dashboardOf({ geoObservations: [] }));
    render(
      <PrintReport scanId="scan-print-geo" language="en" onBack={() => {}} onError={() => {}} />,
    );

    await screen.findByRole('button', { name: 'Print or save as PDF' });
    expect(screen.queryByText('Visibility by engine')).toBeNull();
  });

  it('prints the block in Ukrainian', async () => {
    stubFetch(
      dashboardOf({
        geoObservations: [observation()],
        geoVisibilitySummary: {
          minAnsweredForScore: 3,
          weightBrand: 0.6,
          weightDomain: 0.4,
          providers: [providerVisibility()],
        },
      }),
    );
    render(
      <PrintReport scanId="scan-print-geo" language="uk" onBack={() => {}} onError={() => {}} />,
    );

    expect(await screen.findByText('Видимість за системами')).toBeInTheDocument();
  });
});
