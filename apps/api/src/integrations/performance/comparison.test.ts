// compareWithPrevious: the "same URL, same device" rule (comparison.ts rule 2)
// plus its T5 extension (rule 5) — a template whose representative URL moved
// between scans is reported as not comparable rather than silently compared
// across two different pages.

import { describe, expect, it } from 'vitest';

import { deviceResult, fakePerformanceAudit } from '../../test-utils/performance-fixtures.ts';
import { compareWithPrevious } from './comparison.ts';
import type { UrlAudit } from './types.ts';

const ORIGIN = 'https://example.com/';

function urlAudit(
  url: string,
  templateKey: string,
  representedPages: number,
  lcpMs: number,
): UrlAudit {
  return {
    url,
    primary: url === ORIGIN,
    templateKey,
    representedPages,
    devices: [deviceResult('mobile', { performanceScore: 80, lcpMs, ttfbMs: 300, clsScore: 0.02 })],
  };
}

describe('compareWithPrevious — template representative changed', () => {
  it('reports a template as not comparable when its representative URL changed, without producing regressions for it', () => {
    const previous = fakePerformanceAudit({
      urls: [urlAudit(`${ORIGIN}blog/2024/hello`, '/blog/{date}/{slug}', 3, 2_000)],
    });
    const current = fakePerformanceAudit({
      // Same template, a different representative URL — e.g. a newer post
      // sorted first this time.
      urls: [urlAudit(`${ORIGIN}blog/2025/world`, '/blog/{date}/{slug}', 4, 5_000)],
    });
    const result = compareWithPrevious(current, {
      scanId: 'previous-scan',
      observedAt: '2026-09-01T00:00:00.000Z',
      audit: previous,
    });
    expect(result.regressions).toEqual([]);
    expect(result.comparison?.incomparable).toBeNull();
    expect(result.comparison?.templatesNotComparable).toEqual([
      {
        templateKey: '/blog/{date}/{slug}',
        previousUrl: `${ORIGIN}blog/2024/hello`,
        currentUrl: `${ORIGIN}blog/2025/world`,
      },
    ]);
  });

  it('still compares templates whose representative stayed the same', () => {
    const previous = fakePerformanceAudit({
      urls: [
        urlAudit(`${ORIGIN}blog/2024/hello`, '/blog/{date}/{slug}', 3, 2_000),
        urlAudit(`${ORIGIN}about`, '/about', 1, 1_000),
      ],
    });
    const current = fakePerformanceAudit({
      urls: [
        // Representative moved for blog...
        urlAudit(`${ORIGIN}blog/2025/world`, '/blog/{date}/{slug}', 4, 2_050),
        // ...but /about is the same URL both times, and got materially worse.
        urlAudit(`${ORIGIN}about`, '/about', 1, 4_000),
      ],
    });
    const result = compareWithPrevious(current, {
      scanId: 'previous-scan',
      observedAt: '2026-09-01T00:00:00.000Z',
      audit: previous,
    });
    expect(result.comparison?.templatesNotComparable).toEqual([
      {
        templateKey: '/blog/{date}/{slug}',
        previousUrl: `${ORIGIN}blog/2024/hello`,
        currentUrl: `${ORIGIN}blog/2025/world`,
      },
    ]);
    // The unchanged /about representative is still compared and its
    // regression reported — the template exclusion does not swallow it.
    expect(result.regressions).toHaveLength(1);
    expect(result.regressions[0]).toMatchObject({ url: `${ORIGIN}about`, metric: 'lcpMs' });
  });

  it('reports no templatesNotComparable when every representative stayed the same', () => {
    const previous = fakePerformanceAudit({
      urls: [urlAudit(`${ORIGIN}blog/2024/hello`, '/blog/{date}/{slug}', 3, 2_000)],
    });
    const current = fakePerformanceAudit({
      urls: [urlAudit(`${ORIGIN}blog/2024/hello`, '/blog/{date}/{slug}', 3, 2_050)],
    });
    const result = compareWithPrevious(current, {
      scanId: 'previous-scan',
      observedAt: '2026-09-01T00:00:00.000Z',
      audit: previous,
    });
    expect(result.comparison?.templatesNotComparable).toEqual([]);
  });

  it('leaves templatesNotComparable empty when the audits are incomparable at the top level', () => {
    const previous = fakePerformanceAudit({
      urls: [urlAudit(`${ORIGIN}blog/2024/hello`, '/blog/{date}/{slug}', 3, 2_000)],
      providers: [{ name: 'pagespeed', version: '11.5.0', requests: 1, failures: 0 }],
    });
    const current = fakePerformanceAudit({
      urls: [urlAudit(`${ORIGIN}blog/2025/world`, '/blog/{date}/{slug}', 4, 5_000)],
      providers: [{ name: 'pagespeed', version: '13.0.0', requests: 1, failures: 0 }],
    });
    const result = compareWithPrevious(current, {
      scanId: 'previous-scan',
      observedAt: '2026-09-01T00:00:00.000Z',
      audit: previous,
    });
    expect(result.comparison?.incomparable?.code).toBe('LighthouseMajorChanged');
    expect(result.comparison?.templatesNotComparable).toEqual([]);
    expect(result.regressions).toEqual([]);
  });

  it('treats a URL with no templateKey (a pre-T5 snapshot) as excluded from the template check, falling back to URL comparison', () => {
    const previous = fakePerformanceAudit({
      urls: [
        {
          url: ORIGIN,
          primary: true,
          devices: [deviceResult('mobile', { performanceScore: 80, lcpMs: 2_000 })],
        },
      ],
    });
    const current = fakePerformanceAudit({
      urls: [
        {
          url: ORIGIN,
          primary: true,
          devices: [deviceResult('mobile', { performanceScore: 80, lcpMs: 5_000 })],
        },
      ],
    });
    const result = compareWithPrevious(current, {
      scanId: 'previous-scan',
      observedAt: '2026-09-01T00:00:00.000Z',
      audit: previous,
    });
    expect(result.comparison?.templatesNotComparable).toEqual([]);
    expect(result.regressions).toHaveLength(1);
  });
});
