import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SiteReachabilityPanel } from './SiteReachability';

// What a buyer is told before the pay button, about a site we may not be able
// to read. The panel decides nothing — `canPurchase` is the API's word, and the
// server re-derives it when the checkout opens — but it is where a refusal has
// to become understandable instead of arriving as a 409.

function envelope<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function stubApi(byMethod: { get?: unknown; post?: unknown }): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const answer = method === 'POST' ? byMethod.post : byMethod.get;
    if (answer === undefined) return Promise.reject(new Error('no stub'));
    return Promise.resolve(envelope(answer));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const REACHABLE = {
  state: 'reachable',
  startStatus: 200,
  accessControlSignals: [],
  checkedAt: '2026-09-21T12:00:00.000Z',
  expired: false,
  canPurchase: true,
};

const BLOCKED = {
  state: 'access-denied',
  startStatus: 403,
  accessControlSignals: ['server: cloudflare', 'cf-mitigated: challenge'],
  checkedAt: '2026-09-21T12:00:00.000Z',
  expired: false,
  canPurchase: false,
};

const NEVER_CHECKED = { state: null, checkedAt: null, expired: false, canPurchase: false };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPanel(profileId: string | null, onResult = vi.fn()) {
  render(
    <SiteReachabilityPanel
      language="en"
      profileId={profileId}
      resolveProfileId={async () => profileId ?? 'resolved-profile'}
      onResult={onResult}
    />,
  );
  return onResult;
}

describe('the site reachability panel', () => {
  it('asks about the country the scan will leave from, and asks again when it changes', async () => {
    // A site can let Kyiv in and refuse Frankfurt; a yes from one says nothing
    // about the other (D-228).
    const fetchMock = stubApi({ get: NEVER_CHECKED, post: REACHABLE });
    const props = {
      language: 'en' as const,
      profileId: 'profile-1',
      resolveProfileId: async () => 'profile-1',
      onResult: vi.fn(),
    };
    const { rerender } = render(<SiteReachabilityPanel {...props} egressLocationId="ua" />);
    await waitFor(() =>
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
        '/profiles/profile-1/reachability?egressLocation=ua',
      ),
    );

    fireEvent.click(await screen.findByRole('button', { name: /check/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({ egressLocation: 'ua' });
    });

    rerender(<SiteReachabilityPanel {...props} egressLocationId="de" />);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).endsWith('reachability?egressLocation=de'),
        ),
      ).toBe(true),
    );
  });

  it('reads the last answer for a saved profile without being asked', async () => {
    const fetchMock = stubApi({ get: REACHABLE });
    const onResult = renderPanel('profile-1');

    expect(await screen.findByText(/let our crawler read a page/)).toBeInTheDocument();
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    // A read, not a probe: taking a fresh one reaches somebody else's server.
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.method).toBeUndefined();
  });

  it('says a site has never been checked instead of implying it failed', async () => {
    stubApi({ get: NEVER_CHECKED });
    const onResult = renderPanel('profile-1');

    expect(await screen.findByText('Not checked yet.')).toBeInTheDocument();
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it('explains a blocked site in terms of what its owner can change', async () => {
    stubApi({ get: NEVER_CHECKED, post: BLOCKED });
    const onResult = renderPanel('profile-1');
    await screen.findByText('Not checked yet.');

    fireEvent.click(screen.getByRole('button', { name: 'Check the site' }));

    expect(
      await screen.findByText(/Allow FluxRadarBot and the address it comes from/),
    ).toBeInTheDocument();
    // Named, so the owner knows which console to open, and kept apart from the
    // verdict — a site may sit behind Cloudflare and answer perfectly well.
    expect(screen.getByText(/server: cloudflare/)).toBeInTheDocument();
    expect(screen.getByText('Your site answered with HTTP 403.')).toBeInTheDocument();
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(false));
  });

  it('names robots.txt rather than blaming a WAF for it', async () => {
    stubApi({ get: { ...BLOCKED, state: 'blocked-by-robots', accessControlSignals: [] } });
    renderPanel('profile-1');

    expect(
      await screen.findByText(/Your robots.txt tells FluxRadarBot not to read/),
    ).toBeInTheDocument();
  });

  it('separates a site that never answered from one that refused us', async () => {
    stubApi({
      get: { ...BLOCKED, state: 'unreachable', startStatus: null, accessControlSignals: [] },
    });
    renderPanel('profile-1');

    expect(await screen.findByText(/We could not reach your site at all/)).toBeInTheDocument();
    expect(screen.queryByText(/Allow FluxRadarBot/)).not.toBeInTheDocument();
  });

  it('refuses a stale yes and says why', async () => {
    stubApi({ get: { ...REACHABLE, expired: true, canPurchase: false } });
    const onResult = renderPanel('profile-1');

    expect(await screen.findByText(/more than fifteen minutes old/)).toBeInTheDocument();
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it('offers a fresh check, and takes one on request', async () => {
    const fetchMock = stubApi({ get: BLOCKED, post: REACHABLE });
    const onResult = renderPanel('profile-1');
    await screen.findByText(/Allow FluxRadarBot/);

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));

    expect(await screen.findByText(/let our crawler read a page/)).toBeInTheDocument();
    await waitFor(() => expect(onResult).toHaveBeenLastCalledWith(true));
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST'),
    ).toBe(true);
  });

  it('does not check a site the form has not named yet', () => {
    const fetchMock = stubApi({ get: REACHABLE });
    const onResult = renderPanel(null);

    // Typing an address must not create profiles or reach third-party servers.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith(false);
    expect(screen.getByRole('button', { name: 'Check the site' })).toBeInTheDocument();
  });

  it('never reports a purchase as allowed when the check itself failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network down'))),
    );
    const onResult = renderPanel('profile-1');

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(screen.getByText('Not checked yet.')).toBeInTheDocument();
  });

  it('is translated', async () => {
    stubApi({ get: BLOCKED });
    render(
      <SiteReachabilityPanel
        language="uk"
        profileId="profile-1"
        resolveProfileId={async () => 'profile-1'}
        onResult={vi.fn()}
      />,
    );

    expect(await screen.findByText(/Дозвольте FluxRadarBot/)).toBeInTheDocument();
  });
});
