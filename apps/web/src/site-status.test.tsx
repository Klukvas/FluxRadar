import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

// The Profiles screen's second window used to hold a panel called "Subscription
// model" that read nothing: the word "Pay-per-scan" and the two catalogue
// prices, identical for an owner with no account history and one whose last
// report had just failed. It has been replaced by the account's actual state,
// which means it now has the three ways of not having an answer that any data
// screen has — still loading, nothing to show, could not be read — and each of
// them has to say which one it is.

const account = { accountId: 'account-1', email: 'operator@example.com' };
const profile = { id: 'profile-1', name: 'My Site', domain: 'https://example.com' };

const lastScan = {
  id: 'scan-1',
  profileId: profile.id,
  plan: 'Basic' as const,
  domain: 'https://example.com',
  status: 'Partial',
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-v1',
  progress: { completedModules: 1, totalModules: 2 },
  startedAt: '2026-09-07T10:00:00.000Z',
  completedAt: '2026-09-07T10:04:00.000Z',
  createdAt: '2026-09-07T10:00:00.000Z',
  modules: [],
};

const binding = {
  siteProfileId: profile.id,
  searchConsoleSiteUrl: 'sc-domain:example.com',
  ga4PropertyId: '11111',
  ga4PropertyName: 'Example GA4',
  updatedAt: '2026-09-07T10:00:00.000Z',
};

function envelope<T>(data: T, meta?: object): Response {
  return new Response(
    JSON.stringify({ success: true, data, error: null, ...(meta === undefined ? {} : { meta }) }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function failure(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ success: false, data: null, error: { code: 'TEST_ERROR', message } }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

function pathOf(input: RequestInfo | URL): string {
  return new URL(String(input)).pathname;
}

function renderProfiles(
  handler: (path: string) => Response | Promise<Response>,
  language: 'en' | 'uk' = 'en',
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) => Promise.resolve(handler(pathOf(input))));
  vi.stubGlobal('fetch', fetchMock);
  window.localStorage.setItem('fluxradar.language', language);
  window.history.replaceState(null, '', '/profiles');
  render(<App />);
  return fetchMock;
}

/** The workspace with one profile, one finished check and a Google binding. */
function stubWorkspace(overrides: Record<string, () => Response> = {}) {
  return (path: string): Response => {
    const override = overrides[path];
    if (override !== undefined) return override();
    if (path === '/auth/me') return envelope(account);
    if (path === '/profiles') return envelope([profile]);
    if (path === '/scans/active') return envelope(null);
    if (path === '/scans') return envelope([lastScan], { total: 7, page: 1, limit: 1 });
    if (path === `/profiles/${profile.id}/google-binding`) return envelope(binding);
    return envelope(null);
  };
}

const panel = () => screen.getByText('Site status').closest('.panel') as HTMLElement;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
});

