import { useCallback, useEffect, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiRequest, type SiteProfile } from './api';
import { IntegrationsScreen } from './Integrations';
import { copy, type Language } from './i18n';

// ─── Google properties, inside the Google connection ─────────────────────────
//
// Three things are checked here that the screen used to get wrong: the property
// picker sat after Bing as if it configured every integration; it called a saved
// profile a "Website" while the rest of the workspace called it a Profile; and
// an account that had connected Google but saved nothing yet was offered a
// picker with nothing in it. The create-from-Search-Console path is checked
// against what it actually sends, because a profile is a real record and its
// address must come from the property rather than from a guess.
// ─────────────────────────────────────────────────────────────────────────────

const en = copy.en.integrations.google;
const uk = copy.uk.integrations.google;

const googleRow = {
  provider: 'google',
  label: 'Google data',
  kind: 'user' as const,
  status: 'connected' as const,
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

const ga4Property = { propertyId: '4417', displayName: 'Main stream', accountName: 'Acme' };

function discovery(siteUrls: readonly string[]) {
  return {
    connection: { state: 'connected', detail: 'Data was received.' },
    searchConsole:
      siteUrls.length === 0
        ? {
            state: 'no_data',
            detail: 'This Google account has no verified Search Console properties.',
            items: [],
          }
        : {
            state: 'connected',
            detail: 'Data was received.',
            items: siteUrls.map((siteUrl) => ({ siteUrl, permissionLevel: 'siteOwner' })),
          },
    analytics: { state: 'connected', detail: 'Data was received.', items: [ga4Property] },
  };
}

interface Call {
  readonly path: string;
  readonly method: string;
  readonly body: Record<string, unknown> | null;
}

type Handler = (call: Call) => Response;

function envelope<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function failure(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ success: false, data: null, error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubApi(handler: Handler): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
      const call: Call = {
        path: new URL(String(input)).pathname,
        method: (init.method ?? 'GET').toUpperCase(),
        body:
          typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      };
      calls.push(call);
      return Promise.resolve(handler(call));
    }),
  );
  return calls;
}

/**
 * The integrations screen wired the way the app wires it: the profile list lives
 * above the screen and is re-read after this panel creates one, so "the new
 * profile is selected" is asserted against the same round trip the app makes.
 */
