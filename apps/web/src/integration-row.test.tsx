import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IntegrationsScreen } from './Integrations';
import { copy, type Language } from './i18n';

// ─── A connection row: what it gives you, and where its controls sit ─────────
//
// Two findings from the production screen are pinned here.
//
// The status chip lived in the copy column beside the connection's name while
// the button lived in a column centred on the whole row, so the two only lined
// up when the copy happened to be one line tall. They are one pair now, in one
// container, and this asserts that pairing rather than the pixels — the
// geometry itself is checked in a real browser.
//
// And the row listed which services a connection covers without ever saying,
// in a customer's words, what connecting gets them. Every provider carries that
// sentence now, in both languages, and the button that starts the connection is
// described by it.
// ─────────────────────────────────────────────────────────────────────────────

const en = copy.en.integrations;
const uk = copy.uk.integrations;

const googleRow = {
  provider: 'google',
  label: 'Google data',
  kind: 'user' as const,
  status: 'available' as const,
  services: ['Google Search Console', 'Google Analytics 4'],
  canConnect: true,
  lastCheckedAt: null,
  lastError: null,
};

const bingRow = {
  provider: 'bing',
  label: 'Bing Webmaster Tools',
  kind: 'user' as const,
  status: 'available' as const,
  services: ['Bing Webmaster Tools'],
  canConnect: true,
  lastCheckedAt: null,
  lastError: null,
};

interface Call {
  readonly path: string;
  readonly method: string;
}

function envelope<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function stubApi(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = new URL(String(input)).pathname;
      calls.push({ path, method: (init.method ?? 'GET').toUpperCase() });
      if (path === '/integrations') return Promise.resolve(envelope([googleRow, bingRow]));
      if (path.endsWith('/start'))
        return Promise.resolve(envelope({ authorizationUrl: 'https://provider.example/oauth' }));
      return Promise.resolve(envelope(null));
    }),
  );
  return calls;
}

function renderScreen(language: Language = 'en') {
  render(
    <IntegrationsScreen
      profiles={[]}
      language={language}
      onClose={() => undefined}
      onAddProfile={() => undefined}
      onProfilesChanged={() => Promise.resolve()}
      onError={() => undefined}
    />,
  );
}

/** The row a connection owns, found by the heading that names it. */
async function findRow(name: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name });
  const row = heading.closest('.integration-row');
  if (!(row instanceof HTMLElement)) throw new Error(`no row around the ${name} heading`);
  return row;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a connection’s status and its action', () => {
  it('holds the chip and the button in one container, not in two columns', async () => {
    stubApi();
    renderScreen();

    const row = await findRow('Google data');
    const action = row.querySelector('.integration-row__action');
    const copyColumn = row.querySelector('.integration-row__copy');
    const chip = within(row).getByText(en.readyToConnect);
    const button = within(row).getByRole('button', { name: en.connect });

    expect(action).toContainElement(chip);
    expect(action).toContainElement(button);
    // The old placement — the chip beside the name, a column away from the
    // control it reports on — is what could not stay aligned.
    expect(copyColumn).not.toContainElement(chip);
  });

  it('still starts the connection the row offers', async () => {
    const calls = stubApi();
    vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
    renderScreen();

    const row = await findRow('Google data');
    fireEvent.click(within(row).getByRole('button', { name: en.connect }));

    await waitFor(() => {
      expect(calls).toContainEqual({ path: '/integrations/google/start', method: 'POST' });
    });
    expect(window.location.assign).toHaveBeenCalledWith('https://provider.example/oauth');
  });
});

// Bing is built — the OAuth start, the property picker, the report panel — and
// deliberately not offered yet. The API still answers with the row; the screen
// is the one place that decides not to list it, so turning it back on is a
// one-line change rather than a rebuild.
describe('a connection the screen does not offer yet', () => {
  it('lists nothing for Bing even though the API still answers with it', async () => {
    stubApi();
    renderScreen();

    await screen.findByRole('heading', { name: 'Google data' });
    expect(screen.queryByRole('heading', { name: 'Bing Webmaster Tools' })).not.toBeInTheDocument();
    expect(screen.queryByText(en.whyConnect.bing)).not.toBeInTheDocument();
    // One row, one connect button: the hidden one cannot be reached at all.
    expect(screen.getAllByRole('button', { name: en.connect })).toHaveLength(1);
  });

  it('keeps the copy it will need when the row comes back', () => {
    expect(en.whyConnect.bing).toBeTruthy();
    expect(uk.whyConnect.bing).toBeTruthy();
  });
});

