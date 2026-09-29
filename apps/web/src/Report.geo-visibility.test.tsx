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
    brandMeasuredCount: 3,
    brandMentionedCount: 2,
    brandMentionedShare: 2 / 3,
    domainMeasuredCount: 3,
    domainCitedCount: 1,
    domainCitedShare: 1 / 3,
    visibilityScore: 53,
    scoreUnavailableReason: null,
    scoreBasis: 'brand-and-domain',
    byPurpose: {
      'closed-book': {
        asked: 2,
        answered: 2,
        brandMeasured: 2,
        domainMeasured: 2,
        brandMentioned: 1,
        domainMentioned: 1,
      },
      awareness: {
        asked: 0,
        answered: 0,
        brandMeasured: 0,
        domainMeasured: 0,
        brandMentioned: 0,
        domainMentioned: 0,
      },
      discovery: {
        asked: 1,
        answered: 1,
        brandMeasured: 1,
        domainMeasured: 1,
        brandMentioned: 1,
        domainMentioned: 0,
      },
    },
    citedInstead: [{ hostname: 'rival-dental.example', answerCount: 2 }],
    shareOfVoice: null,
    ...overrides,
  };
}

function visibilitySummary(providers: readonly GeoProviderVisibility[]): GeoVisibilitySummary {
  return { minMeasuredForScore: 2, weightBrand: 0.6, weightDomain: 0.4, providers };
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
    expect(
      screen.getByText('Brand mentioned in 2 of 3 measurable answers (67%)'),
    ).toBeInTheDocument();
    expect(screen.getByText('Domain cited in 1 of 3 measurable answers (33%)')).toBeInTheDocument();
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
    expect(screen.getByText(/Бренд згадано у 2 з 3 зміряних відповідей/)).toBeInTheDocument();
  });

  // The minimum is the summary's own `minMeasuredForScore`, never the number of
  // answers this provider happened to return: printing the latter produced
  // "needs at least 1 answered questions" for a provider that had answered one.
  it('names the summary\u2019s measured counts, not the provider\u2019s answer count, when there is no score', async () => {
    await openGeoCard(
      dashboardOf({
        geoObservations: [observation({})],
        geoVisibilitySummary: visibilitySummary([
          providerVisibility({
            questionsAnswered: 1,
            brandMeasuredCount: 1,
            brandMentionedCount: 1,
            brandMentionedShare: 1,
            domainMeasuredCount: 2,
            domainCitedCount: 0,
            domainCitedShare: 0,
            visibilityScore: null,
            scoreUnavailableReason: 'not-enough-measured',
            scoreBasis: null,
          }),
        ]),
      }),
    );

    // Final for this scan -- no "yet" -- and it names the two counts that
    // fell short rather than restating a rule the code no longer checks jointly.
    // Numeral-agnostic phrasing (third review round): the sentence must read
    // correctly whether a count is 1 or 2, since it never inflects "answer(s)".
    expect(
      await screen.findByText(
        'No score for this scan: measured answers for the brand — 1, for the domain — 2. Needs at least 2 measured answers in one of them.',
      ),
    ).toBeInTheDocument();
  });

  it('names the minimum in Ukrainian too', async () => {
    await openGeoCard(
      dashboardOf({
        geoObservations: [observation({})],
        geoVisibilitySummary: visibilitySummary([
          providerVisibility({
            questionsAnswered: 1,
            brandMeasuredCount: 1,
            domainMeasuredCount: 1,
            visibilityScore: null,
            scoreUnavailableReason: 'not-enough-measured',
            scoreBasis: null,
          }),
        ]),
      }),
      'uk',
    );

    expect(
      await screen.findByText(/потрібно щонайменше 2 хоча б для одного з них/),
    ).toBeInTheDocument();
  });

  // An auto-created profile whose brand is its hostname can never measure brand
  // visibility; the card says so rather than showing 0% and a score built on it.
  it('says "not measurable" instead of a 0% share when a signal was never measurable', async () => {
    await openGeoCard(
      dashboardOf({
        geoObservations: [observation({})],
        geoVisibilitySummary: visibilitySummary([
          providerVisibility({
            brandMeasuredCount: 0,
            brandMentionedCount: 0,
            brandMentionedShare: null,
            visibilityScore: null,
            scoreUnavailableReason: 'not-measurable',
            scoreBasis: null,
          }),
        ]),
      }),
    );

    expect(
      await screen.findByText(/Brand mentions: not measurable in this run/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Brand mentioned in 0 of/)).toBeNull();
    expect(screen.getByText(/No score \u2014 nothing measurable here/)).toBeInTheDocument();
    expect(screen.queryByText('0/100')).toBeNull();
  });

  it('keeps the score label readable beside the number, not as an aria-label over it', async () => {
    await openGeoCard(
      dashboardOf({
        geoObservations: [observation({})],
        geoVisibilitySummary: visibilitySummary([providerVisibility()]),
      }),
    );

    const score = await screen.findByText('Visibility score');
    // Both the label and the number are in the accessibility tree.
    expect(score.parentElement?.textContent).toContain('53/100');
  });

  it('explains that only our own hostname is excluded from "cited instead"', async () => {
    await openGeoCard(
      dashboardOf({
        geoObservations: [observation({})],
        geoVisibilitySummary: visibilitySummary([providerVisibility()]),
      }),
    );

    expect(
      await screen.findByText(/Only your own hostname and its subdomains are left out/),
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

// T7: share of voice — the brand's mentions against configured competitors.
describe('Share of voice', () => {
  it('renders the brand and competitor rows in share order', async () => {
    await openGeoCard(
      dashboardOf({
        geoObservations: [observation({})],
        geoVisibilitySummary: visibilitySummary([
          providerVisibility({
            shareOfVoice: {
              denominator: 4,
              brandMentionsInScope: 2,
              brandShare: 0.5,
              competitors: [
                { name: 'Acme Audit', mentionedCount: 1, share: 0.25 },
                { name: 'Globex', mentionedCount: 1, share: 0.25 },
              ],
            },
          }),
        ]),
      }),
    );

    expect(await screen.findByText('Share of voice')).toBeInTheDocument();
    expect(screen.getByText('Your brand: 50% of mentions')).toBeInTheDocument();
    expect(screen.getByText('Acme Audit: 25%')).toBeInTheDocument();
    expect(screen.getByText('Globex: 25%')).toBeInTheDocument();
  });

  it('says "not measurable" rather than 0% for a null competitor share', async () => {
    await openGeoCard(
      dashboardOf({
        geoObservations: [observation({})],
        geoVisibilitySummary: visibilitySummary([
          providerVisibility({
            shareOfVoice: {
              denominator: 0,
              brandMentionsInScope: 0,
              brandShare: null,
              competitors: [{ name: 'Acme Audit', mentionedCount: 0, share: null }],
            },
          }),
        ]),
      }),
    );

    expect(await screen.findByText('Share of voice')).toBeInTheDocument();
    expect(screen.getByText('Your brand: not measurable in this run')).toBeInTheDocument();
    expect(screen.getByText('Acme Audit: not measurable in this run')).toBeInTheDocument();
  });

  // T7-fix F5: the report is a fixed snapshot of the scan that produced it —
  // since T7-fix F8 the competitor list is captured at launch, so editing the
  // profile's competitors after this scan finished can never populate this
  // row. The note must say so, not invite an edit that would change nothing.
  it('shows a note about future scans, not an invitation to change this report, when no competitors are configured', async () => {
    await openGeoCard(
      dashboardOf({
        geoObservations: [observation({})],
        geoVisibilitySummary: visibilitySummary([providerVisibility({ shareOfVoice: null })]),
      }),
    );

    expect(await screen.findByText('Share of voice')).toBeInTheDocument();
    expect(screen.getByText(/include them in your next scan/)).toBeInTheDocument();
    expect(screen.getByText(/not to this report/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Add competitors' });
    expect(link).toBeInTheDocument();
  });

  it('shows the same note when the provider predates this field (old metadata)', async () => {
    const provider = providerVisibility() as unknown as Record<string, unknown>;
    delete provider.shareOfVoice;
    await openGeoCard(
      dashboardOf({
        geoObservations: [observation({})],
        geoVisibilitySummary: visibilitySummary([provider as unknown as GeoProviderVisibility]),
      }),
    );

    expect(await screen.findByText('Share of voice')).toBeInTheDocument();
    expect(screen.getByText(/include them in your next scan/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add competitors' })).toBeInTheDocument();
  });

  it('renders share of voice in Ukrainian', async () => {
    await openGeoCard(
      dashboardOf({
        geoObservations: [observation({})],
        geoVisibilitySummary: visibilitySummary([
          providerVisibility({
            shareOfVoice: {
              denominator: 4,
              brandMentionsInScope: 2,
              brandShare: 0.5,
              competitors: [{ name: 'Acme Audit', mentionedCount: 1, share: 0.5 }],
            },
          }),
        ]),
      }),
      'uk',
    );

    expect(await screen.findByText('Частка голосу')).toBeInTheDocument();
    expect(screen.getByText('Ваш бренд: 50% згадок')).toBeInTheDocument();
  });

  // T7-fix3 L2: brandMentionedCount (above, from the brand-mention signal)
  // counts "Bolt" inside "Bolt Food" as a mention; brandMentionsInScope
  // (here) deliberately does not, per N1's decided rule — so the card can
  // show "brand mentioned in 2/2 answers" right above "your brand: 0% of
  // mentions" with nothing explaining why. The note below the row closes
  // that gap only when the two numbers actually disagree.
  it('explains the gap when the brand is only ever named inside a competitor’s name', async () => {
    await openGeoCard(
      dashboardOf({
        geoObservations: [observation({})],
        geoVisibilitySummary: visibilitySummary([
          providerVisibility({
            brandMeasuredCount: 2,
            brandMentionedCount: 2,
            brandMentionedShare: 1,
            shareOfVoice: {
              denominator: 2,
              brandMentionsInScope: 0,
              brandShare: 0,
              competitors: [{ name: 'Bolt Food', mentionedCount: 2, share: 1 }],
            },
          }),
        ]),
      }),
    );

    expect(await screen.findByText('Share of voice')).toBeInTheDocument();
    expect(screen.getByText('Your brand: 0% of mentions')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Share of voice counts your brand only where it is named on its own, not inside a competitor's name (2 answer(s) named it only as part of a competitor's name).",
      ),
    ).toBeInTheDocument();
  });

  it('says nothing extra when the brand-mention and share-of-voice counts already agree', async () => {
    await openGeoCard(
      dashboardOf({
        geoObservations: [observation({})],
        geoVisibilitySummary: visibilitySummary([
          providerVisibility({
            shareOfVoice: {
              denominator: 4,
              brandMentionsInScope: 2,
              brandShare: 0.5,
              competitors: [{ name: 'Acme Audit', mentionedCount: 1, share: 0.25 }],
            },
          }),
        ]),
      }),
    );

    expect(await screen.findByText('Share of voice')).toBeInTheDocument();
    expect(screen.queryByText(/only where it is named on its own/)).toBeNull();
  });

  it('explains the gap in Ukrainian for the same Bolt / Bolt Food case', async () => {
    await openGeoCard(
      dashboardOf({
        geoObservations: [observation({})],
        geoVisibilitySummary: visibilitySummary([
          providerVisibility({
            brandMeasuredCount: 2,
            brandMentionedCount: 2,
            brandMentionedShare: 1,
            shareOfVoice: {
              denominator: 2,
              brandMentionsInScope: 0,
              brandShare: 0,
              competitors: [{ name: 'Bolt Food', mentionedCount: 2, share: 1 }],
            },
          }),
        ]),
      }),
      'uk',
    );

    expect(await screen.findByText('Частка голосу')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Частка голосу враховує ваш бренд лише там, де його названо окремо, а не всередині назви конкурента (у 2 відповіді(ях) його названо лише як частину назви конкурента).',
      ),
    ).toBeInTheDocument();
  });
});
