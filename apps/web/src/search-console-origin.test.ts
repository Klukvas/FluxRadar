import { describe, expect, it } from 'vitest';

import { originFromSearchConsoleProperty } from './search-console-origin';

describe('originFromSearchConsoleProperty — properties that map onto a profile', () => {
  it.each([
    ['a domain property', 'sc-domain:example.com', 'https://example.com', 'example.com'],
    [
      'a domain property with a subdomain',
      'sc-domain:shop.example.com',
      'https://shop.example.com',
      'shop.example.com',
    ],
    ['an uppercase domain property', 'sc-domain:Example.COM', 'https://example.com', 'example.com'],
    ['a url-prefix property', 'https://example.com/', 'https://example.com', 'example.com'],
    [
      'a url-prefix property with a path',
      'https://example.com/shop/',
      'https://example.com',
      'example.com',
    ],
    [
      'a url-prefix property on a subdomain',
      'https://www.example.com/',
      'https://www.example.com',
      'www.example.com',
    ],
  ])('converts %s', (_case, property, origin, host) => {
    const result = originFromSearchConsoleProperty(property);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.origin).toBe(origin);
      expect(result.host).toBe(host);
    }
  });

  it('keeps a non-default port, because it is part of the origin Google verified', () => {
    const result = originFromSearchConsoleProperty('https://example.com:8443/');

    expect(result).toEqual({ ok: true, origin: 'https://example.com:8443', host: 'example.com' });
  });

  it('drops the redundant default port the way the profile schema does', () => {
    const result = originFromSearchConsoleProperty('https://example.com:443/');

    expect(result).toEqual({ ok: true, origin: 'https://example.com', host: 'example.com' });
  });
});

describe('originFromSearchConsoleProperty — properties that must not become a profile', () => {
  it('refuses an http url-prefix property instead of upgrading its scheme', () => {
    // Upgrading would silently audit a different origin than the verified one.
    expect(originFromSearchConsoleProperty('http://example.com/')).toEqual({
      ok: false,
      reason: 'insecure_scheme',
    });
  });

  it.each([
    ['an android app property', 'android-app://com.example.app'],
    ['a domain property with a path', 'sc-domain:example.com/shop'],
    ['a domain property with a port', 'sc-domain:example.com:8443'],
    ['an empty domain property', 'sc-domain:'],
    ['a host without a dot', 'https://localhost/'],
    ['a bare host', 'example.com'],
    ['a url with credentials', 'https://user:pass@example.com/'],
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['unparseable text', 'not a property'],
  ])('refuses %s as unsupported', (_case, property) => {
    expect(originFromSearchConsoleProperty(property)).toEqual({ ok: false, reason: 'unsupported' });
  });
});
