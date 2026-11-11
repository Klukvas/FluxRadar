// Keeps a running scan on screen up to date, and stays calm when the network
// does not.
//
// A dropped connection used to raise the error dialog on every one-second poll,
// so closing it only brought it back. A connection problem is now a quiet line
// inside the progress panel and polls back off until the API answers again;
// only an answer that polling cannot fix (the scan is gone, or not yours)
// still reaches the dialog, and once.

import { useEffect, useState } from 'react';

import { trackEvent } from './analytics';
import { apiRequest, ApiRequestError, type Scan } from './api';
import { isTerminalScanStatus } from './scan-status';

export const SCAN_POLL_BASE_MS = 1000;
export const SCAN_POLL_MAX_MS = 15_000;
/** Failed polls in a row before the owner is told the connection is lost. */
export const SCAN_POLL_ERROR_BUDGET = 3;

/** How long to wait after `failures` failed polls in a row (0 = healthy). */
export function nextPollDelay(failures: number): number {
  return Math.min(SCAN_POLL_BASE_MS * 2 ** failures, SCAN_POLL_MAX_MS);
}

/** An answer that asking again cannot change: a client error other than timeout or throttling. */
export function isFatalPollError(caught: unknown): boolean {
  return (
    caught instanceof ApiRequestError &&
    caught.status >= 400 &&
    caught.status < 500 &&
    caught.status !== 408 &&
    caught.status !== 429
  );
}

function isSettled(scan: Scan): boolean {
  return isTerminalScanStatus(scan.status) && scan.reportReady !== false;
}

export function useScanPolling(options: {
  readonly scan: Scan | null;
  readonly onUpdate: (scan: Scan) => void;
  readonly onError: (message: string) => void;
}): { readonly connectionLost: boolean } {
  const { scan, onUpdate, onError } = options;
  const [connectionLost, setConnectionLost] = useState(false);
  const scanId = scan === null || isSettled(scan) ? null : scan.id;
  useEffect(() => {
    setConnectionLost(false);
    if (scanId === null) return undefined;
    let cancelled = false;
    let inFlight = false;
    let failures = 0;
    let timer: number | undefined;
    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void poll(), delay);
    };
    const poll = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      window.clearTimeout(timer);
      try {
        const next = await apiRequest<Scan>(`/scans/${scanId}`);
        if (cancelled) return;
        failures = 0;
        setConnectionLost(false);
        onUpdate(next);
        if (isSettled(next)) {
          // Only a scan watched to the end is reported: this effect never polls
          // one that was already finished when the screen opened.
          trackEvent('scan_completed', { plan: next.plan, status: next.status });
          return;
        }
        schedule(SCAN_POLL_BASE_MS);
      } catch (caught) {
        if (cancelled) return;
        if (isFatalPollError(caught)) {
          onError(caught instanceof Error ? caught.message : 'Scan status unavailable');
          return;
        }
        console.warn('FluxRadar scan status poll failed', caught);
        failures += 1;
        if (failures >= SCAN_POLL_ERROR_BUDGET) setConnectionLost(true);
        schedule(nextPollDelay(failures));
      } finally {
        inFlight = false;
      }
    };
    const onOnline = () => void poll();
    window.addEventListener('online', onOnline);
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [scanId, onError, onUpdate]);
  return { connectionLost };
}