function Harness(props: { language?: Language; onAddProfile?: () => void }) {
  const [profiles, setProfiles] = useState<readonly SiteProfile[]>([]);
  const reload = useCallback(async () => {
    setProfiles(await apiRequest<SiteProfile[]>('/profiles'));
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return (
    <IntegrationsScreen
      profiles={profiles}
      language={props.language ?? 'en'}
      onClose={() => undefined}
      onAddProfile={props.onAddProfile ?? (() => undefined)}
      onProfilesChanged={reload}
      onError={() => undefined}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Google properties sit inside the Google connection', () => {
  const savedProfile = { id: 'profile-1', name: 'example.com', domain: 'https://example.com' };

  const connectedWithProfile: Handler = ({ path }) => {
    if (path === '/integrations') return envelope([googleRow, bingRow]);
    if (path === '/profiles') return envelope([savedProfile]);
    if (path === '/integrations/google/properties')
      return envelope(discovery(['https://example.com/']));
    if (path === `/profiles/${savedProfile.id}/google-binding`) return envelope(null);
    return envelope(null);
  };

  it('renders the property panel above Bing, not as a panel of its own after it', async () => {
    stubApi(connectedWithProfile);
    render(<Harness />);

    const panel = await screen.findByText(en.title);
    // The row's name and its single service read the same; the first match is
    // the row heading, which is what the ordering is about.
    const [bing] = screen.getAllByText('Bing Webmaster Tools');
    if (bing === undefined) throw new Error('expected the Bing row to render');

    // Same connection: the panel lives inside the Google row's group.
    const googleGroup = screen.getByText('Google data').closest('.integration-group');
    expect(googleGroup).toContainElement(panel);
    expect(googleGroup).not.toContainElement(bing);
    // And it is rendered before Bing, so reading the screen top to bottom keeps
    // the Google settings with the Google connection.
    expect(panel.compareDocumentPosition(bing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Exactly one such panel: the old standalone copy after the list is gone.
    expect(screen.getAllByText(en.title)).toHaveLength(1);
  });

  it('says the connection is read-only and that the two services are separate sources', async () => {
    stubApi(connectedWithProfile);
    render(<Harness />);

    const note = await screen.findByText(en.readOnly);
    expect(note).toHaveTextContent(/only reads/i);
    expect(note).toHaveTextContent(/never writes/i);
    expect(note).toHaveTextContent(/separate data sources/i);
  });

  it('calls the saved record a Profile, in both languages, and never a Website', async () => {
    stubApi(connectedWithProfile);
    const { unmount } = render(<Harness />);

    expect(await screen.findByRole('combobox', { name: en.profileLabel })).toBeInTheDocument();
    expect(en.profileLabel).toBe('Profile');
    expect(screen.queryByRole('combobox', { name: 'Website' })).not.toBeInTheDocument();
    unmount();

    render(<Harness language="uk" />);
    expect(await screen.findByRole('combobox', { name: uk.profileLabel })).toBeInTheDocument();
    expect(uk.profileLabel).toBe('Профіль');
  });

  it('loads the existing binding and saves a changed selection for the chosen profile', async () => {
    const calls = stubApi(({ path, method }) => {
      if (path === `/profiles/${savedProfile.id}/google-binding` && method === 'PUT') {
        return envelope({
          siteProfileId: savedProfile.id,
          searchConsoleSiteUrl: 'https://example.com/',
          ga4PropertyId: ga4Property.propertyId,
          ga4PropertyName: ga4Property.displayName,
          updatedAt: '2026-09-07T00:00:00.000Z',
        });
      }
      if (path === `/profiles/${savedProfile.id}/google-binding`) {
        return envelope({
          siteProfileId: savedProfile.id,
          searchConsoleSiteUrl: 'https://example.com/',
          ga4PropertyId: null,
          ga4PropertyName: null,
          updatedAt: '2026-09-06T00:00:00.000Z',
        });
      }
      return connectedWithProfile({ path, method, body: null });
    });
    render(<Harness />);

    const searchConsole = await screen.findByRole('combobox', { name: en.searchConsoleLabel });
    await waitFor(() => expect(searchConsole).toHaveValue('https://example.com/'));

    fireEvent.change(screen.getByRole('combobox', { name: en.analyticsLabel }), {
      target: { value: ga4Property.propertyId },
    });
    fireEvent.click(screen.getByRole('button', { name: en.save }));

    expect(await screen.findByText(en.savedLinked)).toBeInTheDocument();
    const put = calls.find((call) => call.method === 'PUT');
    expect(put?.body).toEqual({
      searchConsoleSiteUrl: 'https://example.com/',
      ga4PropertyId: ga4Property.propertyId,
    });
  });
});

describe('Google connected, no profile saved yet', () => {
  const noProfiles =
    (siteUrls: readonly string[]): Handler =>
    ({ path }) => {
      if (path === '/integrations') return envelope([googleRow, bingRow]);
      if (path === '/profiles') return envelope([]);
      if (path === '/integrations/google/properties') return envelope(discovery(siteUrls));
      return envelope(null);
    };

  it('offers Add profile instead of an empty picker', async () => {
    const onAddProfile = vi.fn();
    stubApi(noProfiles([]));
    render(<Harness onAddProfile={onAddProfile} />);

    expect(await screen.findByText(en.emptyTitle)).toBeInTheDocument();
    expect(screen.getByText(en.emptyBody)).toBeInTheDocument();
    // The picker that had nothing to pick is not rendered at all.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: en.emptyAction }));
    expect(onAddProfile).toHaveBeenCalledTimes(1);
  });

  it('explains that an Analytics property alone cannot create a profile', async () => {
    stubApi(noProfiles([]));
    render(<Harness />);

    expect(await screen.findByText(en.analyticsOnlyNote)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(en.create) })).not.toBeInTheDocument();
  });

  it('does not claim there is nothing to start from when discovery itself failed', async () => {
    stubApi(({ path }) => {
      if (path === '/integrations') return envelope([googleRow, bingRow]);
      if (path === '/profiles') return envelope([]);
      if (path === '/integrations/google/properties')
        return failure(503, 'GOOGLE_UNAVAILABLE', 'Google could not be reached.');
      return envelope(null);
    });
    render(<Harness />);

    expect(await screen.findByText(en.loadFailed)).toBeInTheDocument();
    // "We could not ask Google" and "Google has nothing for you" are different
    // facts, and only the first one is known here.
    expect(screen.queryByText(en.noProperties)).not.toBeInTheDocument();
    expect(screen.queryByText(en.createHeading)).not.toBeInTheDocument();
    // The manual way out stays offered.
    expect(screen.getByRole('button', { name: en.emptyAction })).toBeInTheDocument();
  });

  it('lists every readable Search Console property as something to start from', async () => {
    stubApi(noProfiles(['sc-domain:example.com', 'https://shop.example.com/']));
    render(<Harness />);

    expect(await screen.findByText(en.createHeading)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `${en.create} · sc-domain:example.com` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `${en.create} · https://shop.example.com/` }),
    ).toBeInTheDocument();
  });

  it('renders the same empty state in Ukrainian', async () => {
    stubApi(noProfiles(['sc-domain:example.com']));
    render(<Harness language="uk" />);

    // The create section appears once discovery answers, which is after the
    // empty state itself — so it is awaited rather than read in the same tick.
    expect(await screen.findByText(uk.createHeading)).toBeInTheDocument();
    expect(screen.getByText(uk.emptyTitle)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: uk.emptyAction })).toBeInTheDocument();
    expect(screen.queryByText(en.emptyTitle)).not.toBeInTheDocument();
  });
});

