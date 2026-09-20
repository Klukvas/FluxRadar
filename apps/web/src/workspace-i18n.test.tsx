import { saveCookieConsent } from './browser-consent';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { copy } from './i18n';

// ─── Localised result screens ────────────────────────────────────────────────
//
// Language used to hold only until a scan started: the progress window, the
// report, the Issue Center and the integrations screen were written in English
// literals, so a Ukrainian owner fell back into English at exactly the moment
// the product had something to tell them. These check the screens in the locale
// they are rendered in, and that the copy comes from the dictionary rather than
// from a literal that a translation would miss.
// ─────────────────────────────────────────────────────────────────────────────

const account = { accountId: 'account-1', email: 'operator@example.com' };
const profile = { id: 'profile-1', name: 'Product website', domain: 'https://example.com' };

const completedScan = {
  id: 'scan-1',
  profileId: profile.id,
  plan: 'Basic' as const,
  domain: 'https://example.com',
  status: 'Completed',
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-v1',
  progress: { completedModules: 2, totalModules: 2 },
  startedAt: '2026-09-04T00:00:00.000Z',
  completedAt: '2026-09-04T00:03:00.000Z',
  createdAt: '2026-09-04T00:00:00.000Z',
  modules: [
    {
      module: 'SEO',
      status: 'Completed',
      statusReason: null,
      coverage: 1,
      score: 90,
      applicableChecks: 1,
      completedApplicableChecks: 1,
      usableOutput: true,
      metadata: {},
    },
  ],
};

function envelope<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubApi(handler: (path: string) => Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => Promise.resolve(handler(new URL(String(input)).pathname))),
  );
}

function signedIn(path: string): Response {
  if (path === '/auth/me') return envelope(account);
  if (path === '/profiles') return envelope([profile]);
  if (path === '/scans/active') return envelope(null);
  if (path === '/scans') return envelope([]);
  if (path === '/integrations') return envelope([]);
  if (path === `/scans/${completedScan.id}`) return envelope(completedScan);
  if (path === `/scans/${completedScan.id}/issues`) return envelope([]);
  if (path === `/scans/${completedScan.id}/dashboard`)
    return envelope({
      scan: completedScan,
      overall: { verdict: 'good', score: 90, weightedCoverage: 1, moduleWeights: [] },
      modules: completedScan.modules,
    });
  return envelope(null);
}

/** Renders with Ukrainian already chosen, the way a returning owner arrives. */
function renderUkrainianAt(path: string): void {
  saveCookieConsent(true);
  window.localStorage.setItem('fluxradar.language', 'uk');
  stubApi(signedIn);
  window.history.replaceState(null, '', path);
  render(<App />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('Ukrainian result screens', () => {
  it('renders the report dashboard in Ukrainian', async () => {
    renderUkrainianAt(`/scans/${completedScan.id}`);

    expect(await screen.findByText('Панель звіту · example.com')).toBeInTheDocument();
    expect(screen.getByText('Звіт аудиту сайту')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Як читати цей звіт' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Відкрити Центр проблем' })).toBeInTheDocument();
    // The English literals these replaced must be gone, not merely alongside.
    expect(screen.queryByText('Site audit report')).not.toBeInTheDocument();
    expect(screen.queryByText('How to read this report')).not.toBeInTheDocument();
    // The heading that named a metric nobody publishes, in either language.
    expect(screen.queryByText('Єдиний сигнал сайту')).not.toBeInTheDocument();
  });

  it('renders the Issue Center in Ukrainian, including its empty state', async () => {
    renderUkrainianAt(`/scans/${completedScan.id}/issues`);

    expect(await screen.findByText('Знахідки та докази')).toBeInTheDocument();
    // The heading is drawn at once; the list under it arrives with the API.
    expect(await screen.findByText('У цьому звіті немає знахідок')).toBeInTheDocument();
    expect(screen.queryByText('Findings and evidence')).not.toBeInTheDocument();
  });

  it('renders the integrations screen in Ukrainian', async () => {
    renderUkrainianAt('/integrations');

    expect(await screen.findByText('Підключені джерела даних')).toBeInTheDocument();
    expect(screen.getByText('Поточна політика')).toBeInTheDocument();
    expect(screen.queryByText('Connected data sources')).not.toBeInTheDocument();
  });

  it('renders the reports list in Ukrainian', async () => {
    renderUkrainianAt('/reports');

    expect(await screen.findByText('Ваші звіти перевірок')).toBeInTheDocument();
    expect(await screen.findByText('Звітів ще немає')).toBeInTheDocument();
  });

  it('says a finished scan is finished, in the chosen language', async () => {
    const running = { ...completedScan, status: 'Running', completedAt: null };
    let requests = 0;
    stubApi((path) => {
      if (path === `/scans/${completedScan.id}`) {
        requests += 1;
        return envelope(requests === 1 ? running : completedScan);
      }
      return signedIn(path);
    });
    saveCookieConsent(true);
    window.localStorage.setItem('fluxradar.language', 'uk');
    window.history.replaceState(null, '', `/scans/${completedScan.id}`);
    render(<App />);

    expect(await screen.findByText('Ваш звіт готовий.')).toBeInTheDocument();
    expect(screen.queryByText('Your report is ready.')).not.toBeInTheDocument();
  });
});

