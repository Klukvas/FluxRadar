// A sign-in sent with empty fields used to show the visitor the API's schema
// summary verbatim: "email: Invalid email address; password: Too small:
// expected string to have >=1 characters". These pin the replacement: the form
// checks the usual mistakes itself, in the reader's language, before anything
// is sent, and a VALIDATION refusal that still gets through is never shown as
// the server worded it.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthScreen } from './AuthScreen';
import { authFormProblem } from './auth-validation';

const SCHEMA_SUMMARY = 'password: Too small: expected string to have >=8 characters';

type FetchMock = ReturnType<typeof vi.fn>;

function stubFetch(authResponse?: () => Response): FetchMock {
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    if (url.endsWith('/auth/google/status')) {
      return new Response(JSON.stringify({ success: true, data: { enabled: false }, error: null }));
    }
    if (authResponse === undefined) throw new Error(`unexpected request to ${url}`);
    return authResponse();
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function authRequests(fetchMock: FetchMock): unknown[] {
  return fetchMock.mock.calls.filter(([url]) => !String(url).endsWith('/auth/google/status'));
}

function renderAuth(props: Partial<Parameters<typeof AuthScreen>[0]> = {}) {
  const onError = vi.fn();
  render(
    <AuthScreen
      language="en"
      onAuthed={async () => {}}
      error={null}
      onError={onError}
      onBack={() => {}}
      initialMode="login"
      emailAction={null}
      {...props}
    />,
  );
  return onError;
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('authFormProblem', () => {
  it('asks for the email first, then the password', () => {
    expect(authFormProblem({ kind: 'login', email: '', password: '' })).toBe('emailMissing');
    expect(authFormProblem({ kind: 'login', email: '  ', password: 'x' })).toBe('emailMissing');
    expect(authFormProblem({ kind: 'login', email: 'a@b.co', password: '' })).toBe(
      'passwordMissing',
    );
  });

  it('rejects an address that is plainly not one', () => {
    for (const email of ['owner', 'owner@', '@site.com', 'owner@site', 'own er@site.com']) {
      expect(authFormProblem({ kind: 'forgot', email, password: '' })).toBe('emailInvalid');
    }
    expect(authFormProblem({ kind: 'forgot', email: 'owner@site.com', password: '' })).toBeNull();
  });

  it('holds a new password to 8 characters but lets an old one through', () => {
    expect(authFormProblem({ kind: 'register', email: 'a@b.co', password: 'short' })).toBe(
      'passwordTooShort',
    );
    expect(authFormProblem({ kind: 'reset', email: '', password: 'short' })).toBe(
      'passwordTooShort',
    );
    expect(authFormProblem({ kind: 'login', email: 'a@b.co', password: 'short' })).toBeNull();
    expect(authFormProblem({ kind: 'register', email: 'a@b.co', password: 'long-enough' })).toBe(
      null,
    );
  });

  it('counts the 72-byte limit in bytes, as the server does', () => {
    expect(authFormProblem({ kind: 'login', email: 'a@b.co', password: 'я'.repeat(37) })).toBe(
      'passwordTooLong',
    );
    expect(
      authFormProblem({ kind: 'login', email: 'a@b.co', password: 'я'.repeat(36) }),
    ).toBeNull();
  });
});

describe('the sign-in form with something missing', () => {
  it('says what is missing and sends nothing', async () => {
    const fetchMock = stubFetch();
    const onError = renderAuth();

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(onError).toHaveBeenLastCalledWith('Enter your email address.'));
    expect(authRequests(fetchMock)).toHaveLength(0);
  });

  it('speaks the reader’s language', async () => {
    const onError = renderAuth({ language: 'ru' });

    fill('Email', 'owner@site.com');
    fireEvent.click(screen.getByRole('button', { name: 'Войти' }));

    await waitFor(() => expect(onError).toHaveBeenLastCalledWith('Введите пароль.'));
  });

  it('checks the reset form’s email too', async () => {
    const fetchMock = stubFetch();
    const onError = renderAuth();

    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fill('Email', 'not-an-address');
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    await waitFor(() =>
      expect(onError).toHaveBeenLastCalledWith(
        'This email address does not look right. Check it for typos.',
      ),
    );
    expect(authRequests(fetchMock)).toHaveLength(0);
  });
});

describe('a VALIDATION refusal from the server', () => {
  it('is replaced by a plain sentence, never shown as worded', async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            success: false,
            data: null,
            error: { code: 'VALIDATION', message: SCHEMA_SUMMARY },
          }),
          { status: 400 },
        ),
    );
    const onError = renderAuth({ initialMode: 'register' });

    fill('Email', 'owner@site.com');
    fill('Password', 'long-enough');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() =>
      expect(onError).toHaveBeenLastCalledWith('Check the email and password and try again.'),
    );
    expect(onError).not.toHaveBeenCalledWith(SCHEMA_SUMMARY);
  });

  it('leaves the server’s other refusals as they are', async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            success: false,
            data: null,
            error: { code: 'INVALID_CREDENTIALS', message: 'Wrong email or password.' },
          }),
          { status: 401 },
        ),
    );
    const onError = renderAuth();

    fill('Email', 'owner@site.com');
    fill('Password', 'whatever');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(onError).toHaveBeenLastCalledWith('Wrong email or password.'));
  });
});
