import { describe, expect, it, vi } from 'vitest';

import { createPerformanceRunner, createDefaultPerformanceRunner } from './performance.ts';

describe('performance integrations', () => {
  it('normalizes PageSpeed lab data and CrUX field data', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            lighthouseResult: {
              categories: { performance: { score: 0.91 } },
              audits: {
                'server-response-time': { numericValue: 120 },
                'largest-contentful-paint': { numericValue: 2100 },
                'interaction-to-next-paint': { numericValue: 80 },
                'cumulative-layout-shift': { numericValue: 0.04 },
              },
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            record: {
              metrics: {
                largest_contentful_paint: { percentiles: { p75: 2300 } },
                interaction_to_next_paint: { percentiles: { p75: 90 } },
                cumulative_layout_shift: { percentiles: { p75: 0.05 } },
              },
            },
          }),
          { status: 200 },
        ),
      );
    const runner = createPerformanceRunner({
      pageSpeedApiKey: 'pagespeed-key',
      cruxApiKey: 'crux-key',
      fetcher,
      now: () => new Date('2026-09-03T12:00:00.000Z'),
    });

    await expect(runner('https://example.com', 'desktop')).resolves.toEqual({
      source: 'pagespeed+crux',
      origin: 'https://example.com',
      strategy: 'desktop',
      performanceScore: 91,
      metrics: {
        ttfbMs: 120,
        lcpMs: 2100,
        inpMs: 80,
        cls: 0.04,
        htmlBytes: null,
        lcpP75Ms: 2300,
        inpP75Ms: 90,
        clsP75: 0.05,
      },
      fetchedAt: '2026-09-03T12:00:00.000Z',
    });
  });

  it('uses PageSpeed without a key and leaves the key optional', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          lighthouseResult: {
            categories: { performance: { score: 0.84 } },
            audits: {},
          },
        }),
        { status: 200 },
      ),
    );
    const runner = createPerformanceRunner({ pageSpeedApiKey: null, fetcher });

    await expect(runner('https://example.com', 'mobile')).resolves.toMatchObject({
      source: 'pagespeed',
      performanceScore: 84,
      strategy: 'mobile',
    });
    const [url] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).not.toContain('key=');
  });

  it('keeps CrUX measurements when PageSpeed is unavailable', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            record: {
              metrics: {
                largest_contentful_paint: { percentiles: { p75: 1900 } },
              },
            },
          }),
          { status: 200 },
        ),
      );
    const runner = createPerformanceRunner({
      pageSpeedApiKey: null,
      cruxApiKey: 'crux-key',
      fetcher,
    });

    await expect(runner('https://example.com', 'desktop')).resolves.toMatchObject({
      source: 'crux',
      performanceScore: null,
      metrics: { lcpP75Ms: 1900 },
    });
  });

  it('enables the default runner even when no optional provider key is configured', () => {
    const previousPageSpeed = process.env.PAGESPEED_API_KEY;
    const previousCrux = process.env.CRUX_API_KEY;
    delete process.env.PAGESPEED_API_KEY;
    delete process.env.CRUX_API_KEY;
    expect(createDefaultPerformanceRunner()).toEqual(expect.any(Function));
    if (previousPageSpeed === undefined) delete process.env.PAGESPEED_API_KEY;
    else process.env.PAGESPEED_API_KEY = previousPageSpeed;
    if (previousCrux === undefined) delete process.env.CRUX_API_KEY;
    else process.env.CRUX_API_KEY = previousCrux;
  });
});
