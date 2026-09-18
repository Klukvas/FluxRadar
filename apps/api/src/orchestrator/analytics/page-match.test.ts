import { describe, expect, it } from 'vitest';

import { isInPropertyScope, pageKey } from './page-match.ts';

// Search Console names a page by the URL Google indexed, the crawl by the URL
// the server answered on; the checks must not call them two pages.

describe('pageKey', () => {
  it('ignores the scheme and a trailing slash, but not the root', () => {
    expect(pageKey('https://example.com/blog/')).toBe(pageKey('http://example.com/blog'));
    expect(pageKey('https://example.com/')).toBe('example.com/');
    expect(pageKey('https://example.com')).toBe('example.com/');
  });

  it('keeps different pages apart', () => {
    expect(pageKey('https://example.com/blog')).not.toBe(pageKey('https://example.com/blog/a'));
    expect(pageKey('https://www.example.com/')).not.toBe(pageKey('https://example.com/'));
  });

  it('answers null for something that is not a URL', () => {
    expect(pageKey('not a url')).toBeNull();
  });
});

describe('isInPropertyScope', () => {
  it('covers the domain and its subdomains for a domain property', () => {
    expect(isInPropertyScope('sc-domain:example.com', 'https://example.com/a')).toBe(true);
    expect(isInPropertyScope('sc-domain:example.com', 'http://blog.example.com/')).toBe(true);
    expect(isInPropertyScope('sc-domain:example.com', 'https://notexample.com/')).toBe(false);
  });

  it('covers only URLs under the prefix for a URL-prefix property', () => {
    expect(isInPropertyScope('https://example.com/blog/', 'https://example.com/blog/a')).toBe(true);
    expect(isInPropertyScope('https://example.com/blog/', 'https://example.com/pricing')).toBe(
      false,
    );
    expect(isInPropertyScope('https://example.com/', 'http://example.com/')).toBe(false);
  });
});