describe('creating a profile from a Search Console property', () => {
  const created = { id: 'profile-new', name: 'example.com', domain: 'https://example.com' };

  function stubCreate(
    siteUrls: readonly string[],
    overrides: Partial<Record<string, Response>> = {},
  ) {
    let profiles: SiteProfile[] = [];
    return stubApi(({ path, method }) => {
      if (path === '/integrations') return envelope([googleRow, bingRow]);
      if (path === '/profiles' && method === 'POST') {
        const response = overrides.create;
        if (response !== undefined) return response.clone();
        profiles = [created];
        return envelope(created, 201);
      }
      if (path === '/profiles') return envelope(profiles);
      if (path === '/integrations/google/properties') return envelope(discovery(siteUrls));
      if (path === `/profiles/${created.id}/google-binding` && method === 'PUT') {
        const response = overrides.bind;
        if (response !== undefined) return response.clone();
        return envelope({
          siteProfileId: created.id,
          searchConsoleSiteUrl: siteUrls[0] ?? null,
          ga4PropertyId: null,
          ga4PropertyName: null,
          updatedAt: '2026-09-07T00:00:00.000Z',
        });
      }
      return envelope(null);
    });
  }

  it('turns a domain property into its https origin and links it', async () => {
    const calls = stubCreate(['sc-domain:example.com']);
    render(<Harness />);

    fireEvent.click(
      await screen.findByRole('button', { name: `${en.create} · sc-domain:example.com` }),
    );

    expect(
      await screen.findByText(
        `Profile ${created.name} was created and linked to sc-domain:example.com.`,
      ),
    ).toBeInTheDocument();
    const post = calls.find((call) => call.path === '/profiles' && call.method === 'POST');
    expect(post?.body).toEqual({ name: 'example.com', domain: 'https://example.com' });
    const bind = calls.find((call) => call.method === 'PUT');
    expect(bind?.path).toBe(`/profiles/${created.id}/google-binding`);
    expect(bind?.body).toEqual({
      searchConsoleSiteUrl: 'sc-domain:example.com',
      ga4PropertyId: null,
    });
  });

  it('keeps only the origin of a url-prefix property and selects the new profile', async () => {
    const prefixProfile = {
      id: 'profile-new',
      name: 'shop.example.com',
      domain: 'https://shop.example.com',
    };
    const calls = stubApi(({ path, method }) => {
      if (path === '/integrations') return envelope([googleRow, bingRow]);
      if (path === '/profiles' && method === 'POST') return envelope(prefixProfile, 201);
      if (path === '/profiles')
        return envelope(
          calls.some((call) => call.path === '/profiles' && call.method === 'POST')
            ? [prefixProfile]
            : [],
        );
      if (path === '/integrations/google/properties')
        return envelope(discovery(['https://shop.example.com/catalog/']));
      if (path === `/profiles/${prefixProfile.id}/google-binding` && method === 'PUT')
        return envelope({
          siteProfileId: prefixProfile.id,
          searchConsoleSiteUrl: 'https://shop.example.com/catalog/',
          ga4PropertyId: null,
          ga4PropertyName: null,
          updatedAt: '2026-09-07T00:00:00.000Z',
        });
      if (path === `/profiles/${prefixProfile.id}/google-binding`)
        return envelope({
          siteProfileId: prefixProfile.id,
          searchConsoleSiteUrl: 'https://shop.example.com/catalog/',
          ga4PropertyId: null,
          ga4PropertyName: null,
          updatedAt: '2026-09-07T00:00:00.000Z',
        });
      return envelope(null);
    });
    render(<Harness />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: `${en.create} · https://shop.example.com/catalog/`,
      }),
    );

    const post = await waitFor(() => {
      const call = calls.find((entry) => entry.path === '/profiles' && entry.method === 'POST');
      if (call === undefined) throw new Error('profile was not created');
      return call;
    });
    expect(post.body).toEqual({ name: 'shop.example.com', domain: 'https://shop.example.com' });

    // The panel switches to the picker with the new profile already chosen.
    const picker = await screen.findByRole('combobox', { name: en.profileLabel });
    await waitFor(() => expect(picker).toHaveValue(prefixProfile.id));
  });

  it('refuses an http property instead of inventing an https address for it', async () => {
    const calls = stubCreate(['http://legacy.example.com/']);
    render(<Harness />);

    fireEvent.click(
      await screen.findByRole('button', { name: `${en.create} · http://legacy.example.com/` }),
    );

    expect(await screen.findByText(en.createInsecure)).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('refuses a property that is not a public site at all', async () => {
    const calls = stubCreate(['android-app://com.example.app']);
    render(<Harness />);

    fireEvent.click(
      await screen.findByRole('button', { name: `${en.create} · android-app://com.example.app` }),
    );

    expect(await screen.findByText(en.createUnsupported)).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('explains a duplicate profile in its own words, not the server sentence', async () => {
    stubCreate(['sc-domain:example.com'], {
      create: failure(409, 'DOMAIN_EXISTS', 'a profile for this domain already exists'),
    });
    render(<Harness />);

    fireEvent.click(
      await screen.findByRole('button', { name: `${en.create} · sc-domain:example.com` }),
    );

    expect(await screen.findByText(en.createDuplicate)).toBeInTheDocument();
    expect(screen.queryByText(/a profile for this domain already exists/i)).not.toBeInTheDocument();
  });

  it('says the profile exists but the link did not, rather than hiding the half that worked', async () => {
    stubCreate(['sc-domain:example.com'], {
      bind: failure(503, 'GOOGLE_UNAVAILABLE', 'Google could not be reached.'),
    });
    render(<Harness />);

    fireEvent.click(
      await screen.findByRole('button', { name: `${en.create} · sc-domain:example.com` }),
    );

    expect(
      await screen.findByText(
        `Profile ${created.name} was created, but the Search Console property could not be linked to it. Choose the property in the list below.`,
      ),
    ).toBeInTheDocument();
  });
});
