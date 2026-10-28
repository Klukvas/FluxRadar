import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from './api';
import { OfflineBanner, offlineBannerCopy } from './OfflineBanner';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('OfflineBanner', () => {
  it('is hidden while the connection is up', () => {
    render(<OfflineBanner language="en" />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('appears on the browser offline event and hides on online, in both languages', () => {
    const { rerender, unmount } = render(<OfflineBanner language="en" />);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByRole('status')).toHaveTextContent(offlineBannerCopy.en.body);
    rerender(<OfflineBanner language="uk" />);
    expect(screen.getByRole('status')).toHaveTextContent(offlineBannerCopy.uk.body);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByRole('status')).toBeNull();
    unmount();
  });

  it('appears when a request never reaches the API and clears when one completes', async () => {
    render(<OfflineBanner language="en" />);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    await act(async () => {
      await expect(apiRequest('/ping')).rejects.toThrow();
    });
    expect(screen.getByRole('status')).toHaveTextContent(offlineBannerCopy.en.body);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: { ok: true }, error: null }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    await act(async () => {
      await apiRequest('/ping');
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