describe('site status panel', () => {
  it('says it is still reading before the answer arrives', async () => {
    let release = (): void => undefined;
    const pending = new Promise<Response>((resolve) => {
      release = () => resolve(envelope([lastScan], { total: 7, page: 1, limit: 1 }));
    });
    renderProfiles((path) => (path === '/scans' ? pending : stubWorkspace()(path)));
    await screen.findByText('Site Profiles');

    expect(within(panel()).getByLabelText('Loading results')).toBeInTheDocument();

    release();
    expect(await screen.findByText('example.com')).toBeInTheDocument();
  });

  it('reports the last check, how many there have been and the Google link', async () => {
    renderProfiles(stubWorkspace());
    await screen.findByText('Site Profiles');

    const status = await screen.findByText('Site status');
    const body = status.closest('.panel') as HTMLElement;
    expect(within(body).getByText('example.com')).toBeInTheDocument();
    // The API's own status word is never shown raw; the chip speaks product.
    expect(within(body).getByText('Checked with limits')).toBeInTheDocument();
    expect(within(body).getByText('Basic')).toBeInTheDocument();
    expect(within(body).getByText('Finished')).toBeInTheDocument();
    // The envelope's `total` is what this account's report list holds, which is
    // not the same number as everything it has ever run: the history gate shows
    // a Basic-only owner one report. The row is named after what it counts.
    expect(within(body).getByText('Reports listed')).toBeInTheDocument();
    expect(within(body).getByText('7')).toBeInTheDocument();
    expect(within(body).queryByText('Checks run')).not.toBeInTheDocument();
    expect(within(body).getByText('Search Console · Example GA4')).toBeInTheDocument();
  });

  it('says a site is not linked to Google rather than leaving it blank', async () => {
    renderProfiles(
      stubWorkspace({ [`/profiles/${profile.id}/google-binding`]: () => envelope(null) }),
    );
    await screen.findByText('Site Profiles');

    expect(await within(panel()).findByText('Not linked')).toBeInTheDocument();
  });

  // An unreadable binding is not the same fact as "not connected", and saying
  // the second one would be inventing an answer.
  it('separates a binding it could not read from one that is not there', async () => {
    renderProfiles(
      stubWorkspace({
        [`/profiles/${profile.id}/google-binding`]: () => failure(500, 'upstream down'),
      }),
    );
    await screen.findByText('Site Profiles');

    expect(await within(panel()).findByText('Could not be read')).toBeInTheDocument();
    expect(within(panel()).queryByText('Not linked')).not.toBeInTheDocument();
  });

  it('has something to say to an account that has never run a check', async () => {
    renderProfiles(
      stubWorkspace({ '/scans': () => envelope([], { total: 0, page: 1, limit: 1 }) }),
    );
    await screen.findByText('Site Profiles');

    const body = panel();
    expect(await within(body).findByText(/No checks yet/)).toBeInTheDocument();
    expect(within(body).getByRole('link', { name: 'See what a report covers' })).toHaveAttribute(
      'href',
      '/checks',
    );
  });

  it('points an account with no sites at the form beside it', async () => {
    renderProfiles(
      stubWorkspace({
        '/profiles': () => envelope([]),
        '/scans': () => envelope([], { total: 0, page: 1, limit: 1 }),
      }),
    );
    await screen.findByText('Site Profiles');

    expect(await within(panel()).findByText(/No sites yet/)).toBeInTheDocument();
  });

  it('offers a retry when the read fails, and recovers on it', async () => {
    let attempts = 0;
    renderProfiles((path) =>
      path === '/scans'
        ? (attempts += 1) === 1
          ? failure(500, 'Scan listing is temporarily unavailable.')
          : envelope([lastScan], { total: 7, page: 1, limit: 1 })
        : stubWorkspace()(path),
    );
    await screen.findByText('Site Profiles');

    const failed = await within(panel()).findByRole('alert');
    // The panel names the failure in its own words; the server's sentence, which
    // exists only in English, is not shown.
    expect(failed).toHaveTextContent('Site status could not be loaded');
    expect(failed).not.toHaveTextContent('Scan listing is temporarily unavailable.');

    fireEvent.click(within(panel()).getByRole('button', { name: 'Try again' }));

    expect(await within(panel()).findByText('example.com')).toBeInTheDocument();
    await waitFor(() => expect(within(panel()).queryByRole('alert')).not.toBeInTheDocument());
  });

  // Every message an ApiRequestError carries is English — the API's own prose or
  // the status-code fallbacks in api.ts — so showing it left a Ukrainian owner
  // reading an English sentence in the middle of a translated screen. What the
  // panel can say in their language is that the read failed, and the retry is
  // the part that was ever actionable.
  it('names a failed read in Ukrainian rather than in the server prose', async () => {
    renderProfiles(
      (path) =>
        path === '/scans'
          ? failure(500, 'Site status is temporarily unavailable.')
          : stubWorkspace()(path),
      'uk',
    );
    await screen.findByText('Профілі сайтів');

    const body = screen.getByText('Стан сайтів').closest('.panel') as HTMLElement;
    const failed = await within(body).findByRole('alert');
    expect(failed).toHaveTextContent('Не вдалося завантажити стан сайтів');
    expect(failed).not.toHaveTextContent('temporarily unavailable');
    expect(within(body).getByRole('button', { name: 'Спробувати ще раз' })).toBeInTheDocument();
  });

  it('reads in Ukrainian', async () => {
    renderProfiles(stubWorkspace(), 'uk');
    await screen.findByText('Профілі сайтів');

    const body = screen.getByText('Стан сайтів').closest('.panel') as HTMLElement;
    expect(await within(body).findByText('example.com')).toBeInTheDocument();
    expect(within(body).getByText('Остання перевірка')).toBeInTheDocument();
    expect(within(body).getByText('Звітів у списку')).toBeInTheDocument();
    expect(within(body).getByText('Дані Google')).toBeInTheDocument();
    // The panel it replaced, in either language.
    expect(screen.queryByText('Subscription model')).not.toBeInTheDocument();
  });
});
