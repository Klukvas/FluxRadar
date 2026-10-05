// The ownership panel starts folded to one plain line and a reason it is safe to
// skip, because DNS records and meta tags read as a demand to a non-technical
// owner. Unfolded, it is the same panel as before.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DomainVerification, SiteProfile } from './api';
import { DomainOwnershipPanel } from './DomainOwnership';
import { domainOwnershipCopy } from './domain-ownership-copy';
import { copy, type Language } from './i18n';

const PROFILE: SiteProfile = { id: 'profile-1', name: 'Example', domain: 'https://example.com' };

const PENDING: DomainVerification = {
  method: 'dns-txt',
  status: 'pending',
  domain: 'example.com',
  token: 'token-1',
  record: 'fluxradar-verification=token-1',
  instruction: 'Add a TXT record to the domain.',
  issuedAt: '2026-10-01T10:00:00.000Z',
  tokenExpiresAt: '2026-10-08T10:00:00.000Z',
  tokenExpired: false,
  verifiedAt: null,
  lastCheckedAt: null,
  lastFailureReason: null,
  attempts: 0,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubVerification(record: DomainVerification | null) {
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ success: true, data: record, error: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function renderPanel(language: Language, record: DomainVerification | null) {
  const fetchMock = stubVerification(record);
  render(<DomainOwnershipPanel language={language} profile={PROFILE} onError={() => undefined} />);
  // The status read finishes when the technical fields replace the skeleton.
  await screen.findAllByText(copy[language].domainOwnership.optionalNote);
  const summary = screen.getByText(domainOwnershipCopy[language].summary).closest('summary');
  if (summary === null) throw new Error('expected the fold summary');
  const details = summary.closest('details');
  if (details === null) throw new Error('expected the fold');
  return { summary, details, fetchMock };
}

describe('domain ownership fold', () => {
  it.each(['en', 'uk'] as const)(
    'starts folded under one line and a reason in %s when nothing was started',
    async (language) => {
      const { summary, details, fetchMock } = await renderPanel(language, null);
      expect(details.open).toBe(false);
      // Folding changes nothing about the status read on mount: one request.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(summary).toHaveTextContent(domainOwnershipCopy[language].summary);
      expect(summary).toHaveTextContent(domainOwnershipCopy[language].why);
      // The technical title lives inside the fold, not on the line the owner sees.
      expect(summary).not.toHaveTextContent(copy[language].domainOwnership.title);
    },
  );

  it('unfolds to the same panel as before: title, note and method picker', async () => {
    const { summary, details } = await renderPanel('en', null);
    fireEvent.click(summary);
    // Browsers flip `open` themselves; set it where the test DOM does not.
    if (!details.open) {
      details.open = true;
      fireEvent(details, new Event('toggle'));
    }
    expect(details.open).toBe(true);
    const t = copy.en.domainOwnership;
    expect(screen.getByText(t.title)).toBeInTheDocument();
    expect(screen.getByLabelText(t.labelMethod)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.start })).toBeInTheDocument();
  });

  it('opens by itself when a proof is already under way', async () => {
    const { details } = await renderPanel('en', PENDING);
    expect(details.open).toBe(true);
    expect(screen.getByText(PENDING.record)).toBeInTheDocument();
  });
});
