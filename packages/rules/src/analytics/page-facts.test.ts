import { describe, expect, it } from 'vitest';

import { siteContext } from '../testing/fixture-harness.js';
import { analyticsPageFacts } from './page-facts.js';

// D-219: Analytics compares the crawl with Search Console and GA4 after the
// crawl itself is gone, so the scan hands it one fact sheet per page.

function factsFor(pages: Parameters<typeof siteContext>[0]['pages']) {
  return analyticsPageFacts(siteContext({ pages }));
}

describe('analytics page facts', () => {
  it('finds a Google tag loaded through gtag.js, an inline config or Tag Manager', () => {
    const facts = factsFor([
      {
        path: '/gtag',
        html: '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script>',
      },
      {
        path: '/proxied',
        html: '<script async src="/metrics/gtag/js?id=G-ABC123"></script>',
      },
      { path: '/inline', html: "<script>gtag('config', 'G-ABC123');</script>" },
      {
        path: '/gtm',
        html: "<script>(function(w,d,s,l,i){j.src='https://www.googletagmanager.com/gtm.js?id='+i})(window,document,'script','dataLayer','GTM-AB12CD');</script>",
      },
      { path: '/none', html: '<h1>No tag here</h1>' },
    ]);

    expect(facts.map(({ url, hasGoogleTag }) => ({ url, hasGoogleTag }))).toEqual([
      { url: 'https://fixture.test/gtag', hasGoogleTag: true },
      { url: 'https://fixture.test/proxied', hasGoogleTag: true },
      { url: 'https://fixture.test/inline', hasGoogleTag: true },
      { url: 'https://fixture.test/gtm', hasGoogleTag: true },
      { url: 'https://fixture.test/none', hasGoogleTag: false },
    ]);
  });

  it('does not count a page Google is told not to show as indexable', () => {
    const facts = factsFor([
      { path: '/open', html: '<title>Open</title>' },
      { path: '/meta', html: '<meta name="robots" content="noindex, follow">' },
      { path: '/header', html: '<title>Header</title>', headers: { 'X-Robots-Tag': 'none' } },
      {
        path: '/elsewhere',
        html: '<link rel="canonical" href="https://fixture.test/open">',
      },
      { path: '/self', html: '<link rel="canonical" href="/self">' },
    ]);

    expect(facts.map(({ url, indexable }) => ({ url, indexable }))).toEqual([
      { url: 'https://fixture.test/open', indexable: true },
      { url: 'https://fixture.test/meta', indexable: false },
      { url: 'https://fixture.test/header', indexable: false },
      { url: 'https://fixture.test/elsewhere', indexable: false },
      { url: 'https://fixture.test/self', indexable: true },
    ]);
  });

  it('leaves out pages that did not load as HTML', () => {
    const facts = factsFor([
      { path: '/ok', html: '<title>Ok</title>' },
      { path: '/missing', status: 404, html: '<title>Not found</title>' },
      { path: '/file.pdf', html: null, contentType: 'application/pdf' },
    ]);

    expect(facts.map((fact) => fact.url)).toEqual(['https://fixture.test/ok']);
  });
});
