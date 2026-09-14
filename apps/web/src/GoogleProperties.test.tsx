import { useCallback, useEffect, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiRequest, type SiteProfile } from './api';
import { IntegrationsScreen } from './Integrations';
import { copy, fillCopy, type Language } from './i18n';

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

/** A promise lets a test hold a reply back and release it after the screen has moved on. */
type Handler = (call: Call) => Response | Promise<Response>;

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

/**
 * Every panel load also reads the account's bindings for the domain overview,
 * and fails without them. A scenario states its bindings here instead of
 * answering that path in its own handler.
 */
function stubApi(handler: Handler, bindings: readonly unknown[] | 'unavailable' = []): Call[] {
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
      if (call.path === '/integrations/google/bindings' && call.method === 'GET') {
        return Promise.resolve(
          bindings === 'unavailable'
            ? failure(503, 'SERVICE_UNAVAILABLE', 'Bindings are unavailable.')
            : envelope(bindings),
        );
      }
      return Promise.resolve(handler(call));
    }),
  );
  return calls;
}

/** The select a field label belongs to. */
function selectFor(label: string): HTMLSelectElement {
  const field = screen.getByText(label, { selector: '.field__label' }).closest('label');
  return (field as HTMLElement).querySelector('select') as HTMLSelectElement;
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

// ─── Two profiles, three Search Console domains ──────────────────────────────
//
// Shared by the domain overview tests below. shop.example.com is listed first,
// so it is the profile selected when the panel opens and the free profile at
// sc-domain:example.com; flux-lab.dev already reads its own domain; blog.test is
// what a Create makes.
// ─────────────────────────────────────────────────────────────────────────────

const shop = { id: 'profile-shop', name: 'shop.example.com', domain: 'https://shop.example.com' };
const flux = { id: 'profile-flux', name: 'flux-lab.dev', domain: 'https://flux-lab.dev' };
const blog = { id: 'profile-blog', name: 'blog.test', domain: 'https://blog.test' };
const fluxBinding = {
  siteProfileId: flux.id,
  searchConsoleSiteUrl: 'sc-domain:flux-lab.dev',
  ga4PropertyId: null,
  ga4PropertyName: null,
  updatedAt: '2026-09-14T00:00:00.000Z',
};

const domainsHandler: Handler = ({ path, method, body }) => {
  if (path === '/integrations') return envelope([googleRow, bingRow]);
  if (path === '/profiles' && method === 'POST') return envelope(blog);
  if (path === '/profiles') return envelope([shop, flux]);
  if (path === '/integrations/google/properties')
    return envelope(
      discovery(['sc-domain:flux-lab.dev', 'sc-domain:example.com', 'https://blog.test/']),
    );
  const match = /^\/profiles\/([^/]+)\/google-binding$/.exec(path);
  if (match !== null && method === 'PUT') {
    return envelope({
      siteProfileId: match[1],
      ...body,
      ga4PropertyName: null,
      updatedAt: '2026-09-14T00:01:00.000Z',
    });
  }
  if (match !== null) return envelope(match[1] === flux.id ? fluxBinding : null);
  return envelope(null);
};

function domainRow(siteUrl: string): HTMLElement {
  return screen
    .getByText(siteUrl, { selector: '.technical' })
    .closest('.google-properties__row') as HTMLElement;
}

describe('linking several Google domains to several profiles', () => {
  // One Google account can read several domains, and an account can hold several
  // profiles. The panel configured only the selected profile, and a domain could
  // become a profile only while the account had none — so the second domain
  // could never be turned into a linked profile from here.
  const linkMessage = fillCopy(en.domainLinkedMessage, {
    property: 'sc-domain:example.com',
    name: shop.name,
  });

  it('shows which profile each domain feeds, with the action each row needs', async () => {
    stubApi(domainsHandler, [fluxBinding]);
    render(<Harness />);

    expect(await screen.findByRole('heading', { name: en.domainsHeading })).toBeInTheDocument();
    expect(domainRow('sc-domain:flux-lab.dev')).toHaveTextContent(
      fillCopy(en.domainLinked, { profiles: flux.name }),
    );
    expect(domainRow('sc-domain:example.com')).toHaveTextContent(
      fillCopy(en.domainMatching, { profile: shop.name }),
    );
    expect(
      within(domainRow('https://blog.test/')).getByRole('button', {
        name: `${en.create} · https://blog.test/`,
      }),
    ).toBeInTheDocument();
  });

  it('links a domain to the free profile at its address and updates the row', async () => {
    const calls = stubApi(domainsHandler, [fluxBinding]);
    render(<Harness />);

    fireEvent.click(
      await screen.findByRole('button', { name: `${en.domainLink} · sc-domain:example.com` }),
    );

    expect(await screen.findByText(linkMessage)).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'PUT')).toMatchObject({
      path: `/profiles/${shop.id}/google-binding`,
      body: { searchConsoleSiteUrl: 'sc-domain:example.com', ga4PropertyId: null },
    });
    expect(domainRow('sc-domain:example.com')).toHaveTextContent(
      fillCopy(en.domainLinked, { profiles: shop.name }),
    );
  });

  it('opens a linked domain’s profile in the pickers', async () => {
    stubApi(domainsHandler, [fluxBinding]);
    render(<Harness />);

    fireEvent.click(
      await screen.findByRole('button', { name: `${en.domainConfigure} · sc-domain:flux-lab.dev` }),
    );

    await waitFor(() => expect(selectFor(en.profileLabel).value).toBe(flux.id));
  });

  // With profiles already saved, the new profile was selected before the profile
  // list reloaded; the panel then took it for a deleted profile, jumped back to
  // the first one and wiped the message about the create.
  it('keeps a profile created from a domain selected when other profiles exist', async () => {
    let isCreated = false;
    const calls = stubApi(
      (call) => {
        if (call.path === '/profiles' && call.method === 'POST') {
          isCreated = true;
          return envelope(blog);
        }
        if (call.path === '/profiles')
          return envelope(isCreated ? [shop, flux, blog] : [shop, flux]);
        return domainsHandler(call);
      },
      [fluxBinding],
    );
    render(<Harness />);

    fireEvent.click(
      await screen.findByRole('button', { name: `${en.create} · https://blog.test/` }),
    );

    const created = fillCopy(en.createdLinked, { name: blog.name, property: 'https://blog.test/' });
    expect(await screen.findByText(created)).toBeInTheDocument();
    await waitFor(() => expect(selectFor(en.profileLabel).value).toBe(blog.id));
    expect(screen.getByText(created)).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      name: 'blog.test',
      domain: 'https://blog.test',
    });
  });
});

