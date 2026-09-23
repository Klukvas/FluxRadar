// The AI SEO / GEO card groups its answers by provider.
//
// One flat list of observations could not say that ChatGPT and Claude were
// asked the same questions and answered differently, which is the whole point
// of asking two of them.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Dashboard, GeoObservation, Scan, ScanModule } from './api';
import { ResultsScreen } from './Report';

const SCAN: Scan = {
  id: 'scan-geo',
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
    purpose: 'awareness',
    question: 'What is Smile Clinic?',
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

function geoModule(): ScanModule {
  return {
    module: 'AI SEO / GEO',
    status: 'Partial',
    statusReason: null,
    coverage: 1,
    score: 100,
    applicableChecks: 4,
    completedApplicableChecks: 3,
    usableOutput: true,
    metadata: {},
  };
}

function dashboardOf(geoObservations: readonly GeoObservation[]): Dashboard {
  return {
    scan: SCAN,
    overall: {
      verdict: 'ok',
      score: 90,
      weightedCoverage: 1,
      moduleWeights: [{ module: 'AI SEO / GEO', tariffWeight: 1, effectiveWeight: 1 }],
    },
    modules: [geoModule()],
    geoObservations,
  };
}

async function openGeoCard(dashboard: Dashboard): Promise<void> {
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
      language="en"
      onScan={() => {}}
      onIssues={() => {}}
      onReports={() => {}}
      onError={() => {}}
    />,
  );
  await screen.findByText('Site audit report');
  const grid = document.querySelector('.module-grid') as HTMLElement;
  fireEvent.click(within(grid).getByText('AI SEO / GEO').closest('.module-card') as HTMLElement);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('GEO observations grouped by provider', () => {
  it('shows OpenAI first, then Anthropic, with each group’s mention counts', async () => {
    await openGeoCard(
      dashboardOf([
        observation({ provider: 'anthropic', modelId: 'claude-sonnet-5' }),
        observation({
          provider: 'anthropic',
          question: 'Which dental clinics offer implants in Kyiv?',
          purpose: 'discovery',
          mentions: { brand: 'not-mentioned', domain: 'not-mentioned' },
        }),
        observation({
          provider: 'openai',
          modelId: 'gpt-5.6-luna',
          mentions: { brand: 'mentioned', domain: 'mentioned' },
        }),
      ]),
    );

    const headings = screen.getAllByRole('heading', { level: 5 }).map((node) => node.textContent);
    expect(headings[0]).toContain('ChatGPT · OpenAI');
    expect(headings[0]).toContain('gpt-5.6-luna');
    expect(headings[1]).toContain('Claude · Anthropic');

    // The group is the block the provider's own heading sits in; the panel
    // uses the same class for its other sections.
    const groupOf = (index: number): HTMLElement =>
      screen.getAllByRole('heading', { level: 5 })[index]?.closest('.module-checks__group') as HTMLElement;
    expect(groupOf(0)).toHaveTextContent(
      'Brand mentioned in 1 of 1 answers · Official domain referenced in 1 of 1',
    );
    expect(groupOf(1)).toHaveTextContent(
      'Brand mentioned in 1 of 2 answers · Official domain referenced in 0 of 2',
    );
  });

  it('keeps an unavailable answer under the provider that was asked', async () => {
    await openGeoCard(
      dashboardOf([
        observation({ provider: 'anthropic' }),
        observation({
          provider: 'openai',
          modelId: null,
          status: 'unavailable',
          reason: 'ProviderUnavailable',
          answer: null,
          mentions: null,
        }),
      ]),
    );

    const openaiGroup = screen
      .getAllByRole('heading', { level: 5 })[0]
      ?.closest('.module-checks__group') as HTMLElement;
    expect(openaiGroup).toHaveTextContent('ChatGPT · OpenAI');
    expect(openaiGroup).toHaveTextContent('The model did not return a usable answer');
  });

  it('renders a pre-release observation whose provider was never recorded', async () => {
    await openGeoCard(
      dashboardOf([
        observation({ provider: 'anthropic' }),
        observation({
          provider: null,
          modelId: null,
          status: 'unavailable',
          reason: 'ConsentMissing',
          answer: null,
          mentions: null,
        }),
      ]),
    );

    const headings = screen.getAllByRole('heading', { level: 5 });
    // Last, and named for what it is rather than attributed to a model.
    expect(headings[headings.length - 1]).toHaveTextContent('Provider not recorded');
  });
});
