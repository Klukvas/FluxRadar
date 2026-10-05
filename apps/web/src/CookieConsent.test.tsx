import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CookieConsent, CookieSettingsButton } from './CookieConsent';
import {
  COOKIE_CONSENT_TTL_MS,
  analyticsAllowed,
  preferencesAllowed,
  saveCookieConsent,
} from './browser-consent';

beforeEach(() => {
  saveCookieConsent({ preferences: false, analytics: false });
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe('cookie choices', () => {
  it('offers equally direct choices on first visit in a nonmodal region without moving focus', () => {
    const view = render(
      <>
        <button>Continue browsing</button>
      </>,
    );
    const browsing = screen.getByRole('button', { name: 'Continue browsing' });
    browsing.focus();
    view.rerender(
      <>
        <button>Continue browsing</button>
        <CookieConsent language="en" />
      </>,
    );
    const banner = screen.getByRole('region', { name: 'Cookies & storage' });
    expect(within(banner).getByRole('button', { name: 'Only necessary' })).toBeEnabled();
    expect(within(banner).getByRole('button', { name: 'Save choice' })).toBeEnabled();
    expect(within(banner).getByRole('button', { name: 'Allow all' })).toBeEnabled();
    // Nothing optional is pre-ticked: an untouched form saves a refusal.
    expect(within(banner).getByRole('checkbox', { name: 'Preferences' })).not.toBeChecked();
    expect(within(banner).getByRole('checkbox', { name: 'Analytics' })).not.toBeChecked();
    expect(within(banner).getByRole('checkbox', { name: 'Analytics' })).toHaveAccessibleDescription(
      /Google Analytics 4/,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(banner).not.toHaveAttribute('aria-modal');
    expect(document.activeElement).toBe(browsing);
    expect(window.localStorage.getItem('fluxradar.language')).toBeNull();
    expect(within(banner).getByRole('link', { name: 'Cookie details' })).toHaveAttribute(
      'href',
      '/cookies?lang=en',
    );
  });

  it('allows everything, reopens settings with the saved choice, and withdraws it all', () => {
    window.localStorage.setItem('fluxradar.pendingCheckout', 'pending-test');
    const view = render(<CookieConsent language="uk" />);
    fireEvent.click(screen.getByRole('button', { name: 'Дозволити все' }));
    expect(preferencesAllowed()).toBe(true);
    expect(analyticsAllowed()).toBe(true);
    expect(window.localStorage.getItem('fluxradar.language')).toBe('uk');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    view.unmount();

    // The next visit: everything is allowed, so only the policy page's own
    // settings button is offered — the floating launcher stays hidden.
    render(
      <>
        <CookieSettingsButton language="uk" />
        <CookieConsent language="uk" />
      </>,
    );
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Налаштування cookies' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Налаштування cookies' }));
    expect(screen.getByRole('link', { name: 'Докладніше про cookies' })).toHaveAttribute(
      'href',
      '/cookies?lang=uk',
    );
    expect(screen.getByRole('checkbox', { name: 'Налаштування' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Аналітика' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Лише необхідні' }));
    expect(preferencesAllowed()).toBe(false);
    expect(analyticsAllowed()).toBe(false);
    expect(window.localStorage.getItem('fluxradar.language')).toBeNull();
    expect(window.localStorage.getItem('fluxradar.pendingCheckout')).toBe('pending-test');
    expect(screen.getAllByRole('button', { name: 'Налаштування cookies' })).toHaveLength(2);
  });

  it('hides the floating launcher while everything is allowed and brings it back after a withdrawal', () => {
    render(
      <>
        <CookieSettingsButton language="en" />
        <CookieConsent language="en" />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Allow all' }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Cookie settings' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Cookie settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Only necessary' }));

    expect(screen.getAllByRole('button', { name: 'Cookie settings' })).toHaveLength(2);
  });

  // On a phone the lone launcher must not float over the page. Layout is not
  // computed here, so what is pinned is the decision: the dock is marked when
  // the launcher is all it holds, and the phone rule takes that dock out of the
  // fixed layer while the open banner keeps floating.
  it('marks the dock that holds only the launcher, so a phone can drop it into the page', () => {
    const view = render(<CookieConsent language="en" />);
    const dock = view.container.firstElementChild;
    expect(dock).not.toHaveClass('cookie-consent-dock--launcher-only');
    fireEvent.click(screen.getByRole('button', { name: 'Only necessary' }));
    expect(dock).toHaveClass('cookie-consent-dock--launcher-only');
    fireEvent.click(screen.getByRole('button', { name: 'Cookie settings' }));
    expect(dock).not.toHaveClass('cookie-consent-dock--launcher-only');

    const css = readFileSync(
      join(resolve(process.cwd()), 'src', 'styles', 'cookie-consent.css'),
      'utf8',
    );
    expect(css).toMatch(
      /@media \(max-width: 600px\) \{\s*\.cookie-consent-dock\.cookie-consent-dock--launcher-only \{\s*position: static;/,
    );
  });

  it('saves only the categories that were ticked', () => {
    render(<CookieConsent language="en" />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Analytics' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save choice' }));

    expect(analyticsAllowed()).toBe(true);
    expect(preferencesAllowed()).toBe(false);
    expect(window.localStorage.getItem('fluxradar.language')).toBeNull();
    // Not everything is allowed, so the way back to the settings stays in view.
    expect(screen.getByRole('button', { name: 'Cookie settings' })).toBeVisible();
  });

  // A v1 record predates the analytics category: the banner has to ask again,
  // and it opens on the language permission the visitor already gave.
  it('asks a returning v1 visitor about analytics without dropping their language', () => {
    // One reading of the clock: the record is only valid when the lifetime is exact.
    const updatedAt = Date.now() - 1000;
    window.localStorage.setItem(
      'fluxradar.cookieConsent',
      JSON.stringify({
        version: 'v1',
        preferences: true,
        updatedAt,
        expiresAt: updatedAt + COOKIE_CONSENT_TTL_MS,
      }),
    );
    render(<CookieConsent language="en" />);

    const banner = screen.getByRole('region', { name: 'Cookies & storage' });
    expect(within(banner).getByRole('checkbox', { name: 'Preferences' })).toBeChecked();
    expect(within(banner).getByRole('checkbox', { name: 'Analytics' })).not.toBeChecked();
    expect(preferencesAllowed()).toBe(true);
  });

  it('keeps the floating launcher after choosing only necessary storage', () => {
    render(<CookieConsent language="en" />);
    fireEvent.click(screen.getByRole('button', { name: 'Only necessary' }));
    expect(screen.getByRole('button', { name: 'Cookie settings' })).toBeVisible();
  });

  it('keeps a visible error and allows retry when consent storage is blocked', () => {
    const storage = window.localStorage;
    const getter = vi.spyOn(window, 'localStorage', 'get').mockReturnValue(
      new Proxy(storage, {
        get: (target, property) =>
          property === 'setItem'
            ? () => {
                throw new DOMException('Storage blocked', 'SecurityError');
              }
            : Reflect.get(target, property),
      }),
    );
    render(<CookieConsent language="en" />);
    fireEvent.click(screen.getByRole('button', { name: 'Allow all' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Your choice could not be saved');
    expect(screen.getByRole('region', { name: 'Cookies & storage' })).toBeVisible();
    expect(preferencesAllowed()).toBe(false);
    getter.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Only necessary' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cookie settings' })).toBeVisible();
  });

  it('explains a failed language save and leaves preferences disabled', () => {
    const storage = window.localStorage;
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(
      new Proxy(storage, {
        get: (target, property) =>
          property === 'setItem'
            ? (key: string, value: string) => {
                if (key === 'fluxradar.language')
                  throw new DOMException('Storage full', 'QuotaExceededError');
                target.setItem(key, value);
              }
            : Reflect.get(target, property),
      }),
    );
    render(<CookieConsent language="en" />);
    fireEvent.click(screen.getByRole('button', { name: 'Allow all' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Your language could not be saved');
    expect(preferencesAllowed()).toBe(false);
    // Only the category that failed is withdrawn; analytics was allowed and stays so.
    expect(analyticsAllowed()).toBe(true);
    expect(screen.getByRole('region')).toBeVisible();
  });

  it('synchronizes saved choices and storage deletion from another tab', () => {
    render(<CookieConsent language="en" />);
    // One reading of the clock: the record is only valid when the lifetime is exact.
    const updatedAt = Date.now();
    act(() => {
      window.localStorage.setItem(
        'fluxradar.cookieConsent',
        JSON.stringify({
          version: 'v2',
          preferences: false,
          analytics: false,
          updatedAt,
          expiresAt: updatedAt + COOKIE_CONSENT_TTL_MS,
        }),
      );
      window.dispatchEvent(new StorageEvent('storage', { key: 'fluxradar.cookieConsent' }));
    });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    act(() => {
      window.localStorage.removeItem('fluxradar.cookieConsent');
      window.dispatchEvent(new StorageEvent('storage', { key: 'fluxradar.cookieConsent' }));
    });
    expect(screen.getByRole('region')).toBeVisible();
  });

  it('synchronizes a local save and can be reopened from a legal-page settings button', () => {
    render(
      <>
        <CookieSettingsButton language="en" />
        <CookieConsent language="en" />
      </>,
    );
    act(() => {
      saveCookieConsent({ preferences: false, analytics: false });
    });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Cookie settings' })[0] as HTMLElement);
    expect(screen.getByRole('region')).toBeVisible();
  });

  it('reopens when a saved choice expires while the page remains open', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T12:00:00Z'));
    saveCookieConsent({ preferences: false, analytics: false });
    vi.setSystemTime(new Date('2027-03-09T11:59:59Z'));
    render(<CookieConsent language="en" />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('region')).toBeVisible();
  });
});
