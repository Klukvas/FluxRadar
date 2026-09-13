import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CookieConsent, CookieSettingsButton } from './CookieConsent';
import { preferencesAllowed, saveCookieConsent } from './browser-consent';

beforeEach(() => {
  saveCookieConsent(false);
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
  it('offers two equal choices on first visit in a nonmodal region without moving focus', () => {
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
    expect(within(banner).getByRole('button', { name: 'Allow preferences' })).toBeEnabled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(banner).not.toHaveAttribute('aria-modal');
    expect(document.activeElement).toBe(browsing);
    expect(window.localStorage.getItem('fluxradar.language')).toBeNull();
    expect(within(banner).getByRole('link', { name: 'Cookie details' })).toHaveAttribute(
      'href',
      '/cookies?lang=en',
    );
  });

  it('allows the current language, reopens settings, and withdraws only that preference', () => {
    window.localStorage.setItem('fluxradar.pendingCheckout', 'pending-test');
    const view = render(<CookieConsent language="uk" />);
    fireEvent.click(screen.getByRole('button', { name: 'Дозволити налаштування' }));
    expect(preferencesAllowed()).toBe(true);
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
    fireEvent.click(screen.getByRole('button', { name: 'Лише необхідні' }));
    expect(preferencesAllowed()).toBe(false);
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
    fireEvent.click(screen.getByRole('button', { name: 'Allow preferences' }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Cookie settings' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Cookie settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Only necessary' }));

    expect(screen.getAllByRole('button', { name: 'Cookie settings' })).toHaveLength(2);
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
    fireEvent.click(screen.getByRole('button', { name: 'Allow preferences' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Allow preferences' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Your language could not be saved');
    expect(preferencesAllowed()).toBe(false);
    expect(screen.getByRole('region')).toBeVisible();
  });

  it('synchronizes saved choices and storage deletion from another tab', () => {
    render(<CookieConsent language="en" />);
    act(() => {
      window.localStorage.setItem(
        'fluxradar.cookieConsent',
        JSON.stringify({
          version: 'v1',
          preferences: false,
          updatedAt: Date.now(),
          expiresAt: Date.now() + 15_552_000_000,
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
      saveCookieConsent(false);
    });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Cookie settings' })[0] as HTMLElement);
    expect(screen.getByRole('region')).toBeVisible();
  });

  it('reopens when a saved choice expires while the page remains open', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T12:00:00Z'));
    saveCookieConsent(false);
    vi.setSystemTime(new Date('2027-03-09T11:59:59Z'));
    render(<CookieConsent language="en" />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('region')).toBeVisible();
  });
});
