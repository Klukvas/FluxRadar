// The sign-in dialog speaks the page's language, and a reset link asks for one
// password — it used to draw the sign-in field and "New password" together,
// both bound to the same value.
//
// Two more defects of the same kind are pinned here: the form asked a
// cookie-lifetime question nobody came here to answer, and its one text-shaped
// control borrowed the home page's white-on-dark rule, so "Forgot password?"
// was white text on the dialog's platinum face.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthScreen } from './AuthScreen';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAuth(props: Partial<Parameters<typeof AuthScreen>[0]> = {}) {
  render(
    <AuthScreen
      language="en"
      onAuthed={async () => {}}
      error={null}
      onError={() => {}}
      onBack={() => {}}
      initialMode="register"
      emailAction={null}
      {...props}
    />,
  );
}

describe('the sign-in dialog', () => {
  it('is written in Ukrainian for a Ukrainian reader, buttons and all', () => {
    renderAuth({ language: 'uk' });

    expect(screen.getByRole('heading', { name: 'Створіть акаунт FluxRadar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Створити акаунт' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'У мене вже є акаунт' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'На головну' })).toBeInTheDocument();
    expect(screen.getByLabelText('Пароль')).toBeInTheDocument();
    for (const english of ['Create account', 'Back to home', 'Password', 'Working…']) {
      expect(screen.queryByText(english)).not.toBeInTheDocument();
    }
  });

  it('asks for exactly one password when a reset link is followed', () => {
    renderAuth({ emailAction: { kind: 'reset', token: 'reset-token-0123456789' } });

    expect(screen.getByRole('heading', { name: 'Set a new password' })).toBeInTheDocument();
    expect(document.querySelectorAll('input[name="password"]')).toHaveLength(1);
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
  });

  it('can show the password it is being given', () => {
    renderAuth();
    const field = screen.getByLabelText('Password') as HTMLInputElement;
    expect(field.type).toBe('password');

    screen.getByRole('checkbox', { name: 'Show password' }).click();

    expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('text');
  });

  it('names the site a visitor typed on the home page', () => {
    renderAuth({ pendingSite: 'shop.example.com' });
    expect(
      screen.getByText(/FluxRadar checks the homepage of shop\.example\.com straight away/),
    ).toBeInTheDocument();
  });

  it('offers no session-lifetime question, in either language', () => {
    renderAuth({ initialMode: 'login' });
    expect(screen.queryByRole('checkbox', { name: /Remember me/ })).not.toBeInTheDocument();
    // The lifetime is still stated — it just is not a decision any more.
    expect(
      screen.getByText(/necessary cookie that lasts for this browser session/),
    ).toBeInTheDocument();
    cleanup();

    renderAuth({ initialMode: 'login', language: 'uk' });
    expect(screen.queryByRole('checkbox', { name: /Запамʼятати/ })).not.toBeInTheDocument();
  });

  it('offers the password reset on a control of its own, not the home page’s', () => {
    renderAuth({ initialMode: 'login' });
    const forgot = screen.getByRole('button', { name: 'Forgot password?' });
    expect(forgot).toHaveClass('auth__text-action');
    expect(forgot).not.toHaveClass('home__text-action');
  });
});

// happy-dom lays out no CSS, so what is pinned is the decision the stylesheet
// encodes: the colour this control declares, and that it is legible on the
// window face it sits on. Geometry and rendering are checked in a browser.
describe('the password-reset control’s own colour', () => {
  const BASE_CSS = readFileSync(join(resolve(process.cwd()), 'src', 'styles', 'base.css'), 'utf8');
  const TOKENS_CSS = readFileSync(
    join(resolve(process.cwd()), 'src', 'styles', 'tokens.css'),
    'utf8',
  );

  /** The body of a rule, so an assertion cannot match a declaration next door. */
  function rule(selector: string): string {
    const start = BASE_CSS.indexOf(`${selector} {`);
    if (start === -1) throw new Error(`base.css has no rule for ${selector}`);
    return BASE_CSS.slice(start, BASE_CSS.indexOf('}', start));
  }

  /** The hex a `--token` resolves to, read from the one file that defines them. */
  function token(name: string): string {
    const value = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})\\s*;`, 'i').exec(TOKENS_CSS)?.[1];
    if (value === undefined) throw new Error(`tokens.css defines no --${name}`);
    return value;
  }

  /** WCAG 2.1 contrast ratio, 1–21. */
  function contrast(foreground: string, background: string): number {
    const luminance = (hex: string): number => {
      const packed = Number.parseInt(hex.slice(1), 16);
      const linear = (channel: number): number =>
        channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      return (
        0.2126 * linear(((packed >> 16) & 0xff) / 255) +
        0.7152 * linear(((packed >> 8) & 0xff) / 255) +
        0.0722 * linear((packed & 0xff) / 255)
      );
    };
    return (
      (Math.max(luminance(foreground), luminance(background)) + 0.05) /
      (Math.min(luminance(foreground), luminance(background)) + 0.05)
    );
  }

  it('paints it in the app’s link blue rather than the home page’s white', () => {
    const control = rule('.auth__text-action');
    expect(control).toMatch(/color: var\(--selection\);/);
    expect(control).not.toMatch(/color: #fff/);
  });

  it('is readable on the window face the dialog is drawn on', () => {
    // AA body text asks for 4.5:1; this is the pair that used to be 1.4:1.
    expect(contrast(token('selection'), token('plat-100'))).toBeGreaterThanOrEqual(4.5);
  });
});
