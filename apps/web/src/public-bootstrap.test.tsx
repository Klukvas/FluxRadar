import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { copy } from './i18n';
import { saveCookieConsent } from './browser-consent';
import { matchingPublicSnapshot } from './public-page-routing';

const response = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify({
      success: status < 400,
      data,
      error: status < 400 ? null : { code: 'UNAUTHORIZED', message: 'No session' },
    }),
    { status },
  );
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('deterministic public entry', () => {
  it.each(['/', '/uk'])('keeps home readable during a delayed session at %s', (path) => {
    window.history.replaceState(null, '', path);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    render(<App />);
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: copy[path === '/uk' ? 'uk' : 'en'].home.hero.title,
      }),
    ).toBeInTheDocument();
  });
  it('keeps explicit English even when Ukrainian was previously stored', () => {
    saveCookieConsent({ preferences: true, analytics: false });
    localStorage.setItem('fluxradar.language', 'uk');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(response(null, 401))),
    );
    render(<App />);
    expect(
      screen.getByRole('heading', { level: 1, name: copy.en.home.hero.title }),
    ).toBeInTheDocument();
  });
  it.each(['verify_email', 'reset_token'])(
    'preserves the private %s URL when changing interface language',
    async (key) => {
      window.history.replaceState(null, '', `/?${key}=private-token`);
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(response(null, 401))),
      );
      render(<App />);
      await screen.findByRole('dialog');
      fireEvent.click(screen.getByRole('combobox', { name: 'Language' }));
      fireEvent.click(screen.getByRole('option', { name: 'Українська' }));
      expect(new URLSearchParams(window.location.search).get(key)).toBe('private-token');
    },
  );
  it.each(['verify_email', 'reset_token'])(
    'initializes a private %s link in its explicit Ukrainian language',
    async (key) => {
      const target = `/?${key}=private-token&lang=uk`;
      window.history.replaceState(null, '', target);
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(response(null, 401))),
      );
      render(<App />);
      await screen.findByRole('dialog');
      expect(screen.getByRole('combobox', { name: 'Мова' })).toBeInTheDocument();
      expect(window.location.search).toBe(`?${key}=private-token&lang=uk`);
    },
  );
  it.each([
    '/?verify_email=private-token',
    '/?reset_token=private-token',
    '/#integrations',
    '/#styleguide',
  ])('keeps consented Ukrainian on a private initial entry %s', async (target) => {
    saveCookieConsent({ preferences: true, analytics: false });
    localStorage.setItem('fluxradar.language', 'uk');
    window.history.replaceState(null, '', target);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(response(null, 401))),
    );
    render(<App />);
    if (!target.endsWith('#styleguide')) await screen.findByRole('dialog');
    expect(screen.getByRole('combobox', { name: 'Мова' })).toBeInTheDocument();
    expect(window.location.search + window.location.hash).toBe(target.slice(1));
  });
  it('follows language history without adding another history entry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(response(null, 401))),
    );
    render(<App />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Language' }));
    fireEvent.click(screen.getByRole('option', { name: 'Українська' }));
    expect(window.location.pathname).toBe('/uk');
    window.history.replaceState(null, '', '/');
    await act(async () => window.dispatchEvent(new PopStateEvent('popstate')));
    expect(
      screen.getByRole('heading', { level: 1, name: copy.en.home.hero.title }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });
  it('does not hydrate public home over legacy private hash entries', () => {
    expect(matchingPublicSnapshot('home:en', '/', '', '#integrations')).toBeNull();
    expect(matchingPublicSnapshot('home:en', '/', '', '#styleguide')).toBeNull();
  });
});
