import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from './api';

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
