import { describe, expect, it } from 'vitest';

import {
  issueStatusUpdateInputSchema,
  loginInputSchema,
  registerInputSchema,
  scanRequestInputSchema,
  siteProfileInputSchema,
} from './api.js';

describe('registerInputSchema', () => {
  it('accepts a valid email and an 8+ character password', () => {
    const result = registerInputSchema.safeParse({
      email: 'user@example.com',
      password: 'longenough',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a password shorter than 8 characters', () => {
    expect(
      registerInputSchema.safeParse({ email: 'user@example.com', password: 'short7!' }).success,
    ).toBe(false);
  });

  it('rejects an invalid email', () => {
    expect(
      registerInputSchema.safeParse({ email: 'not-an-email', password: 'longenough' }).success,
    ).toBe(false);
  });

  // D-111: the 72 limit is the bcrypt truncation boundary in BYTES, not characters.
  it('applies the 72-byte password limit in UTF-8 bytes, not characters', () => {
    const parse = (password: string): boolean =>
      registerInputSchema.safeParse({ email: 'user@example.com', password }).success;

    expect(parse('a'.repeat(72))).toBe(true);
    expect(parse('a'.repeat(73))).toBe(false);
    // 36 Cyrillic characters = 72 UTF-8 bytes; 37 characters = 74 bytes.
    expect(parse('п'.repeat(36))).toBe(true);
    expect(parse('п'.repeat(37))).toBe(false);
  });
});

describe('loginInputSchema', () => {
  it('rejects an empty password', () => {
    expect(loginInputSchema.safeParse({ email: 'user@example.com', password: '' }).success).toBe(
      false,
    );
  });
});

describe('siteProfileInputSchema', () => {
  const base = { name: 'My Site' };

  it.each(['https://example.com', 'https://example.com/'])('accepts a root https origin and normalizes it', (domain) => {
    const result = siteProfileInputSchema.safeParse({ ...base, domain });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.domain).toBe('https://example.com');
    }
  });

  it('normalizes host case and default port to the canonical origin', () => {
    const result = siteProfileInputSchema.safeParse({ ...base, domain: 'https://Example.com:443' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.domain).toBe('https://example.com');
    }
  });

  it.each([
    ['path', 'https://example.com/path'],
    ['query', 'https://example.com?q=1'],
    ['fragment', 'https://example.com#top'],
    ['userinfo', 'https://user:pass@example.com'],
    ['http scheme', 'http://example.com'],
    ['not a URL', 'example.com'],
  ])('rejects a domain with %s', (_label, domain) => {
    expect(siteProfileInputSchema.safeParse({ ...base, domain }).success).toBe(false);
  });
});

describe('scanRequestInputSchema', () => {
  it('accepts a Basic scan within the plan URL limit', () => {
    const result = scanRequestInputSchema.safeParse({
      plan: 'Basic',
      scope: { includeSubdomains: true, maxPages: 5000, urlPatterns: ['/blog/*'] },
    });
    expect(result.success).toBe(true);
  });

  it('rejects maxPages above the plan URL limit', () => {
    const result = scanRequestInputSchema.safeParse({
      plan: 'Basic',
      scope: { includeSubdomains: false, maxPages: 5001 },
    });
    expect(result.success).toBe(false);
  });

  it('applies the higher Complete limit', () => {
    const result = scanRequestInputSchema.safeParse({
      plan: 'Complete',
      scope: { includeSubdomains: false, maxPages: 50_000 },
    });
    expect(result.success).toBe(true);
  });

  it('normalizes the full crawl scope and requires an explicit robots override confirmation', () => {
    const parsed = scanRequestInputSchema.safeParse({
      plan: 'Complete',
      scope: {
        includeSubdomains: true,
        maxPages: 100,
        maxDepth: 4,
        urlPatterns: ['/docs/*'],
        excludePatterns: ['/docs/private/*'],
        queryPolicy: 'include',
        respectRobots: true,
        userAgent: 'mobile',
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.scope.queryPolicy).toBe('include');
      expect(parsed.data.scope.userAgent).toBe('mobile');
      expect(parsed.data.scope.robotsOverrideConfirmed).toBe(false);
    }
    expect(scanRequestInputSchema.safeParse({
      plan: 'Complete',
      scope: { includeSubdomains: false, respectRobots: false },
    }).success).toBe(false);
    expect(scanRequestInputSchema.safeParse({
      plan: 'Complete',
      scope: { includeSubdomains: false, respectRobots: false, robotsOverrideConfirmed: true },
    }).success).toBe(true);
  });

  it('rejects an unknown plan and a malformed scope', () => {
    expect(
      scanRequestInputSchema.safeParse({ plan: 'Ultimate', scope: { includeSubdomains: true } })
        .success,
    ).toBe(false);
    expect(
      scanRequestInputSchema.safeParse({ plan: 'Basic', scope: { includeSubdomains: 'yes' } })
        .success,
    ).toBe(false);
  });
});

describe('issueStatusUpdateInputSchema', () => {
  it('accepts user-settable statuses', () => {
    expect(issueStatusUpdateInputSchema.safeParse({ status: 'Ignored' }).success).toBe(true);
    expect(issueStatusUpdateInputSchema.safeParse({ status: 'False Positive' }).success).toBe(true);
  });

  it('rejects system-only and unknown statuses', () => {
    // Resolved/Reopened are derived from fingerprint comparison, never set by hand.
    expect(issueStatusUpdateInputSchema.safeParse({ status: 'Resolved' }).success).toBe(false);
    expect(issueStatusUpdateInputSchema.safeParse({ status: 'Reopened' }).success).toBe(false);
    expect(issueStatusUpdateInputSchema.safeParse({ status: 'Fixed' }).success).toBe(false);
  });
});
