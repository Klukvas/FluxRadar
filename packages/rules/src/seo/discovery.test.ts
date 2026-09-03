import { describe, expect, it } from 'vitest';

import { htmlContext, runRule } from '../testing/fixture-harness.js';

describe('SEO structured data and social preview', () => {
  it('finds malformed JSON-LD without treating absent JSON-LD as an error', () => {
    const malformed = htmlContext(
      '<!doctype html><html lang="en"><head><title>Structured data</title>' +
        '<script type="application/ld+json">{"@context":</script></head><body>' +
        '<main><h1>Structured data</h1></main></body></html>',
    );
    expect(runRule('SEO', 'SEO-STRUCT-001', malformed)).toHaveLength(1);
    expect(
      runRule(
        'SEO',
        'SEO-STRUCT-001',
        htmlContext(
          '<!doctype html><html lang="en"><head><title>No schema</title></head><body>' +
            '<main><h1>No schema</h1></main></body></html>',
        ),
      ),
    ).toEqual([]);
  });

  it('finds JSON-LD without @context/@type and accepts a complete object', () => {
    expect(
      runRule(
        'SEO',
        'SEO-STRUCT-002',
        htmlContext(
          '<!doctype html><html lang="en"><head><title>Incomplete schema</title>' +
            '<script type="application/ld+json">{"name":"Example"}</script></head>' +
            '<body><main><h1>Schema</h1></main></body></html>',
        ),
      ),
    ).toHaveLength(1);
    expect(
      runRule(
        'SEO',
        'SEO-STRUCT-002',
        htmlContext(
          '<!doctype html><html lang="en"><head><title>Complete schema</title>' +
            '<script type="application/ld+json">' +
            '{"@context":"https://schema.org","@type":"Organization"}' +
            '</script></head><body><main><h1>Schema</h1></main></body></html>',
        ),
      ),
    ).toEqual([]);
  });

  it('checks the minimum social preview fields', () => {
    const missing = htmlContext(
      '<!doctype html><html lang="en"><head><title>Social</title>' +
        '<meta property="og:title" content="Example" /></head><body>' +
        '<main><h1>Social</h1></main></body></html>',
    );
    const finding = runRule('SEO', 'SEO-SOCIAL-001', missing)[0];
    expect(finding?.evidenceExcerpt).toContain('og:description');
    expect(finding?.evidenceExcerpt).toContain('twitter:card');

    const complete = htmlContext(
      '<!doctype html><html lang="en"><head><title>Social</title>' +
        '<meta property="og:title" content="Example" />' +
        '<meta property="og:description" content="A description" />' +
        '<meta property="og:image" content="https://example.com/image.png" />' +
        '<meta property="og:url" content="https://example.com/page" />' +
        '<meta name="twitter:card" content="summary" /></head><body>' +
        '<main><h1>Social</h1></main></body></html>',
    );
    expect(runRule('SEO', 'SEO-SOCIAL-001', complete)).toEqual([]);
  });
});