describe('why a customer would connect', () => {
  it('explains each connection in English and describes its button with it', async () => {
    stubApi();
    renderScreen();

    const row = await findRow('Google data');
    expect(within(row).getByText(en.whyConnect.google)).toBeInTheDocument();

    const described = within(row)
      .getByRole('button', { name: en.connect })
      .getAttribute('aria-describedby');
    expect(described).not.toBeNull();
    expect(document.getElementById(described ?? '')).toHaveTextContent(en.whyConnect.google);
  });

  it('explains each connection in Ukrainian', async () => {
    stubApi();
    renderScreen('uk');

    expect(await screen.findByText(uk.whyConnect.google)).toBeInTheDocument();
    expect(screen.queryByText(en.whyConnect.google)).not.toBeInTheDocument();
  });

  it('keeps the explanation read-only and never makes a connection a condition', () => {
    expect(en.whyConnect.google).toMatch(/only reads/i);
    expect(en.whyConnect.bing).toMatch(/read-only/i);
    expect(uk.whyConnect.google).toMatch(/лише читає/);
    expect(uk.whyConnect.bing).toMatch(/лише читання/);

    for (const language of ['en', 'uk'] as const) {
      for (const reason of Object.values(copy[language].integrations.whyConnect)) {
        // No credential ask, and nothing that reads as "the scan needs this".
        expect(reason).not.toMatch(/password|login|CMS|required|пароль|логін|обовʼязков/i);
      }
    }
    // The screen still says out loud that scans run without any of this.
    expect(en.lead).toMatch(/without them/i);
    expect(uk.lead).toMatch(/без них/);
  });
});

describe('disconnecting a connection', () => {
  const connectedGoogle = { ...googleRow, status: 'connected' as const };

  function stubConnected(): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
        const path = new URL(String(input)).pathname;
        calls.push({ path, method: (init.method ?? 'GET').toUpperCase() });
        if (path === '/integrations') return Promise.resolve(envelope([connectedGoogle]));
        return Promise.resolve(envelope(null));
      }),
    );
    return calls;
  }

  it('asks before disconnecting, cancels cleanly, and disconnects on confirm', async () => {
    const calls = stubConnected();
    renderScreen();

    const row = await findRow('Google data');
    fireEvent.click(within(row).getByRole('button', { name: en.disconnect }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(en.disconnectTitle('Google data'));

    fireEvent.click(within(dialog).getByRole('button', { name: en.keepConnection }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls).not.toContainEqual({ path: '/integrations/google', method: 'DELETE' });

    fireEvent.click(within(row).getByRole('button', { name: en.disconnect }));
    const reopened = await screen.findByRole('dialog');
    fireEvent.click(within(reopened).getByRole('button', { name: en.disconnect }));
    await waitFor(() => {
      expect(calls).toContainEqual({ path: '/integrations/google', method: 'DELETE' });
    });
  });

  it('closes the confirm on Escape without disconnecting', async () => {
    const calls = stubConnected();
    renderScreen();

    const row = await findRow('Google data');
    fireEvent.click(within(row).getByRole('button', { name: en.disconnect }));
    await screen.findByRole('dialog');

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls).not.toContainEqual({ path: '/integrations/google', method: 'DELETE' });
  });

  it('holds every disconnect trigger while a disconnect is in flight', async () => {
    let release: (value: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
        const path = new URL(String(input)).pathname;
        if (path === '/integrations') return Promise.resolve(envelope([connectedGoogle]));
        if (path === '/integrations/google' && (init.method ?? 'GET').toUpperCase() === 'DELETE') {
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        }
        return Promise.resolve(envelope(null));
      }),
    );
    renderScreen();

    const row = await findRow('Google data');
    fireEvent.click(within(row).getByRole('button', { name: en.disconnect }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.disconnect }));

    const busy = await within(row).findByRole('button', { name: en.disconnecting });
    expect(busy).toBeDisabled();
    release(envelope(null));
    await waitFor(() => {
      expect(within(row).queryByRole('button', { name: en.disconnecting })).not.toBeInTheDocument();
    });
  });

  // The screen owns one busy slot; a Connect started while a disconnect is in
  // flight would overwrite it and leave the first operation unlabelled.
  it('holds other providers Connect buttons while a disconnect is in flight', async () => {
    const youtube = {
      provider: 'youtube',
      label: 'YouTube',
      kind: 'user' as const,
      status: 'available' as const,
      services: ['YouTube Data API'],
      canConnect: true,
      lastCheckedAt: null,
      lastError: null,
    };
    let release: (value: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
        const path = new URL(String(input)).pathname;
        if (path === '/integrations') return Promise.resolve(envelope([connectedGoogle, youtube]));
        if (path === '/integrations/google' && (init.method ?? 'GET').toUpperCase() === 'DELETE') {
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        }
        return Promise.resolve(envelope(null));
      }),
    );
    renderScreen();

    const google = await findRow('Google data');
    fireEvent.click(within(google).getByRole('button', { name: en.disconnect }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: en.disconnect }));
    await within(google).findByRole('button', { name: en.disconnecting });

    const youtubeRow = await findRow('YouTube');
    expect(within(youtubeRow).getByRole('button', { name: en.connect })).toBeDisabled();

    release(envelope(null));
    await waitFor(() => {
      expect(
        within(google).queryByRole('button', { name: en.disconnecting }),
      ).not.toBeInTheDocument();
    });
    expect(within(youtubeRow).getByRole('button', { name: en.connect })).toBeEnabled();
  });
});
