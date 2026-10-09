// The prompt on the profiles screen about the owner's own Google data.
//
// Its whole job is to be contextual, so most of these are about saying nothing:
// an unreadable answer, a connection that is not offered, and a set of sites
// that is already fully configured all leave the screen alone. A panel that is
// always there is furniture, and furniture does not get read.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SiteProfile } from './api';
import { DesktopScreen } from './DesktopScreen';
import { GoogleConnectionReminder } from './GoogleConnectionReminder';
import { copy, type Language } from './i18n';

const en = copy.en.workspace;
const uk = copy.uk.workspace;

const clinic: SiteProfile = { id: 'clinic', name: 'Clinic site', domain: 'https://clinic.example' };
const studio: SiteProfile = { id: 'studio', name: 'Studio site', domain: 'https://studio.example' };

function envelope<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function failure(status: number): Response {
  return new Response(
    JSON.stringify({ success: false, data: null, error: { code: 'TEST_ERROR', message: 'no' } }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

function googleRow(status: string) {
  return {
    provider: 'google',
    label: 'Google data',
    kind: 'user',
    status,
    services: ['Google Search Console', 'Google Analytics 4'],
    canConnect: true,
    lastCheckedAt: null,
    lastError: null,
  };
}

/** Records the paths asked for, so "it never asked" is testable. */
function stubApi(handler: (path: string) => Response): string[] {
  const paths: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      return Promise.resolve(handler(path));
    }),
  );
  return paths;
}

function renderReminder(
  options: {
    readonly profiles?: readonly SiteProfile[];
    readonly language?: Language;
    readonly onOpenIntegrations?: () => void;
  } = {},
) {
  render(
    <GoogleConnectionReminder
      profiles={options.profiles ?? [clinic]}
      language={options.language ?? 'en'}
      onOpenIntegrations={options.onOpenIntegrations ?? (() => {})}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('when there is nothing outstanding, there is no panel', () => {
  it('says nothing while the connection list is still being read', () => {
    stubApi(() => envelope([googleRow('available')]));
    renderReminder();

    expect(screen.queryByText(en.googleReminderTitle)).not.toBeInTheDocument();
  });

  it.each([
    ['the list holds no Google connection', () => envelope([])],
    ['the answer is not a list at all', () => envelope(null)],
    ['the answer is an object', () => envelope({ provider: 'google' })],
    ['the request fails', () => failure(500)],
    ['the provider is not configured on the server', () => envelope([googleRow('not_configured')])],
  ])('says nothing when %s', async (_label, handler) => {
    stubApi(handler);
    renderReminder();

    // Settled, not merely not-yet-rendered: the reads have answered by now.
    await waitFor(() => expect(screen.queryByText(en.googleReminderTitle)).not.toBeInTheDocument());
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says nothing once every site reads a property', async () => {
    stubApi((path) =>
      path === '/integrations'
        ? envelope([googleRow('connected')])
        : envelope([
            { siteProfileId: 'clinic', searchConsoleSiteUrl: 'sc-domain:clinic.example' },
            { siteProfileId: 'studio', ga4PropertyId: '42' },
          ]),
    );
    renderReminder({ profiles: [clinic, studio] });

    await waitFor(() => expect(screen.queryByText(en.googleReminderTitle)).not.toBeInTheDocument());
  });

  it('says nothing when the bindings cannot be read', async () => {
    stubApi((path) =>
      path === '/integrations' ? envelope([googleRow('connected')]) : envelope('nonsense'),
    );
    renderReminder();

    await waitFor(() => expect(screen.queryByText(en.googleReminderTitle)).not.toBeInTheDocument());
  });
});

describe('the step that is actually outstanding', () => {
  it('asks for the connection when there is none', async () => {
    const paths = stubApi(() => envelope([googleRow('available')]));
    renderReminder();

    expect(await screen.findByText(en.googleReminderConnect)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: en.googleReminderConnectAction }),
    ).toBeInTheDocument();
    // Nothing to bind yet, so the bindings are not asked for.
    expect(paths).not.toContain('/integrations/google/bindings');
  });

  it('asks for a reconnection when the connection has broken', async () => {
    stubApi(() => envelope([googleRow('needs_reconnect')]));
    renderReminder();

    expect(await screen.findByText(en.googleReminderReconnect)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: en.googleReminderReconnectAction }),
    ).toBeInTheDocument();
  });

  it('names the sites that read no property yet, and only those', async () => {
    stubApi((path) =>
      path === '/integrations'
        ? envelope([googleRow('connected')])
        : envelope([{ siteProfileId: 'clinic', searchConsoleSiteUrl: 'sc-domain:clinic.example' }]),
    );
    renderReminder({ profiles: [clinic, studio] });

    expect(await screen.findByText(/No property yet: Studio site\./)).toBeInTheDocument();
    expect(screen.queryByText(/Clinic site/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.googleReminderChoose })).toBeInTheDocument();
  });

  // A row with a profile id and no property at all is a saved selection of
  // nothing: the site still reads no data, so it is still waiting.
  it('counts a binding that selected nothing as no property', async () => {
    stubApi((path) =>
      path === '/integrations'
        ? envelope([googleRow('connected')])
        : envelope([{ siteProfileId: 'clinic', searchConsoleSiteUrl: null, ga4PropertyId: null }]),
    );
    renderReminder();

    expect(await screen.findByText(/No property yet: Clinic site\./)).toBeInTheDocument();
  });

  it('lists every waiting site in the reader’s own language', async () => {
    stubApi((path) =>
      path === '/integrations' ? envelope([googleRow('connected')]) : envelope([]),
    );
    renderReminder({ profiles: [clinic, studio], language: 'uk' });

    // The conjunction is `Intl.ListFormat`'s, in the locale being read.
    expect(
      await screen.findByText(/Ще без property: Clinic site і Studio site\./),
    ).toBeInTheDocument();
    expect(screen.getByText(uk.googleReminderTitle)).toBeInTheDocument();
    expect(screen.queryByText(en.googleReminderChooseProperty)).not.toBeInTheDocument();
  });

  it('sends the owner to the screen that holds the connection', async () => {
    const onOpenIntegrations = vi.fn();
    stubApi(() => envelope([googleRow('available')]));
    renderReminder({ onOpenIntegrations });

    (await screen.findByRole('button', { name: en.googleReminderConnectAction })).click();

    expect(onOpenIntegrations).toHaveBeenCalledTimes(1);
  });
});