describe('one word for a saved site, in both languages', () => {
  // The workspace called the same record a Profile in the navigation and a
  // Website in the Google picker, the reports list and the report header. Every
  // surface that talks about a saved record now says Profile / Профіль; "site"
  // and "адреса сайту" are kept only for the address itself.
  const workspaceSurfaces = [
    'nav',
    'workspace',
    'newScan',
    'reports',
    'scanProgress',
    'report',
    'integrations',
    'tour',
  ] as const;

  it('never calls a saved profile a Website on a workspace surface', () => {
    for (const language of ['en', 'uk'] as const) {
      for (const surface of workspaceSurfaces) {
        expect(JSON.stringify(copy[language][surface])).not.toMatch(/website|вебсайт|веб-сайт/i);
      }
    }
  });

  // The scan screen named its picker after what a profile *holds* — a public
  // origin — while the dropdown it labels lists saved profiles. The label says
  // what is being chosen; the address and the public-pages-only promise it used
  // to carry moved to the hint under the field.
  it('names the profile picker of the scan screen Profile, not a public origin', () => {
    expect(copy.en.newScan.labelProfile).toBe('Profile');
    expect(copy.uk.newScan.labelProfile).toBe('Профіль');
    expect(JSON.stringify(copy.en.newScan)).not.toMatch(/Public origin/);
    expect(JSON.stringify(copy.uk.newScan)).not.toMatch(/Публічне джерело/);
    // Nothing about the scan's scope was lost in the rename.
    expect(copy.en.newScan.hintProfile).toMatch(/public pages/i);
    expect(copy.uk.newScan.hintProfile).toMatch(/публічні сторінки/);
  });

  it('names the profile picker of the Google panel Profile, not Website', () => {
    expect(copy.en.integrations.google.profileLabel).toBe('Profile');
    expect(copy.uk.integrations.google.profileLabel).toBe('Профіль');
    expect(copy.en.integrations.google.emptyAction).toBe('Add profile');
    expect(copy.uk.integrations.google.emptyAction).toBe('Додати профіль');
  });
});

// The score area was the last part of the report written in literals: the word
// under the number was the scoring model's identifier `score-v1`, the accessible
// name was "Score 90.00" and the line beneath it was "coverage 100%". All three
// stayed English in a Ukrainian report, on the one part of the screen a reader
// looks at first.
describe('the report score area in Ukrainian', () => {
  const scoredScan = {
    ...completedScan,
    modules: [
      {
        module: 'Performance',
        status: 'Unavailable',
        statusReason: 'PerformanceIntegrationNotConfigured',
        coverage: 0,
        score: null,
        applicableChecks: 1,
        completedApplicableChecks: 0,
        usableOutput: false,
        metadata: {},
      },
      ...completedScan.modules,
    ],
  };

  function renderScoredReport(): void {
    saveCookieConsent(true);
    window.localStorage.setItem('fluxradar.language', 'uk');
    stubApi((path) => {
      if (path === `/scans/${completedScan.id}/dashboard`)
        return envelope({
          scan: scoredScan,
          overall: {
            verdict: 'normal',
            score: 90,
            weightedCoverage: 1,
            moduleWeights: [{ module: 'SEO', tariffWeight: 1, effectiveWeight: 1 }],
          },
          modules: scoredScan.modules,
        });
      if (path === `/scans/${completedScan.id}`) return envelope(scoredScan);
      return signedIn(path);
    });
    window.history.replaceState(null, '', `/scans/${completedScan.id}`);
    render(<App />);
  }

  it('names the number and its coverage in Ukrainian, and drops score-v1', async () => {
    renderScoredReport();
    await screen.findByText('Звіт аудиту сайту');

    // `score-v1` named a scoring model version nothing on the screen explains.
    expect(screen.queryByText('score-v1')).not.toBeInTheDocument();
    // The word under the number is the one the report's own legend uses.
    expect(screen.getAllByText(copy.uk.report.helpScoreTerm).length).toBeGreaterThan(0);
    expect(screen.getByText('покриття 100%')).toBeInTheDocument();
    expect(screen.queryByText('coverage 100%')).not.toBeInTheDocument();
  });

  it('gives the dial an accessible name in the reader’s language', async () => {
    renderScoredReport();
    await screen.findByText('Звіт аудиту сайту');

    expect(screen.getByLabelText('Оцінка 90.00')).toBeInTheDocument();
    expect(screen.queryByLabelText('Score 90.00')).not.toBeInTheDocument();
  });

  it('explains an unavailable section in Ukrainian instead of one English word', async () => {
    renderScoredReport();
    await screen.findByText('Звіт аудиту сайту');

    expect(
      screen.getByText(copy.uk.report.moduleReason.performanceNotConfigured),
    ).toBeInTheDocument();
    expect(screen.queryByText(/PerformanceIntegrationNotConfigured/)).not.toBeInTheDocument();
  });
});

describe('every localized screen has both languages', () => {
  it('defines the same keys in English and Ukrainian', () => {
    const keysOf = (value: unknown, prefix = ''): string[] =>
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? Object.entries(value).flatMap(([key, nested]) => keysOf(nested, `${prefix}${key}.`))
        : [prefix.slice(0, -1)];
    // A key present in one locale only is a screen that silently falls back to
    // the other language, which is the class of bug this whole pass was about.
    expect(keysOf(copy.uk).sort()).toEqual(keysOf(copy.en).sort());
  });
});
