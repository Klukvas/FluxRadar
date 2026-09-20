import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SupportWidget } from './SupportWidget';

function envelope<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function failure(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ success: false, data: null, error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubApi(handler: (path: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(new URL(String(input)).pathname, init)),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The support channel is connected and every request is delivered. */
function availableApi(path: string): Response {
  if (path === '/support/status') return envelope({ available: true });
  if (path === '/support') return envelope({ status: 'sent' });
  return failure(404, 'NOT_FOUND', 'route not found');
}

function sentBodies(fetchMock: ReturnType<typeof stubApi>): unknown[] {
  return fetchMock.mock.calls
    .filter(
      ([input, init]) => new URL(String(input)).pathname === '/support' && init?.method === 'POST',
    )
    .map(([, init]) => JSON.parse(String(init?.body)));
}

async function openForm(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: 'Contact support' }));
  return screen.getByRole('dialog', { name: 'Contact support' });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/reports?scan=scan-1');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('support widget', () => {
  it('offers no launcher when the deployment has no support channel', async () => {
    const fetchMock = stubApi((path) =>
      path === '/support/status' ? envelope({ available: false }) : availableApi(path),
    );

    render(<SupportWidget language="en" accountEmail={null} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'Contact support' })).not.toBeInTheDocument();
  });

  it('asks a guest for an address, explains what is missing, and sends the request', async () => {
    const fetchMock = stubApi(availableApi);
    render(<SupportWidget language="en" accountEmail={null} />);

    const dialog = await openForm();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send message' }));

    expect(
      within(dialog).getByText('Enter the email address we should reply to.'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Write a subject of at least 3 characters.'),
    ).toBeInTheDocument();
    expect(sentBodies(fetchMock)).toHaveLength(0);

    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Email/ }), {
      target: { value: ' guest@example.com ' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Subject/ }), {
      target: { value: 'Report is empty' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Message/ }), {
      target: { value: 'The Basic report shows no issues at all.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send message' }));

    expect(
      await within(dialog).findByRole('heading', { name: 'Message sent' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Thank you — we will reply to guest@example.com.'),
    ).toBeInTheDocument();
    expect(sentBodies(fetchMock)).toEqual([
      {
        subject: 'Report is empty',
        message: 'The Basic report shows no issues at all.',
        email: 'guest@example.com',
        page: '/reports',
        language: 'en',
      },
    ]);
  });

  it('replies to a signed-in owner at the account address without asking for one', async () => {
    const fetchMock = stubApi(availableApi);
    render(<SupportWidget language="en" accountEmail="owner@example.com" />);

    const dialog = await openForm();

    expect(within(dialog).queryByRole('textbox', { name: /^Email/ })).not.toBeInTheDocument();
    expect(
      within(dialog).getByText('We will reply to owner@example.com, the address of this account.'),
    ).toBeInTheDocument();

    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Subject/ }), {
      target: { value: 'Billing question' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Message/ }), {
      target: { value: 'Can I upgrade a finished Basic scan?' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send message' }));

    await within(dialog).findByRole('heading', { name: 'Message sent' });
    expect(sentBodies(fetchMock)).toEqual([
      {
        subject: 'Billing question',
        message: 'Can I upgrade a finished Basic scan?',
        page: '/reports',
        language: 'en',
      },
    ]);
  });

  it('asks for an address after all when the session ended while the page was open', async () => {
    stubApi((path) =>
      path === '/support'
        ? failure(400, 'SUPPORT_EMAIL_REQUIRED', 'an email address is required when not signed in')
        : availableApi(path),
    );
    render(<SupportWidget language="en" accountEmail="owner@example.com" />);

    const dialog = await openForm();
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Subject/ }), {
      target: { value: 'Billing question' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Message/ }), {
      target: { value: 'Can I upgrade a finished Basic scan?' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send message' }));

    expect(
      await within(dialog).findByText(
        'Your session has ended. Add the email address we should reply to.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: /^Email/ })).toBeInTheDocument();
  });

  it('explains a refused request in the visitor language, from its code', async () => {
    stubApi((path) =>
      path === '/support'
        ? failure(429, 'RATE_LIMITED', 'too many requests, try again later')
        : availableApi(path),
    );
    render(<SupportWidget language="uk" accountEmail="owner@example.com" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Звернутися до підтримки' }));
    const dialog = screen.getByRole('dialog', { name: 'Звернутися до підтримки' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Тема/ }), {
      target: { value: 'Питання' },
    });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Повідомлення/ }), {
      target: { value: 'Звіт не відкривається.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Надіслати' }));

    expect(
      await within(dialog).findByText(
        'Ви надіслали кілька повідомлень за короткий час. Спробуйте за кілька хвилин.',
      ),
    ).toBeInTheDocument();
  });

  it('closes on Escape and hands focus back to the launcher', async () => {
    stubApi(availableApi);
    render(<SupportWidget language="en" accountEmail={null} />);

    const launcher = await screen.findByRole('button', { name: 'Contact support' });
    launcher.focus();
    fireEvent.click(launcher);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(launcher);
  });
});