// Where it lives: under the sites it is about, and only once there are some.
describe('on the profiles screen', () => {
  function renderDesktop(profiles: readonly SiteProfile[]) {
    render(
      <DesktopScreen
        profiles={profiles}
        accountId="account-1"
        onRefresh={() => Promise.resolve()}
        onProfileDeleted={() => {}}
        onSelectProfile={() => {}}
        onNewScan={() => {}}
        onOpenScan={() => {}}
        onRetryScan={() => Promise.resolve()}
        onError={() => {}}
        onNotice={() => {}}
        onOnboarding={() => {}}
        onOpenIntegrations={() => {}}
        language="en"
      />,
    );
  }

  it('reminds the owner under the list of sites it is about', async () => {
    stubApi((path) =>
      path === '/integrations' ? envelope([googleRow('available')]) : envelope(null),
    );
    renderDesktop([clinic]);

    const reminder = await screen.findByText(en.googleReminderConnect);
    // Under the sites panel, above the form that adds another one.
    const panels = Array.from(document.querySelectorAll('.panel'));
    const list = panels.find((panel) => panel.textContent?.includes(en.registered));
    if (list === undefined) throw new Error('expected the registered-sites panel to render');
    expect(list.compareDocumentPosition(reminder) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('asks nothing of an account with no sites yet', async () => {
    const paths = stubApi((path) =>
      path === '/integrations' ? envelope([googleRow('available')]) : envelope(null),
    );
    renderDesktop([]);

    await waitFor(() => expect(screen.getByText(en.noSites)).toBeInTheDocument());
    expect(screen.queryByText(en.googleReminderConnect)).not.toBeInTheDocument();
    // Nothing to remind anyone about, so nothing is asked of the API either.
    expect(paths).not.toContain('/integrations');
  });
});
