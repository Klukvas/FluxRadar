// Three dead ends a failed request used to leave behind, pinned so they stay
// closed:
//  - a site list that failed to load read as "no sites yet";
//  - a scan whose status poll failed raised the error dialog every second;
//  - an email confirmation that failed said "checking…" forever.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Scan } from './api';
import { AuthScreen } from './AuthScreen';
import { DesktopScreen } from './DesktopScreen';
import { ScanScreen } from './ScanProgress';
import {
  isFatalPollError,
  nextPollDelay,
  SCAN_POLL_BASE_MS,
  SCAN_POLL_MAX_MS,
} from './use-scan-polling';
import { ApiRequestError } from './api';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

function failure(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ success: false, data: null, error: { code: 'X', message } }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

function ok<T>(data: T): Response {
  return new Response(JSON.stringify({ success: true, data, error: null }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('a site list that failed to load', () => {
  it('says so and offers a retry instead of the empty state', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(ok(null))),
    );
    const onRetryProfiles = vi.fn(() => Promise.resolve());
    render(
      <DesktopScreen
        profiles={[]}
        profilesFailed
        onRetryProfiles={onRetryProfiles}
        onOpenIntegrations={() => {}}
        onRefresh={() => Promise.resolve()}
        onProfileDeleted={() => {}}
        onSelectProfile={() => {}}
        onNewScan={() => {}}
        onOpenScan={() => {}}
        onRetryScan={() => Promise.resolve()}
        onError={() => {}}
        onNotice={() => {}}
        onOnboarding={() => {}}
        language="en"
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Your sites could not be loaded.');
    expect(screen.queryByText('No sites yet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetryProfiles).toHaveBeenCalledTimes(1);
  });
});

const RUNNING = {
  id: 'scan-1',
  profileId: 'profile-1',
  plan: 'Basic',
  domain: 'https://example.com',
  status: 'Running',
  statusReason: null,
  scope: { includeSubdomains: false },
  rulesetVersion: 'rules-v1',
  progress: { completedModules: 0, totalModules: 1, scannedUrls: 0, discoveredUrls: 0 },
  startedAt: new Date().toISOString(),
  completedAt: null,
  createdAt: new Date().toISOString(),
  modules: [],
} as unknown as Scan;

function renderScan(onError: (message: string) => void) {
  render(
    <ScanScreen
      scan={RUNNING}
      language="en"
      onUpdate={() => {}}
      onDone={() => {}}
      onReports={() => {}}
      onError={onError}
    />,
  );
}

describe('scan status polling', () => {
  it('backs off after failures and never waits longer than the cap', () => {
    expect(nextPollDelay(0)).toBe(SCAN_POLL_BASE_MS);
    expect(nextPollDelay(2)).toBe(SCAN_POLL_BASE_MS * 4);
    expect(nextPollDelay(10)).toBe(SCAN_POLL_MAX_MS);
  });

  it('treats only answers polling cannot change as fatal', () => {
    expect(isFatalPollError(new ApiRequestError('gone', { code: null, status: 404 }))).toBe(true);
    expect(isFatalPollError(new ApiRequestError('busy', { code: null, status: 429 }))).toBe(false);
    expect(isFatalPollError(new ApiRequestError('down', { code: null, status: 503 }))).toBe(false);
    expect(isFatalPollError(new ApiRequestError('offline', { code: null, status: 0 }))).toBe(false);
  });

  it('shows a quiet connection line instead of a dialog when the network drops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetchMock);
    const onError = vi.fn();
    renderScan(onError);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(onError).not.toHaveBeenCalled();
    expect(screen.getByText(/Connection lost\./)).toBeInTheDocument();
    // Backed off: 1 immediate poll plus retries after 2s, 4s and 8s at most.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('reports a scan that is gone once and stops asking', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn(() => Promise.resolve(failure(404, 'Scan not found')));
    vi.stubGlobal('fetch', fetchMock);
    const onError = vi.fn();
    renderScan(onError);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('an email confirmation that failed', () => {
  it('ends in a state that says what to do next', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          String(input).includes('/auth/verify-email')
            ? failure(400, 'This link has expired.')
            : ok({ enabled: false }),
        ),
      ),
    );
    const onError = vi.fn();
    render(
      <AuthScreen
        language="en"
        onAuthed={() => Promise.resolve()}
        error={null}
        onError={onError}
        onBack={() => {}}
        initialMode="login"
        emailAction={{ kind: 'verify', token: 'expired-token' }}
      />,
    );

    expect(await screen.findByText(/This link did not work/)).toBeInTheDocument();
    expect(screen.queryByText('Checking your one-time link…')).not.toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith('This link has expired.');
  });
});
