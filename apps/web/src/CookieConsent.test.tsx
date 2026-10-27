import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CookieConsent, CookieSettingsButton } from './CookieConsent';
import {
  COOKIE_CONSENT_TTL_MS,
  COOKIE_CONSENT_VERSION,
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
  it('opens on a suggested choice that stores nothing, in a nonmodal region without moving focus', () => {
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
    expect(within(banner).getByRole('button', { name: 'Accept all' })).toBeEnabled();
    expect(within(banner).getByRole('button', { name: 'Only necessary' })).toBeEnabled();
    expect(within(banner).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(banner).queryByRole('button', { name: 'Save choice' })).not.toBeInTheDocument();
    const customize = within(banner).getByRole('button', { name: 'Customize' });
    expect(customize).toHaveAttribute('aria-expanded', 'false');
    expect(
      document.getElementById(customize.getAttribute('aria-controls') ?? ''),
    ).not.toBeVisible();
    fireEvent.click(customize);
    expect(customize).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(customize.getAttribute('aria-controls') ?? '')).toBeVisible();
    expect(within(banner).getAllByRole('checkbox')).toHaveLength(2);
    expect(within(banner).getByRole('checkbox', { name: 'Preferences' })).toBeChecked();
    expect(within(banner).getByRole('checkbox', { name: 'Analytics' })).toBeChecked();
    expect(preferencesAllowed()).toBe(false);
    expect(analyticsAllowed()).toBe(false);
    expect(window.localStorage.getItem('fluxradar.cookieConsent')).toBeNull();
    expect(window.localStorage.getItem('fluxradar.language')).toBeNull();
    expect(within(banner).getByRole('checkbox', { name: 'Analytics' })).toHaveAccessibleDescription(
      /Google Analytics 4/,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(banner).not.toHaveAttribute('aria-modal');
    expect(document.activeElement).toBe(browsing);
    expect(within(banner).getByRole('link', { name: 'Cookie details' })).toHaveAttribute(
      'href',
      '/cookies',
    );
  });

  it('saves the suggested choice, reopens settings with it, and withdraws it all', () => {
    window.localStorage.setItem('fluxradar.pendingCheckout', 'pending-test');
    const view = render(<CookieConsent language="uk" />);
    fireEvent.click(screen.getByRole('button', { name: 'Прийняти все' }));
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
      '/uk/cookies',
    );
    expect(screen.getByRole('checkbox', { name: 'Налаштування' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Аналітика' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Налаштувати' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Лише необхідне' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Accept all' }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Cookie settings' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Cookie settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Only necessary' }));

    expect(screen.getAllByRole('button', { name: 'Cookie settings' })).toHaveLength(2);
  });

  // On a phone the lone launcher must not float over the page. Layout is not
  // computed here, so what is pinned is the decision: the dock exists only when
  // the launcher is all there is to show, it carries the class the phone rule
  // keys on, and that rule takes it out of the fixed layer while the open
  // banner keeps floating in its own centred layer.
  it('marks the dock that holds only the launcher, so a phone can drop it into the page', () => {
    const view = render(<CookieConsent language="en" />);
    expect(view.container.querySelector('.cookie-consent-dock')).toBeNull();
    expect(view.container.querySelector('.cookie-consent-layer')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Only necessary' }));

    expect(view.container.querySelector('.cookie-consent-layer')).toBeNull();
    expect(view.container.querySelector('.cookie-consent-dock')).toHaveClass(
      'cookie-consent-dock--launcher-only',
    );

    const css = readFileSync(
      join(resolve(process.cwd()), 'src', 'styles', 'cookie-consent.css'),
      'utf8',
    );
    expect(css).toMatch(
      /@media \(max-width: 699px\) \{\s*\.cookie-consent-dock\.cookie-consent-dock--launcher-only \{\s*position: static;/,
    );
  });

  it('saves only the categories that were left ticked', () => {
    render(<CookieConsent language="en" />);
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Preferences' }));
    expect(window.localStorage.getItem('fluxradar.cookieConsent')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save choice' }));

    expect(analyticsAllowed()).toBe(true);
    expect(preferencesAllowed()).toBe(false);
    expect(window.localStorage.getItem('fluxradar.language')).toBeNull();
    // Not everything is allowed, so the way back to the settings stays in view.
    expect(screen.getByRole('button', { name: 'Cookie settings' })).toBeVisible();
  });

  it('can collapse customization without storing its draft', () => {
    render(<CookieConsent language="en" />);
    const customize = screen.getByRole('button', { name: 'Customize' });
    fireEvent.click(customize);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Analytics' }));
    fireEvent.click(customize);
    expect(customize).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('fluxradar.cookieConsent')).toBeNull();
    fireEvent.click(customize);
    expect(screen.getByRole('checkbox', { name: 'Analytics' })).not.toBeChecked();
  });

  // Pre-ticking is only defensible while it is a draft. A visitor who has
  // already refused must not be shown their refusal as a suggestion to accept.
  it('reopens a stored refusal as a refusal, not as the suggested choice', () => {
    saveCookieConsent({ preferences: false, analytics: false });
    render(
      <>
        <CookieSettingsButton language="en" />
        <CookieConsent language="en" />
      </>,
    );
    // Two of them while a choice is outstanding: the page's own and the
    // floating launcher. Either opens the same form.
    fireEvent.click(screen.getAllByRole('button', { name: 'Cookie settings' })[0] as HTMLElement);

    expect(screen.getByRole('checkbox', { name: 'Preferences' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Analytics' })).not.toBeChecked();
  });

  it('reopens a partial choice exactly as it was stored', () => {
    saveCookieConsent({ preferences: true, analytics: false });
    render(
      <>
        <CookieSettingsButton language="en" />
        <CookieConsent language="en" />
      </>,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Cookie settings' })[0] as HTMLElement);

    expect(screen.getByRole('checkbox', { name: 'Preferences' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Analytics' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Customize' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
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
    render(
      <>
        <CookieSettingsButton language="en" />
        <CookieConsent language="en" />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cookie settings' }));
    const banner = screen.getByRole('region', { name: 'Cookies & storage' });
    expect(within(banner).getByRole('button', { name: 'Customize' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
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
    fireEvent.click(screen.getByRole('button', { name: 'Accept all' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Your choice could not be saved');
    expect(screen.getByRole('region', { name: 'Cookies & storage' })).toBeVisible();
    expect(preferencesAllowed()).toBe(false);
    expect(analyticsAllowed()).toBe(false);
    getter.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Only necessary' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cookie settings' })).toBeVisible();
  });

  // The retry has to start from what the visitor asked for, not from the
  // suggestion: a refusal that could not be written, shown back with both
  // boxes ticked, is how a refusal becomes an acceptance.
  it('keeps a refusal that could not be saved on screen as a refusal', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Only necessary' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Your choice could not be saved');
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    expect(screen.getByRole('checkbox', { name: 'Preferences' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Analytics' })).not.toBeChecked();
    getter.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Save choice' }));
    expect(preferencesAllowed()).toBe(false);
    expect(analyticsAllowed()).toBe(false);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('keeps the expanded mixed draft after a failed granular save', () => {
    render(<CookieConsent language="en" />);
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Analytics' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Save choice' }));
    expect(screen.getByRole('button', { name: 'Customize' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('checkbox', { name: 'Preferences' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Analytics' })).not.toBeChecked();
    expect(screen.getByRole('alert')).toHaveTextContent('Your choice could not be saved');
    getter.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Save choice' }));
    expect(preferencesAllowed()).toBe(true);
    expect(analyticsAllowed()).toBe(false);
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
    fireEvent.click(screen.getByRole('button', { name: 'Accept all' }));
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
          version: COOKIE_CONSENT_VERSION,
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
