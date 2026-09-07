import { describe, expect, it } from 'vitest';

import { copy } from './i18n';
import { normalizeSiteAddress, siteNameFromAddress } from './site-address-input';

describe('normalizeSiteAddress — accepts what a non-technical owner types', () => {
  it.each([
    ['bare domain', 'mysite.com', 'https://mysite.com'],
    ['www host', 'www.mysite.com', 'https://www.mysite.com'],
    ['full url with path + query', 'https://mysite.com/about?ref=1', 'https://mysite.com'],
    ['url with fragment', 'https://mysite.com/pricing#plans', 'https://mysite.com'],
    ['http upgraded to https', 'http://mysite.com', 'https://mysite.com'],
    ['surrounding whitespace trimmed', '   mysite.com   ', 'https://mysite.com'],
    ['mixed-case host lowercased', 'MySite.COM', 'https://mysite.com'],
    ['multi-label domain', 'sub.mysite.co.uk', 'https://sub.mysite.co.uk'],
    ['explicit non-default port kept', 'mysite.com:8443', 'https://mysite.com:8443'],
    ['default https port stripped', 'https://mysite.com:443', 'https://mysite.com'],
  ])('normalizes a %s to a clean https origin', (_label, input, expected) => {
    const result = normalizeSiteAddress(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.origin).toBe(expected);
  });
});

describe('normalizeSiteAddress — rejects unsafe or invalid input', () => {
  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
    ['input containing a space', 'my site.com'],
    ['a bare word without a dot', 'notawebsite'],
    ['localhost (not a public site)', 'localhost'],
    ['leading-dot host', '.mysite.com'],
    ['trailing-dot host', 'mysite.'],
    ['ftp scheme', 'ftp://mysite.com'],
    ['file scheme', 'file:///etc/passwd'],
    ['mailto scheme', 'mailto:owner@mysite.com'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html,hi'],
    ['tel scheme', 'tel:+15551234567'],
    ['embedded credentials', 'https://user:pass@mysite.com'],
  ])('rejects %s', (_label, input) => {
    const result = normalizeSiteAddress(input);
    expect(result.ok).toBe(false);
  });

  it('never exposes backend validation jargon in the message the owner reads', () => {
    // The refusal carries no copy of its own; the one sentence shown for it is
    // the localized field error, in both languages.
    for (const language of ['en', 'uk'] as const) {
      const message = copy[language].workspace.siteAddressError;
      expect(message).not.toMatch(/origin|https|url|protocol|hostname/i);
      expect(message).toContain('mysite.com');
    }
  });
});

describe('siteNameFromAddress — the profile name the form suggests', () => {
  it.each([
    ['bare domain', 'mysite.com', 'mysite.com'],
    ['www stripped', 'www.mysite.com', 'mysite.com'],
    ['scheme and path dropped', 'https://mysite.com/about?ref=1', 'mysite.com'],
    ['http address', 'http://www.mysite.com', 'mysite.com'],
    ['surrounding whitespace trimmed', '   mysite.com   ', 'mysite.com'],
    ['mixed case lowercased', 'MySite.COM', 'mysite.com'],
    ['subdomain kept, because it is a different site', 'shop.mysite.co.uk', 'shop.mysite.co.uk'],
    ['port dropped', 'mysite.com:8443', 'mysite.com'],
  ])('derives the name from a %s', (_label, input, expected) => {
    expect(siteNameFromAddress(input)).toBe(expected);
  });

  it('suggests nothing while the address is not a site address yet', () => {
    for (const input of ['', '   ', 'mysite', 'https://', 'my site.com', 'mailto:owner@mysite.com'])
      expect(siteNameFromAddress(input)).toBeNull();
  });

  it('keeps a dotted name when the host is literally www.<tld>', () => {
    // Stripping "www." here would leave a bare label, which is not a name.
    expect(siteNameFromAddress('www.com')).toBe('www.com');
  });
});
