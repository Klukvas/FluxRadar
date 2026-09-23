// Choosing which Bing property a profile's reports read from.
//
// The one thing asserted here that the panel used to leave unsaid: the chosen
// property can be a different host from the profile's own domain. That is
// allowed — the server accepts any site the account's Bing grant can read, the
// same rule the Google binding follows — but a report that quietly showed
// `shop.example.com` figures under `example.com` would be describing a site the
// reader did not ask about.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SiteProfile } from './api';
import { BingProperties } from './BingProperties';
import { copy, fillCopy } from './i18n';

const t = copy.en.integrations.bing;

const PROFILE: SiteProfile = {
  id: 'profile-1',
  name: 'Shop',
  domain: 'https://example.com',
};

function envelope<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Bing answers with both sites; the binding is whatever the test saved. */
function stubApi(boundSiteUrl: string | null): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/integrations/bing/sites') {
        return Promise.resolve(
          envelope({
            connection: { state: 'connected', detail: 'Data was received.' },
            sites: {
              state: 'connected',
              detail: 'Data was received.',
              reason: null,
              items: [
                { siteUrl: 'https://example.com/', isVerified: true },
                { siteUrl: 'https://shop.example.com/', isVerified: true },
              ],
            },
          }),
        );
      }
      if (path === '/profiles/profile-1/bing-binding') {
        return Promise.resolve(
          envelope(
            boundSiteUrl === null
              ? null
              : {
                  siteProfileId: PROFILE.id,
                  siteUrl: boundSiteUrl,
                  verifiedAtSelection: true,
                  updatedAt: '2026-09-22T10:00:00.000Z',
                },
          ),
        );
      }
      return Promise.resolve(envelope(null));
    }),
  );
}

function renderPanel() {
  render(
    <BingProperties profiles={[PROFILE]} connected language="en" onAddProfile={() => undefined} />,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BingProperties', () => {
  it('says when the chosen property is a different host from the profile', async () => {
    stubApi('https://shop.example.com/');
    renderPanel();

    const notice = await screen.findByText(
      fillCopy(t.hostMismatch, { site: 'shop.example.com', domain: 'example.com' }),
    );
    expect(notice).toBeInTheDocument();
  });

  it('still offers the subdomain rather than refusing it', async () => {
    stubApi('https://shop.example.com/');
    renderPanel();

    await screen.findByText(/different host/);
    const option = await screen.findByRole('option', { name: 'https://shop.example.com/' });
    expect((option as HTMLOptionElement).selected).toBe(true);
  });

  it('says nothing when the property is the profile’s own domain', async () => {
    stubApi('https://example.com/');
    renderPanel();

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'https://example.com/' })).toBeInTheDocument();
    });
    expect(screen.queryByText(/different host/)).toBeNull();
  });
});
