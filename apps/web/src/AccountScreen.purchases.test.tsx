import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { PurchasesPanel } from './AccountScreen';
import { accountCopy } from './account-copy';

// A failed purchases fetch must not leave the panel as a bare error line: it
// offers a retry, and the retry really re-runs the fetch.

function envelope<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows a retry when the load fails and refetches on retry', async () => {
  const t = accountCopy.en.purchases;
  let attempts = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new TypeError('network down'));
      return Promise.resolve(envelope([]));
    }),
  );
  render(<PurchasesPanel language="en" onOpenScan={() => {}} />);

  expect(await screen.findByRole('alert')).toHaveTextContent(t.loadFailed);
  fireEvent.click(screen.getByRole('button', { name: t.retry }));

  expect(await screen.findByText(t.empty)).toBeInTheDocument();
  expect(attempts).toBe(2);
});

it('lists purchases when the load succeeds', async () => {
  const t = accountCopy.en.purchases;
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        envelope([
          {
            id: 'p1',
            plan: 'Basic',
            status: 'paid',
            amount: 1999,
            currency: 'USD',
            createdAt: '2026-10-01T00:00:00Z',
            domain: 'https://example.com',
            profileName: 'Example',
            entitlementExpiresAt: null,
            scanId: 'scan-1',
            scanStatus: 'Completed',
          },
        ]),
      ),
    ),
  );
  render(<PurchasesPanel language="en" onOpenScan={() => {}} />);

  expect(await screen.findByText(t.heading)).toBeInTheDocument();
  expect(screen.getByText('Basic')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: t.open })).toBeInTheDocument();
});
