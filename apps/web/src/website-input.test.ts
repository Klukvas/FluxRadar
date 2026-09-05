import { describe, expect, it } from 'vitest';

import { normalizeWebsiteInput, WEBSITE_INPUT_ERROR } from './website-input';

describe('normalizeWebsiteInput — accepts what a non-technical owner types', () => {
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
    const result = normalizeWebsiteInput(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.origin).toBe(expected);
  });
});

describe('normalizeWebsiteInput — rejects unsafe or invalid input with one friendly message', () => {
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
    const result = normalizeWebsiteInput(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(WEBSITE_INPUT_ERROR);
  });

  it('never exposes backend validation jargon in the error copy', () => {
    const result = normalizeWebsiteInput('not valid');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toMatch(/origin|https|url|protocol|hostname/i);
      expect(result.error).toContain('mysite.com');
    }
  });
});
