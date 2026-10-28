// The property panels while their discovery answers: the selectors stay mounted
// and disabled instead of being replaced by a loading line, so the lists that
// land do not push the panel's layout around.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SiteProfile } from './api';
import { BingProperties } from './BingProperties';
import { copy } from './i18n';
import { GoogleProperties } from './GoogleProperties';

const PROFILE: SiteProfile = {
  id: 'profile-1',
  name: 'Site',
  domain: 'https://example.com',
} as SiteProfile;

function envelope<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** A response the test answers when it chooses to. */
function held(): { promise: Promise<Response>; answer: (data: unknown) => void } {
  let answer: (data: unknown) => void = () => undefined;
  const promise = new Promise<Response>((resolve) => {
    answer = (data) => resolve(envelope(data));
  });
  return { promise, answer };
}

/** The select a field label belongs to. */
function selectFor(label: string): HTMLSelectElement {
  const field = screen.getByText(label, { selector: '.field__label' }).closest('label');
  return (field as HTMLElement).querySelector('select') as HTMLSelectElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('GoogleProperties while the discovery is answering', () => {
  it('keeps the property selectors mounted and disabled instead of a loading line', async () => {
    const t = copy.en.integrations.google;
    const discovery = held();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const { pathname } = new URL(String(input));
        if (pathname === '/integrations/google/properties') return discovery.promise;
        if (pathname === '/integrations/google/bindings') return Promise.resolve(envelope([]));
        return Promise.resolve(envelope(null));
      }),
    );
    render(
      <GoogleProperties
        profiles={[PROFILE]}
        connected
        language="en"
        onAddProfile={() => undefined}
        onProfilesChanged={() => Promise.resolve()}
      />,
    );
    expect(selectFor(t.searchConsoleLabel)).toBeDisabled();
    expect(selectFor(t.analyticsLabel)).toBeDisabled();
    // A save started while the discovery is still answering would race the
    // stale response that lands afterwards; the button must refuse it.
    expect(screen.getByRole('button', { name: t.save })).toBeDisabled();
    expect(screen.queryByText(t.loading)).toBeNull();
    discovery.answer({
      connection: { state: 'connected', detail: 'Data was received.' },
      searchConsole: {
        state: 'connected',
        detail: 'Data was received.',
        items: [{ siteUrl: 'https://example.com', permissionLevel: 'siteOwner' }],
      },
      analytics: { state: 'no_data', detail: 'Data was received.', items: [] },
    });
    await waitFor(() => expect(selectFor(t.searchConsoleLabel)).toBeEnabled());
    expect(screen.queryByText(t.loading)).toBeNull();
  });
});

describe('BingProperties while the discovery is answering', () => {
  it('keeps the site selector mounted and disabled instead of a loading line', async () => {
    const t = copy.en.integrations.bing;
    const sites = held();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const { pathname } = new URL(String(input));
        if (pathname === '/integrations/bing/sites') return sites.promise;
        return Promise.resolve(envelope(null));
      }),
    );
    render(
      <BingProperties
        profiles={[PROFILE]}
        connected
        language="en"
        onAddProfile={() => undefined}
      />,
    );
    expect(selectFor(t.siteLabel)).toBeDisabled();
    // Same race guard as Google: no save while the sites answer is in flight.
    expect(screen.getByRole('button', { name: t.save })).toBeDisabled();
    expect(screen.queryByText(t.loading)).toBeNull();
    sites.answer({
      connection: { state: 'connected', detail: 'Data was received.' },
      sites: {
        state: 'connected',
        detail: 'Data was received.',
        items: [{ siteUrl: 'https://example.com', isVerified: true }],
      },
    });
    await waitFor(() => expect(selectFor(t.siteLabel)).toBeEnabled());
    expect(screen.queryByText(t.loading)).toBeNull();
  });
});