describe('the Google properties panel while it is busy or partly unreadable', () => {
  // A reload or a second action that started before a link could finish after
  // it and put the old binding back into the selectors — one Save away from
  // undoing the link.
  it('locks the profile choice, Save, Refresh and every domain action while a link runs', async () => {
    stubApi(
      (call) =>
        call.method === 'PUT' ? new Promise<Response>(() => undefined) : domainsHandler(call),
      [fluxBinding],
    );
    render(<Harness />);

    fireEvent.click(
      await screen.findByRole('button', { name: `${en.domainLink} · sc-domain:example.com` }),
    );

    expect(selectFor(en.profileLabel)).toBeDisabled();
    expect(screen.getByRole('button', { name: en.save })).toBeDisabled();
    expect(screen.getByRole('button', { name: en.refresh })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: `${en.domainConfigure} · sc-domain:flux-lab.dev` }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: `${en.create} · https://blog.test/` }),
    ).toBeDisabled();
  });

  // A failed reload left the selection on the new profile, which the picker did
  // not list, so the next Save went to a profile the owner could not see.
  it('returns to a listed profile and says the new one exists when the list cannot reload', async () => {
    let isCreated = false;
    stubApi(
      (call) => {
        if (call.path === '/profiles' && call.method === 'POST') isCreated = true;
        if (call.path === '/profiles' && call.method === 'GET' && isCreated) {
          return failure(503, 'SERVICE_UNAVAILABLE', 'Profiles are unavailable.');
        }
        return domainsHandler(call);
      },
      [fluxBinding],
    );
    render(<Harness />);

    fireEvent.click(
      await screen.findByRole('button', { name: `${en.create} · https://blog.test/` }),
    );

    expect(
      await screen.findByText(fillCopy(en.createdListFailed, { name: blog.name })),
    ).toBeInTheDocument();
    await waitFor(() => expect(selectFor(en.profileLabel).value).toBe(shop.id));
  });

  it('keeps the selectors working and says so when the linked domains cannot be read', async () => {
    stubApi(domainsHandler, 'unavailable');
    render(<Harness />);

    expect(await screen.findByText(en.domainsUnavailable)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: en.domainsHeading })).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: en.save })).toBeEnabled());
  });

  // After a failed load the selectors read "Not linked" for want of an answer;
  // saving them would have unlinked what the profile really reads.
  it('does not offer Save for a profile whose binding could not be loaded', async () => {
    stubApi(
      (call) =>
        call.path === '/integrations/google/properties'
          ? failure(503, 'GOOGLE_UNAVAILABLE', 'Google could not be reached.')
          : domainsHandler(call),
      [fluxBinding],
    );
    render(<Harness />);

    expect(await screen.findByText(en.loadFailed)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.save })).toBeDisabled();
  });
});

