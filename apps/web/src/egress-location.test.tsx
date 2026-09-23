// Where a check leaves from, on the launch screen and in the report (D-228).
//
// A site can answer Kyiv and Frankfurt differently, so the country is part of
// what a report measured. The screen offers only countries the server says are
// up, says out loud that speed is measured by Google and not from the chosen
// country, and a report from before the choice does not pretend it was
// Ukrainian — the earliest of those left from a server in Germany.

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Dashboard, EgressLaunchConfig, EgressLocation, Scan, ScanChanges } from './api';
import { EgressLocationField } from './EgressLocationField';
import {
  effectiveEgressLocation,
  egressLocationLabel,
  freeEgressLocation,
  type LaunchConfigState,
} from './egress-location';
import type { Language } from './i18n';
import { LaunchSummary } from './LaunchSummary';
import { ResultsScreen } from './Report';
import { ScanChangesBlock } from './ReportNextSteps';
import { DEFAULT_SCOPE_FORM } from './scan-scope';

const KYIV: EgressLocation = {
  id: 'ua',
  countryCode: 'UA',
  city: 'Kyiv',
  label: { en: 'Ukraine, Kyiv', uk: 'Україна, Київ' },
};
const FRANKFURT: EgressLocation = {
  id: 'de',
  countryCode: 'DE',
  city: 'Frankfurt',
  label: { en: 'Germany, Frankfurt', uk: 'Німеччина, Франкфурт' },
};

function proxyConfig(locations: readonly EgressLocation[]): EgressLaunchConfig {
  return { mode: 'proxy', locations, defaultLocationId: 'ua' };
}

function ready(egress: EgressLaunchConfig): LaunchConfigState {
  return { status: 'ready', egress };
}

