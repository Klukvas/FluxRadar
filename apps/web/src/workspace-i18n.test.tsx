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
    expect(screen.getByText('Єдиний сигнал сайту')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Як читати цей звіт' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Відкрити Центр проблем' })).toBeInTheDocument();
    // The English literals these replaced must be gone, not merely alongside.
    expect(screen.queryByText('Unified website signal')).not.toBeInTheDocument();
    expect(screen.queryByText('How to read this report')).not.toBeInTheDocument();
  });

  it('renders the Issue Center in Ukrainian, including its empty state', async () => {
    renderUkrainianAt(`/scans/${completedScan.id}/issues`);

    expect(await screen.findByText('Знахідки та докази')).toBeInTheDocument();
    expect(screen.getByText('У цьому звіті немає знахідок')).toBeInTheDocument();
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
    window.localStorage.setItem('fluxradar.language', 'uk');
    window.history.replaceState(null, '', `/scans/${completedScan.id}`);
    render(<App />);

    expect(await screen.findByText('Ваш звіт готовий.')).toBeInTheDocument();
    expect(screen.queryByText('Your report is ready.')).not.toBeInTheDocument();
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
