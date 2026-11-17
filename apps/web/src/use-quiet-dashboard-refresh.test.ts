import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Dashboard } from './api';
import { useQuietDashboardRefresh } from './use-quiet-dashboard-refresh';

// A poll sent for one report must not paint its answer over another report the
// owner opened while it was in flight.

function dashboardOf(scanId: string): Dashboard {
  return { scan: { id: scanId } } as unknown as Dashboard;
}

/** A fetch whose answer the test releases when it chooses. */
function heldFetch() {
  let release: (scanId: string) => void = () => undefined;
  const fetchMock = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = (scanId) =>
          resolve(
            new Response(
              JSON.stringify({ success: true, data: dashboardOf(scanId), error: null }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          );
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return { release: (scanId: string) => release(scanId) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a quiet report re-read', () => {
  it('drops an answer for a report that is no longer the one open', async () => {
    const held = heldFetch();
    const onDashboard = vi.fn();
    const { result, rerender } = renderHook(
      ({ scanId }) => useQuietDashboardRefresh(scanId, onDashboard),
      { initialProps: { scanId: 'scan-a' } },
    );
    const inFlight = result.current();
    rerender({ scanId: 'scan-b' });
    held.release('scan-a');

    await act(async () => {
      expect(await inFlight).toBe(false);
    });
    expect(onDashboard).not.toHaveBeenCalled();
  });

  it('paints the answer for the report still open', async () => {
    const held = heldFetch();
    const onDashboard = vi.fn();
    const { result } = renderHook(() => useQuietDashboardRefresh('scan-a', onDashboard));
    const inFlight = result.current();
    held.release('scan-a');

    await act(async () => {
      expect(await inFlight).toBe(true);
    });
    expect(onDashboard).toHaveBeenCalledWith(dashboardOf('scan-a'));
  });
});