function stubFetch(data: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true, data, error: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('which location a launch asks for', () => {
  it('keeps the owner’s choice while it is on offer', () => {
    expect(effectiveEgressLocation('de', proxyConfig([KYIV, FRANKFURT]))).toEqual(FRANKFURT);
  });

  it('shows the default instead of a saved choice that is down, rather than sending it', () => {
    expect(effectiveEgressLocation('de', proxyConfig([KYIV]))).toEqual(KYIV);
    expect(effectiveEgressLocation('', proxyConfig([KYIV, FRANKFURT]))).toEqual(KYIV);
  });

  it('falls back to what is answering when the default is not', () => {
    expect(effectiveEgressLocation('', proxyConfig([FRANKFURT]))).toEqual(FRANKFURT);
  });

  it('has nothing to ask for when nothing is answering, or the list never arrived', () => {
    expect(effectiveEgressLocation('ua', proxyConfig([]))).toBeNull();
    expect(effectiveEgressLocation('ua', null)).toBeNull();
  });

  it('sends a Free check only from the default location, never a substitute', () => {
    expect(freeEgressLocation(proxyConfig([KYIV, FRANKFURT]))).toEqual(KYIV);
    expect(freeEgressLocation(proxyConfig([FRANKFURT]))).toBeNull();
  });

  it('names a location in the reader’s language, and an unknown one by its code', () => {
    expect(egressLocationLabel(KYIV, 'uk')).toBe('Україна, Київ');
    expect(egressLocationLabel(KYIV, 'en')).toBe('Ukraine, Kyiv');
    expect(
      egressLocationLabel({ id: 'pl', countryCode: null, city: null, label: null }, 'uk'),
    ).toBe('PL');
  });
});

describe('the country field on the launch screen', () => {
  function renderField(config: LaunchConfigState, language: Language = 'uk') {
    render(
      <EgressLocationField
        language={language}
        config={config}
        selected={KYIV}
        onChange={() => {}}
      />,
    );
  }

  it('lists only the locations the server offers, with no placeholder countries', () => {
    renderField(ready(proxyConfig([KYIV])));

    const select = screen.getByRole('combobox', { name: /^Країна, з якої йде перевірка/ });
    const options = within(select).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Україна, Київ']);
    expect(screen.getByText('Інші країни з’являться пізніше.')).toBeInTheDocument();
  });

  it('explains why the country matters, and that it does not change the speed numbers', () => {
    renderField(ready(proxyConfig([KYIV])));

    expect(screen.getByText(/мова, редиректи, банери згоди, блокування/)).toBeInTheDocument();
    // Without this line the owner reads PageSpeed's numbers as "for a visitor
    // from Kyiv", which they are not.
    expect(
      screen.getByText(
        'Швидкість вимірює Google PageSpeed Insights зі своєї мережі, тому вибір країни на розділ «Швидкодія» не впливає.',
      ),
    ).toBeInTheDocument();
  });

  it('says the same in English', () => {
    renderField(ready(proxyConfig([KYIV, FRANKFURT])), 'en');

    expect(
      screen.getByRole('combobox', { name: /^Country the check runs from/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/does not change the Performance section/)).toBeInTheDocument();
  });

  it('says a scan cannot start while no location is answering', () => {
    renderField(ready(proxyConfig([])));

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/жодна точка перевірки не відповідає/);
  });

  it('offers nothing to choose on a deployment that crawls directly', () => {
    const { container } = render(
      <EgressLocationField
        language="uk"
        config={ready({ mode: 'direct', locations: [], defaultLocationId: null })}
        selected={null}
        onChange={() => {}}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe('the launch summary', () => {
  function renderSummary(plan: 'Free' | 'Complete', egressLocation: EgressLocation | null) {
    render(
      <LaunchSummary
        language="uk"
        site="https://example.com"
        plan={plan}
        planLabel={plan}
        scope={DEFAULT_SCOPE_FORM}
        egressLocation={egressLocation}
        egressDirect={false}
      />,
    );
  }

  it('names the country beside the other settings', () => {
    renderSummary('Complete', FRANKFURT);

    expect(screen.getByText('Країна перевірки').nextSibling).toHaveTextContent(
      'Німеччина, Франкфурт',
    );
  });

  it('says a Free check runs from the default location', () => {
    renderSummary('Free', KYIV);

    expect(screen.getByText('Країна перевірки').nextSibling).toHaveTextContent(
      'Україна, Київ · за замовчуванням для Free',
    );
  });
});

describe('the report header', () => {
  function dashboardWith(egressLocation: EgressLocation | null | undefined): Dashboard {
    const scan = {
      id: 'scan-1',
      profileId: 'profile-1',
      plan: 'Complete',
      domain: 'https://example.com',
      status: 'Completed',
      statusReason: null,
      scope: { includeSubdomains: false },
      profileConfigVersion: 3,
      rulesetVersion: 'rules-v1',
      progress: { completedModules: 1, totalModules: 1 },
      startedAt: '2026-09-06T00:00:00.000Z',
      completedAt: '2026-09-06T00:01:00.000Z',
      createdAt: '2026-09-06T00:00:00.000Z',
      modules: [],
      ...(egressLocation === undefined ? {} : { egressLocation }),
    } as unknown as Scan;
    return {
      scan,
      overall: {
        verdict: 'ok',
        score: 74,
        weightedCoverage: 0.9,
        moduleWeights: [{ module: 'SEO', tariffWeight: 1, effectiveWeight: 1 }],
      },
      modules: [],
    } as unknown as Dashboard;
  }

  async function openReport(dashboard: Dashboard): Promise<HTMLElement> {
    stubFetch(dashboard);
    render(
      <ResultsScreen
        scan={dashboard.scan}
        language="uk"
        onScan={() => {}}
        onIssues={() => {}}
        onReports={() => {}}
        onError={() => {}}
      />,
    );
    await screen.findByText('Звіт аудиту сайту');
    return screen.getByLabelText('Деталі звіту');
  }

  it('says where the check ran from, beside the plan and the configuration version', async () => {
    const details = await openReport(dashboardWith(KYIV));

    expect(within(details).getByText('Країна перевірки').nextSibling).toHaveTextContent(
      'Україна, Київ',
    );
    expect(within(details).getByText('v3')).toBeInTheDocument();
  });

  it('does not pretend a scan from before the choice was Ukrainian', async () => {
    for (const unrecorded of [null, undefined]) {
      const details = await openReport(dashboardWith(unrecorded));

      expect(within(details).getByText('Країна перевірки').nextSibling).toHaveTextContent(
        'Не зафіксовано',
      );
      expect(details).not.toHaveTextContent('Україна');
      cleanup();
    }
  });
});

describe('the comparison with the previous report', () => {
  function changes(overrides: Partial<ScanChanges>): ScanChanges {
    return {
      previous: {
        id: 'scan-0',
        plan: 'Complete',
        completedAt: '2026-09-01T00:00:00.000Z',
        egressLocation: KYIV,
      },
      egressLocation: KYIV,
      egressComparison: 'same',
      introduced: 2,
      fixed: 3,
      persisting: 5,
      introducedByRule: [],
      fixedByRule: [],
      ...overrides,
    };
  }

  it('calls a difference between two countries a difference, not a fix', async () => {
    stubFetch(
      changes({
        previous: {
          id: 'scan-0',
          plan: 'Complete',
          completedAt: '2026-09-01T00:00:00.000Z',
          egressLocation: KYIV,
        },
        egressLocation: FRANKFURT,
        egressComparison: 'different',
      }),
    );
    render(<ScanChangesBlock scanId="scan-1" language="uk" />);

    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('«Німеччина, Франкфурт»');
    expect(note).toHaveTextContent('«Україна, Київ»');
    expect(screen.getByText('Лише в попередньому звіті')).toBeInTheDocument();
    expect(screen.getByText('Лише в цьому звіті')).toBeInTheDocument();
    expect(screen.queryByText('Виправлено')).not.toBeInTheDocument();
    expect(screen.queryByText('Нові')).not.toBeInTheDocument();
  });

  it('says so when one of the two never recorded where it ran from', async () => {
    stubFetch(changes({ egressComparison: 'unrecorded' }));
    render(<ScanChangesBlock scanId="scan-1" language="en" />);

    expect(await screen.findByRole('note')).toHaveTextContent(/was not recorded/);
    // The counts keep their usual names: nobody can say the places differed.
    expect(screen.getByText('Fixed')).toBeInTheDocument();
  });

  it('adds nothing when both left from the same place', async () => {
    stubFetch(changes({ egressComparison: 'same' }));
    render(<ScanChangesBlock scanId="scan-1" language="en" />);

    expect(await screen.findByText('Fixed')).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
