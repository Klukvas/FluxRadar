import { describe, expect, it, vi } from 'vitest';

import { GoogleApiError } from './errors.ts';
import { googleJson } from './http.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const noSleep = async (): Promise<void> => undefined;

describe('googleJson', () => {
  it('sends the bearer token and returns the parsed body', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ok: true }));
    const result = await googleJson<{ ok: boolean }>(
      { url: 'https://example.test/v1', accessToken: 'token-value' },
      { fetcher: fetcher as unknown as typeof fetch, sleep: noSleep },
    );

    expect(result).toEqual({ ok: true });
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token-value');
    expect(init.method).toBe('GET');
  });

  it('POSTs a JSON body when one is supplied', async () => {
    const fetcher = vi.fn(async () => jsonResponse({}));
    await googleJson(
      { url: 'https://example.test/v1', accessToken: 't', body: { startDate: '2026-01-01' } },
      { fetcher: fetcher as unknown as typeof fetch, sleep: noSleep },
    );

    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"startDate":"2026-01-01"}');
  });

  it('retries a 503 and succeeds on a later attempt', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await googleJson<{ ok: boolean }>(
      { url: 'https://example.test/v1', accessToken: 't' },
      { fetcher: fetcher as unknown as typeof fetch, sleep: noSleep },
    );

    expect(result).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not retry a permission error and reports no_access', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ error: { message: 'project 12345' } }, 403));

    await expect(
      googleJson(
        { url: 'https://example.test/v1', accessToken: 't' },
        { fetcher: fetcher as unknown as typeof fetch, sleep: noSleep },
      ),
    ).rejects.toMatchObject({ state: 'no_access' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reports an expired token as needs_reconnect without leaking the provider body', async () => {
    const fetcher = vi.fn(async () => jsonResponse({ error: 'invalid_credentials' }, 401));

    const error = await googleJson(
      { url: 'https://example.test/v1', accessToken: 't' },
      { fetcher: fetcher as unknown as typeof fetch, sleep: noSleep },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GoogleApiError);
    expect((error as GoogleApiError).state).toBe('needs_reconnect');
    expect((error as GoogleApiError).message).not.toContain('invalid_credentials');
  });

  it('does not retry a rejected request even when it maps to request_failed', async () => {
    // GA4 answers 400 for a metric a legacy property does not expose. Repeating
    // the identical request only burns quota and scan time.
    const fetcher = vi.fn(async () => jsonResponse({ error: { message: 'bad metric' } }, 400));

    await expect(
      googleJson(
        { url: 'https://example.test/v1', accessToken: 't' },
        { fetcher: fetcher as unknown as typeof fetch, sleep: noSleep },
      ),
    ).rejects.toMatchObject({ state: 'request_failed' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('gives up after the attempt budget and reports request_failed', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('socket hang up');
    });

    await expect(
      googleJson(
        { url: 'https://example.test/v1', accessToken: 't' },
        { fetcher: fetcher as unknown as typeof fetch, sleep: noSleep, maxAttempts: 2 },
      ),
    ).rejects.toMatchObject({ state: 'request_failed' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
