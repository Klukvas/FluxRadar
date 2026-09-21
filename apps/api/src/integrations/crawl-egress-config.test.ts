import { describe, expect, it } from 'vitest';

import { validateRuntimeConfig } from './config.ts';
import { readCrawlEgressConfig, readCrawlEgressProxy } from './crawl-egress-config.ts';

const PRODUCTION_BASE = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@postgres:5432/fluxradar',
  INTEGRATION_ENCRYPTION_KEY: 'a'.repeat(64),
  SESSION_SECRET: 'b'.repeat(64),
} as const;

describe('crawl egress configuration', () => {
  it('treats an absent value as a direct crawl', () => {
    expect(readCrawlEgressConfig({})).toEqual({ state: 'not_configured' });
    expect(readCrawlEgressProxy({})).toBeNull();
  });

  it('treats a blank value as a direct crawl', () => {
    expect(readCrawlEgressConfig({ CRAWL_EGRESS_PROXY_URL: '   ' })).toEqual({
      state: 'not_configured',
    });
  });

  it('reads a usable proxy', () => {
    expect(
      readCrawlEgressProxy({ CRAWL_EGRESS_PROXY_URL: 'http://bot:pass@203.0.113.10:13128' }),
    ).toEqual({
      host: '203.0.113.10',
      port: 13128,
      credentials: { username: 'bot', password: 'pass' },
    });
  });

  it('reports an unusable value by variable name, without the value', () => {
    const result = readCrawlEgressConfig({ CRAWL_EGRESS_PROXY_URL: 'http://bot:hunter2@proxy' });

    expect(result.state).toBe('invalid');
    if (result.state !== 'invalid') return;
    expect(result.missing).toEqual(['CRAWL_EGRESS_PROXY_URL']);
    expect(result.reason).not.toContain('hunter2');
  });

  it('refuses to boot production on an unusable value rather than crawling directly', () => {
    expect(() =>
      validateRuntimeConfig({ ...PRODUCTION_BASE, CRAWL_EGRESS_PROXY_URL: 'http://proxy' }),
    ).toThrow(/CRAWL_EGRESS_PROXY_URL/);
  });

  it('boots production without the variable at all', () => {
    expect(() => validateRuntimeConfig({ ...PRODUCTION_BASE })).not.toThrow();
  });
});
