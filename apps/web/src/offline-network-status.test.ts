import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ApiRequestError,
  apiDownload,
  apiRequest,
  isNetworkError,
  subscribeNetworkStatus,
} from './api';

describe('isNetworkError', () => {
  it('is true only for failures that never reached the API', () => {
    expect(isNetworkError(new ApiRequestError('down', { code: null, status: 0 }))).toBe(true);
    expect(isNetworkError(new ApiRequestError('refused', { code: 'NOPE', status: 403 }))).toBe(
      false,
    );
    expect(isNetworkError(new ApiRequestError('broken', { code: 'NOPE', status: 500 }))).toBe(
      false,
    );
    expect(isNetworkError(new Error('down'))).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
    expect(isNetworkError(null)).toBe(false);
  });
});

describe('network status signals', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports offline when the fetch itself rejects and online when it resolves', async () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeNetworkStatus((offline) => {
      seen.push(offline);
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(apiRequest('/ping')).rejects.toThrow('temporarily unavailable');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: { ok: true }, error: null }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    await apiRequest('/ping');
    unsubscribe();
    expect(seen).toEqual([true, false]);
  });

  it('treats a server refusal as online — the round-trip happened', async () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeNetworkStatus((offline) => {
      seen.push(offline);
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ success: false, data: null, error: { code: 'NOPE', message: 'No.' } }),
          { status: 403, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    await expect(apiRequest('/ping')).rejects.toThrow();
    unsubscribe();
    expect(seen).toEqual([false]);
  });

  it('reports through the download path too', async () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeNetworkStatus((offline) => {
      seen.push(offline);
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(apiDownload('/report.pdf')).rejects.toThrow();
    unsubscribe();
    expect(seen).toEqual([true]);
  });

  it('stops notifying after unsubscribe', async () => {
    const seen: boolean[] = [];
    const unsubscribe = subscribeNetworkStatus((offline) => {
      seen.push(offline);
    });
    unsubscribe();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await expect(apiRequest('/ping')).rejects.toThrow();
    expect(seen).toEqual([]);
  });
});
