import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiRequest, apiRequestWithMeta, hasMorePages, nextPageOffset } from './api';

describe('apiRequest user-facing errors', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('converts a non-envelope HTTP error into a product message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<h1>Not found</h1>', {
          status: 404,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );

    await expect(apiRequest('/missing')).rejects.toThrow('FluxRadar could not find the requested item.');
    await expect(apiRequest('/missing')).rejects.not.toThrow('HTTP 404');
  });

  it('hides the native network exception', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:3000')));

    await expect(apiRequest('/auth/me')).rejects.toThrow(
      'FluxRadar is temporarily unavailable. Try again in a moment.',
    );
    await expect(apiRequest('/auth/me')).rejects.not.toThrow('ECONNREFUSED');
  });

  it('keeps a custom backend envelope message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            success: false,
            data: null,
            error: { code: 'FREE_CHECK_USED', message: 'The free check has already been used.' },
          }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    await expect(apiRequest('/profiles/profile/free-check')).rejects.toThrow(
      'The free check has already been used.',
    );
  });
});

// ─── Pagination meta ─────────────────────────────────────────────────────────
//
// The API grew `meta.hasNext` alongside the `total`/`page`/`limit` it always
// sent. `apiRequest` deliberately still hands back bare data, so nothing that
// existed before this had to change; the list screens read the meta through
// `apiRequestWithMeta` instead. The fallback matters because a deployment older
// than `hasNext` must still be pageable rather than look like a single page.
// ─────────────────────────────────────────────────────────────────────────────
describe('pagination meta', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps apiRequest returning just the data, meta or no meta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: [{ id: 'scan-1' }],
              error: null,
              meta: { total: 3, page: 1, limit: 1, hasNext: true },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
      ),
    );

    await expect(apiRequest('/scans')).resolves.toEqual([{ id: 'scan-1' }]);
  });

  it('exposes the envelope meta to a caller that pages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: [],
              error: null,
              meta: { total: 3, page: 1, limit: 1, hasNext: true },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
      ),
    );

    const page = await apiRequestWithMeta('/scans');
    expect(page.meta).toEqual({ total: 3, page: 1, limit: 1, hasNext: true });
    expect(hasMorePages(page.meta)).toBe(true);
    expect(nextPageOffset(page.meta)).toBe(1);
  });

  it('answers null meta for a response that carries none', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ success: true, data: { id: 'a' }, error: null }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );

    const page = await apiRequestWithMeta('/scans/a');
    expect(page.meta).toBeNull();
    expect(hasMorePages(page.meta)).toBe(false);
  });

  it('derives hasNext from total and page when the server does not send it', () => {
    expect(hasMorePages({ total: 21, page: 1, limit: 20 })).toBe(true);
    expect(hasMorePages({ total: 20, page: 1, limit: 20 })).toBe(false);
    // An explicit hasNext always wins over the arithmetic: the server counted
    // the rows it actually returned, and the client did not.
    expect(hasMorePages({ total: 21, page: 1, limit: 20, hasNext: false })).toBe(false);
  });
});
