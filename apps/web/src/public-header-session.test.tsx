// The site header for a reader who is signed in.
//
// /terms, /privacy, /cookies, /checks and /faq never asked who the reader was,
// so a signed-in owner opening one saw the workspace tabs greyed out and, on the
// legal pages and /checks, Home marked as the open page — a different header
// from the one on the home page a click earlier. The page still renders without
// waiting on the API; the session is read alongside and the header follows it.
// The home page header, for its part, enabled Scan and Reports and did nothing
// when they were clicked.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { copy } from './i18n';

const ACCOUNT = {
  accountId: 'account-1',
  email: 'owner@example.com',
  emailVerified: true,
  onboarding: { status: 'completed' },
};

const WORKSPACE_TABS = [
  ['Profiles', '/profiles'],
  ['Scan', '/scan'],
  ['Reports', '/reports'],
  ['Integrations', '/integrations'],
] as const;

const PUBLIC_PAGES = ['/terms', '/privacy', '/cookies', '/checks', '/faq'] as const;

function respond(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify(
      status < 400
        ? { success: true, data, error: null }
        : { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'no session' } },
    ),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

function openAs(url: string, isSignedIn: boolean): ReturnType<typeof vi.fn> {
  window.history.replaceState(null, '', url);
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const requested = new URL(String(input)).pathname;
    if (requested === '/auth/me') {
      return Promise.resolve(isSignedIn ? respond(ACCOUNT) : respond(null, 401));
    }
    if (requested === '/profiles') return Promise.resolve(respond([]));
    return Promise.resolve(respond(null));
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);
  return fetchMock;
}

function siteMenu(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Site menu' });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('the header of a public document', () => {
  it.each(PUBLIC_PAGES)('offers the workspace to a signed-in reader on %s', async (path) => {
    openAs(path, true);

    for (const [label, workspacePath] of WORKSPACE_TABS) {
      expect(await within(siteMenu()).findByRole('link', { name: label })).toHaveAttribute(
        'href',
        `${workspacePath}?lang=en`,
      );
    }
  });

  // Without the language in the link, a reader on /terms?lang=uk who had not
  // allowed preference storage landed in an English workspace.
  it('keeps the reader’s language in the links into the workspace', async () => {
    openAs('/terms?lang=uk', true);

    expect(
      await within(siteMenu()).findByRole('link', { name: copy.uk.nav.profiles }),
    ).toHaveAttribute('href', '/profiles?lang=uk');
  });

  it.each(PUBLIC_PAGES)('keeps the workspace tabs disabled for a visitor on %s', async (path) => {
    const fetchMock = openAs(path, false);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Let the 401 reach the app first: asserting on the first paint would pass
    // even if a refused session turned the tabs into links.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    for (const [label] of WORKSPACE_TABS) {
      expect(within(siteMenu()).getByRole('button', { name: label })).toBeDisabled();
    }
  });

  it.each(['/terms', '/privacy', '/cookies', '/checks'])(
    'does not mark Home as the open page on %s',
    (path) => {
      openAs(path, false);

      const home = within(siteMenu()).getByRole('link', { name: 'Home' });
      expect(home).not.toHaveClass('is-active');
      expect(home).not.toHaveAttribute('aria-current');
    },
  );
});

describe('the home page header for a signed-in reader', () => {
  it.each([
    ['Scan', '/scan'],
    ['Reports', '/reports'],
  ])('opens %s from the header', async (label, pathname) => {
    openAs('/', true);

    // Looked up afresh each time: the header shown while the app boots is
    // replaced by the home page's own once the session answers.
    const tab = (): HTMLElement =>
      within(screen.getByRole('navigation', { name: 'Application menu' })).getByRole('button', {
        name: label,
      });
    await waitFor(() => expect(tab()).toBeEnabled());
    fireEvent.click(tab());

    expect(window.location.pathname).toBe(pathname);
  });
});