describe('why a Google property list is empty', () => {
  const savedProfile = { id: 'profile-1', name: 'flux-lab.dev', domain: 'https://flux-lab.dev' };

  function withAnalytics(analytics: Record<string, unknown>): Handler {
    return ({ path }) => {
      if (path === '/integrations') return envelope([googleRow, bingRow]);
      if (path === '/profiles') return envelope([savedProfile]);
      if (path === '/integrations/google/properties')
        return envelope({ ...discovery(['sc-domain:flux-lab.dev']), analytics });
      return envelope(null);
    };
  }

  /** The select a field label belongs to, and the message it is described by. */
  function fieldParts(label: string): { select: HTMLSelectElement; described: string | null } {
    const select = selectFor(label);
    const describedBy = select.getAttribute('aria-describedby');
    return {
      select,
      described:
        describedBy === null ? null : (document.getElementById(describedBy)?.textContent ?? null),
    };
  }

  // Google refused to list the Analytics properties. The screen showed the
  // server's English "cannot read the selected property" with nothing selected,
  // inside a Ukrainian page, just under the Search Console field — as if it were
  // that field's error.
  it('explains a refused listing in the reader’s language, under the Analytics field', async () => {
    stubApi(
      withAnalytics({
        state: 'no_access',
        reason: null,
        detail: 'Google refused to list the properties this account can read.',
        items: [],
      }),
    );
    render(<Harness language="uk" />);

    const expected = fillCopy(uk.discoveryDenied, { service: uk.serviceAnalytics });
    await screen.findByText(expected);

    expect(fieldParts(uk.analyticsLabel).described).toBe(expected);
    expect(fieldParts(uk.searchConsoleLabel).described).toBeNull();
    expect(screen.queryByText(/Google refused|selected property|^Analytics:/)).toBeNull();
  });

  it('asks for a reconnect when the grant never included Analytics', async () => {
    stubApi(
      withAnalytics({
        state: 'no_access',
        reason: 'missing_scope',
        detail: 'The Google authorization does not include this service.',
        items: [],
      }),
    );
    render(<Harness />);

    const expected = fillCopy(en.discoveryMissingScope, { service: en.serviceAnalytics });
    await screen.findByText(expected);
    expect(fieldParts(en.analyticsLabel).described).toBe(expected);
  });
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
