// A quiet re-read of one report's dashboard, for a block that changes in place
// (the Free AI answer being added after the check finished, D-236).

import { useCallback, useEffect, useRef } from 'react';

import { apiRequest, type Dashboard } from './api';

/**
 * No skeleton and no error dialog: a read that fails keeps what is on screen
 * and answers false, because its caller polls and the next tick asks again.
 *
 * A read still in flight when the owner opens another report answers for the
 * scan it was sent for; it is dropped rather than painted over the report now
 * on screen.
 */
export function useQuietDashboardRefresh(
  scanId: string | null,
  onDashboard: (value: Dashboard) => void,
): () => Promise<boolean> {
  const current = useRef(scanId);
  useEffect(() => {
    current.current = scanId;
  }, [scanId]);
  return useCallback(async (): Promise<boolean> => {
    if (scanId === null) return false;
    try {
      const value = await apiRequest<Dashboard>(`/scans/${scanId}/dashboard`);
      if (value.scan.id !== current.current) return false;
      onDashboard(value);
      return true;
    } catch {
      return false;
    }
  }, [scanId, onDashboard]);
}
