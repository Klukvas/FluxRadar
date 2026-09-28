// The "Visibility by engine" block (T6): a per-provider score, brand/domain
// shares, and who got cited instead — plus the mention-context quote on an
// answer card, shown at the top of the GEO section before the answer cards.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  Dashboard,
  GeoObservation,
  GeoProviderVisibility,
  GeoVisibilitySummary,
  Scan,
  ScanModule,
} from './api';
import { ResultsScreen } from './Report';

const SCAN: Scan = {
  id: 'scan-geo-visibility',
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

function observation(overrides: Partial<GeoObservation>): GeoObservation {
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
    ...overrides,
  };
}

function providerVisibility(overrides: Partial<GeoProviderVisibility> = {}): GeoProviderVisibility {
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
    citedInstead: [{ hostname: 'rival-dental.example', answerCount: 2 }],
    ...overrides,
  };
}

function visibilitySummary(providers: readonly GeoProviderVisibility[]): GeoVisibilitySummary {
  return { minAnsweredForScore: 3, weightBrand: 0.6, weightDomain: 0.4, providers };
}

function geoModule(): ScanModule {
  return {
    module: 'AI SEO / GEO',
    status: 'Completed',
    statusReason: null,
    coverage: 1,
    score: null,
    applicableChecks: 3,
    completedApplicableChecks: 3,
    usableOutput: true,
    metadata: {},
  };
}

function dashboardOf(options: {
  geoObservations: readonly GeoObservation[];
  geoVisibilitySummary?: GeoVisibilitySummary | null;
}): Dashboard {
  return {
    scan: SCAN,
    overall: {
      verdict: 'ok',
      score: 90,
      weightedCoverage: 1,
      moduleWeights: [{ module: 'AI SEO / GEO', tariffWeight: 1, effectiveWeight: 1 }],
    },
    modules: [geoModule()],
    geoObservations: options.geoObservations,
    ...(options.geoVisibilitySummary === undefined
      ? {}
      : { geoVisibilitySummary: options.geoVisibilitySummary }),
  };
}

async function openGeoCard(dashboard: Dashboard, language: 'en' | 'uk' = 'en'): Promise<void> {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true, data: dashboard, error: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
  render(
    <ResultsScreen
      scan={dashboard.scan}
      language={language}
      onScan={() => {}}
      onIssues={() => {}}
      onReports={() => {}}
      onError={() => {}}
    />,
  );
  await screen.findByText(language === 'en' ? 'Site audit report' : 'Звіт аудиту сайту');
  const grid = document.querySelector('.module-grid') as HTMLElement;
  fireEvent.click(within(grid).getByText('AI SEO / GEO').closest('.module-card') as HTMLElement);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Visibility by engine', () => {
  it('renders a score card per provider, EN', async () => {
    await openGeoCard(
      dashboardOf({
        geoObservations: [observation({})],
        geoVisibilitySummary: visibilitySummary([providerVisibility()]),
      }),
    );

    expect(await screen.findByText('Visibility by engine')).toBeInTheDocument();
    expect(screen.getByText('53/100')).toBeInTheDocument();
    expect(screen.getByText('Brand mentioned in 2 of 3 answers (67%)')).toBeInTheDocument();
    expect(screen.getByText('Domain cited in 1 of 3 answers (33%)')).toBeInTheDocument();
    expect(screen.getByText(/rival-dental\.example — 2 answer/)).toBeInTheDocument();
  });

  it('renders the block in Ukrainian', async () => {
    await openGeoCard(
      dashboardOf({
        geoObservations: [observation({})],
        geoVisibilitySummary: visibilitySummary([providerVisibility()]),
      }),
      'uk',
    );

    expect(await screen.findByText('Видимість за системами')).toBeInTheDocument();
    expect(screen.getByText(/Бренд згадано у 2 з 3 відповідей/)).toBeInTheDocument();
  });

  it('shows "not enough answers" instead of a score when fewer than the minimum answered', async () => {
    await openGeoCard(
      dashboardOf({
        geoObservations: [observation({})],
        geoVisibilitySummary: visibilitySummary([
          providerVisibility({ questionsAnswered: 1, visibilityScore: null }),
        ]),
      }),
    );

    expect(
      await screen.findByText('Not enough answers yet — needs at least 1 answered questions.'),
    ).toBeInTheDocument();
  });

  it('shows "no other site" when cited instead is empty', async () => {
    await openGeoCard(
      dashboardOf({
        geoObservations: [observation({})],
        geoVisibilitySummary: visibilitySummary([providerVisibility({ citedInstead: [] })]),
      }),
    );

    expect(
      await screen.findByText('No other site was cited in an answer that did not cite yours.'),
    ).toBeInTheDocument();
  });

  it('shows the pre-release sentence for a scan with answers but no stored summary', async () => {
    await openGeoCard(
      dashboardOf({ geoObservations: [observation({})], geoVisibilitySummary: null }),
    );

    expect(
      await screen.findByText(/This summary is available for scans run after/),
    ).toBeInTheDocument();
  });

  it('shows the pre-release sentence when the field is entirely absent (older API response)', async () => {
    await openGeoCard(dashboardOf({ geoObservations: [observation({})] }));

    expect(
      await screen.findByText(/This summary is available for scans run after/),
    ).toBeInTheDocument();
  });

  it('shows no visibility block at all when there are no GEO observations', async () => {
    await openGeoCard(dashboardOf({ geoObservations: [] }));

    expect(screen.queryByText('Visibility by engine')).toBeNull();
  });

  it('shows the mention-context quote on the answer card that has one', async () => {
    await openGeoCard(
      dashboardOf({
        geoObservations: [observation({ mentionContext: 'a solid choice for families in Kyiv' })],
        geoVisibilitySummary: visibilitySummary([providerVisibility()]),
      }),
    );

    expect(await screen.findByText('Where your brand came up:')).toBeInTheDocument();
    expect(screen.getByText(/a solid choice for families in Kyiv/)).toBeInTheDocument();
  });

  it('shows no mention-context line for an answer that never mentioned the brand', async () => {
    await openGeoCard(
      dashboardOf({
        geoObservations: [observation({ mentionContext: null })],
        geoVisibilitySummary: visibilitySummary([providerVisibility()]),
      }),
    );

    await screen.findByText('Visibility by engine');
    expect(screen.queryByText('Where your brand came up:')).toBeNull();
  });
});
