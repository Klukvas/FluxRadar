import { describe, expect, it } from 'vitest';

import { API_CHECK_LIMITS, CRAWL_SEED_LIMITS } from './limits.js';
import { apiCheckInputSchema, publicHttpUrlSchema, scanScopeSchema } from './api.js';

// The settings that name URLs: what the boundary accepts, and what it must
// never accept. Host-level scope belongs to the scan (apps/api scope-targets),
// so what is pinned here is the shape — a public, anonymous, read-only address.

const base = { includeSubdomains: false };

describe('publicHttpUrlSchema', () => {
  it('accepts an ordinary http(s) address with a path and query', () => {
    expect(publicHttpUrlSchema.parse('https://example.com/api/x?y=1')).toBe(
      'https://example.com/api/x?y=1',
    );
  });

  it.each([
    ['a scheme that is not http(s)', 'file:///etc/passwd'],
    ['credentials in the URL', 'https://user:secret@example.com/'],
    ['a fragment the server never sees', 'https://example.com/#top'],
    ['a relative address', '/api/health'],
  ])('refuses %s', (_label, value) => {
    expect(publicHttpUrlSchema.safeParse(value).success).toBe(false);
  });
});

describe('apiCheckInputSchema', () => {
  it('defaults to GET and keeps the expected statuses', () => {
    expect(apiCheckInputSchema.parse({ url: 'https://example.com/api' })).toEqual({
      method: 'GET',
      url: 'https://example.com/api',
    });
    expect(
      apiCheckInputSchema.parse({
        method: 'HEAD',
        url: 'https://example.com/api',
        expectedStatus: [200, 404],
      }).expectedStatus,
    ).toEqual([200, 404]);
  });

  // The no-credentials policy is structural: there is no field to put one in.
  it.each([
    ['a write method', { method: 'POST', url: 'https://example.com/api' }],
    ['a status outside the HTTP range', { url: 'https://example.com/api', expectedStatus: [99] }],
  ])('refuses %s', (_label, value) => {
    expect(apiCheckInputSchema.safeParse(value).success).toBe(false);
  });

  it('has no place for request headers or a body', () => {
    const parsed = apiCheckInputSchema.parse({
      url: 'https://example.com/api',
      requestHeaders: { authorization: 'Bearer secret' },
      body: 'x',
    });
    expect(parsed).not.toHaveProperty('requestHeaders');
    expect(parsed).not.toHaveProperty('body');
  });
});

describe('scanScopeSchema', () => {
  it('defaults rendering off', () => {
    expect(scanScopeSchema.parse(base).renderJs).toBe(false);
  });

  it('keeps the seed list in the owner’s order', () => {
    const seedUrls = ['https://example.com/b', 'https://example.com/a'];
    expect(scanScopeSchema.parse({ ...base, seedUrls }).seedUrls).toEqual(seedUrls);
  });

  it('bounds both lists', () => {
    const seedUrls = Array.from(
      { length: CRAWL_SEED_LIMITS.maxSeedUrls + 1 },
      (_entry, index) => `https://example.com/${index}`,
    );
    expect(scanScopeSchema.safeParse({ ...base, seedUrls }).success).toBe(false);

    const apiChecks = Array.from({ length: API_CHECK_LIMITS.maxChecks + 1 }, (_entry, index) => ({
      url: `https://example.com/api/${index}`,
    }));
    expect(scanScopeSchema.safeParse({ ...base, apiChecks }).success).toBe(false);
  });

  it('refuses a seed that is not an absolute http(s) URL', () => {
    expect(scanScopeSchema.safeParse({ ...base, seedUrls: ['/relative'] }).success).toBe(false);
  });
});
