import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { PrintReport } from './PrintReport';
import { findingsCopy } from './findings-copy';

// The printable report's load fails as one combined read. The failure must not
// leave the owner on an eternal "Preparing…" skeleton: it names what happened,
// offers a retry, and the retry really re-runs the load.

function envelope<T>(data: T, meta?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ success: true, data, error: null, ...meta }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(): {
  fetch: ReturnType<typeof vi.fn>;
  dashboardCalls: () => number;
} {
  const fetch = vi.fn((input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path.includes('/dashboard')) return Promise.reject(new TypeError('network down'));
    if (path.includes('/issues/summary'))
      return Promise.resolve(envelope({ total: 0, open: 0, bySeverity: {}, groups: [] }));
    if (path.includes('/issues'))
      return Promise.resolve(envelope([], { meta: { total: 0, page: 1, limit: 100 } }));
    return Promise.resolve(envelope(null));
  });
  vi.stubGlobal('fetch', fetch);
  return {
    fetch,
    dashboardCalls: () =>
      fetch.mock.calls.filter((call) => String(call[0]).includes('/dashboard')).length,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows the failure with a retry instead of the eternal loading skeleton, and retries', async () => {
  const f = findingsCopy.en.print;
  const { dashboardCalls } = stubFetch();
  render(<PrintReport scanId="scan-print" language="en" onBack={() => {}} onError={() => {}} />);

  expect(await screen.findByRole('alert')).toHaveTextContent(f.loadFailed);
  expect(screen.queryByText(f.loading)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: f.back })).toBeInTheDocument();

  const before = dashboardCalls();
  fireEvent.click(screen.getByRole('button', { name: f.retry }));
  // The retry re-runs the load: the dashboard is asked again, and the failure
  // returns once that second attempt also fails.
  await waitFor(() => expect(dashboardCalls()).toBe(before + 1));
  expect(await screen.findByRole('alert')).toHaveTextContent(f.loadFailed);
});
