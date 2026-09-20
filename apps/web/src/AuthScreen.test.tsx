// The sign-in dialog speaks the page's language, and a reset link asks for one
// password — it used to draw the sign-in field and "New password" together,
// both bound to the same value.

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
});
