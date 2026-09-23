import { describe, expect, it } from 'vitest';
import { scanScopeSchema } from '@fluxradar/contracts';

import { isWithinSite, scopeTargetMessage, scopeTargetProblems } from './scope-targets.ts';

// A scan is of one site. The two settings that name addresses of their own —
// the seed list and the API checks — must therefore name that site's addresses,
// or the product becomes a way to point paid traffic at a third party.

function scope(overrides: Record<string, unknown>) {
  return scanScopeSchema.parse({ includeSubdomains: false, ...overrides });
}

describe('isWithinSite', () => {
  it('accepts the site itself and refuses another host', () => {
    expect(isWithinSite('https://example.com/api', 'https://example.com', false)).toBe(true);
    expect(isWithinSite('https://evil.example/api', 'https://example.com', false)).toBe(false);
  });

  it('accepts a subdomain only when the scan includes subdomains', () => {
    expect(isWithinSite('https://api.example.com/x', 'https://example.com', false)).toBe(false);
    expect(isWithinSite('https://api.example.com/x', 'https://example.com', true)).toBe(true);
  });

  // "example.com.evil.test" ends with the site's name but is not under it.
  it('is not fooled by a host that merely ends with the site name', () => {
    expect(isWithinSite('https://example.com.evil.test/x', 'https://example.com', true)).toBe(
      false,
    );
  });

  it('refuses anything that is not http(s)', () => {
    expect(isWithinSite('file:///etc/passwd', 'https://example.com', false)).toBe(false);
    expect(isWithinSite('not a url', 'https://example.com', false)).toBe(false);
  });
});

describe('scopeTargetProblems', () => {
  it('passes a scope whose addresses are all on the site', () => {
    const problems = scopeTargetProblems(
      scope({
        seedUrls: ['https://example.com/pricing'],
        apiChecks: [{ method: 'GET', url: 'https://example.com/api/health' }],
      }),
      'https://example.com',
    );

    expect(problems).toEqual([]);
  });

  it('names every off-site address and which setting it came from', () => {
    const problems = scopeTargetProblems(
      scope({
        seedUrls: ['https://elsewhere.test/a'],
        apiChecks: [{ method: 'GET', url: 'https://elsewhere.test/api' }],
      }),
      'https://example.com',
    );

    expect(problems.map((problem) => problem.field)).toEqual(['seedUrls', 'apiChecks']);
    expect(scopeTargetMessage(problems)).toContain('https://elsewhere.test/a');
  });

  it('accepts a subdomain address when the scan includes subdomains', () => {
    const withSubdomains = scope({
      includeSubdomains: true,
      apiChecks: [{ method: 'GET', url: 'https://api.example.com/health' }],
    });
    expect(scopeTargetProblems(withSubdomains, 'https://example.com')).toEqual([]);

    const withoutSubdomains = scope({
      apiChecks: [{ method: 'GET', url: 'https://api.example.com/health' }],
    });
    expect(scopeTargetProblems(withoutSubdomains, 'https://example.com')).toHaveLength(1);
  });
});
