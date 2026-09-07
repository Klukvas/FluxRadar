import { describe, expect, it } from 'vitest';

import {
  FREE_CHECK_ALLOWED_ORIGINS_ENV,
  isFreeCheckAllowedOrigin,
  normalizeFreeCheckOrigin,
  readFreeCheckAllowlist,
} from './free-check-allowlist.ts';

const allowlistOf = (value: string): ReadonlySet<string> =>
  readFreeCheckAllowlist({ [FREE_CHECK_ALLOWED_ORIGINS_ENV]: value }).origins;

describe('free-check allowlist parsing', () => {
  it('reads an exact comma-separated list and normalizes every spelling of one origin', () => {
    const allowlist = allowlistOf(
      ' https://Demo.example.com/ , https://second.example.com:443 ,, https://third.example.com ',
    );

    expect([...allowlist].sort()).toEqual([
      'https://demo.example.com',
      'https://second.example.com',
      'https://third.example.com',
    ]);
  });

  it('collapses the same origin written three ways into one entry', () => {
    expect(
      allowlistOf('https://demo.example.com,https://DEMO.example.com/,https://demo.example.com:443')
        .size,
    ).toBe(1);
  });

  it('fails closed when the variable is absent, empty or only separators', () => {
    for (const env of [
      {},
      { [FREE_CHECK_ALLOWED_ORIGINS_ENV]: '' },
      { [FREE_CHECK_ALLOWED_ORIGINS_ENV]: ' , , ' },
    ]) {
      const allowlist = readFreeCheckAllowlist(env);
      expect(allowlist.origins.size).toBe(0);
      expect(allowlist.rejected).toEqual([]);
      expect(isFreeCheckAllowedOrigin('https://demo.example.com', allowlist.origins)).toBe(false);
    }
  });

  it('reports an entry that is not an https origin instead of dropping it quietly', () => {
    const allowlist = readFreeCheckAllowlist({
      [FREE_CHECK_ALLOWED_ORIGINS_ENV]:
        'demo.example.com,http://demo.example.com,https://demo.example.com/pricing,https://ok.example.com',
    });

    // A bare host, an insecure scheme and a path are all refusals: the value
    // compared against is a stored profile domain, which is always an origin.
    expect(allowlist.rejected).toEqual([
      'demo.example.com',
      'http://demo.example.com',
      'https://demo.example.com/pricing',
    ]);
    expect([...allowlist.origins]).toEqual(['https://ok.example.com']);
  });
});

describe('matching a profile domain against the allowlist', () => {
  const allowlist = allowlistOf('https://demo.example.com');

  it('matches the same origin however the stored domain is spelled', () => {
    for (const domain of [
      'https://demo.example.com',
      'https://DEMO.example.com',
      'https://demo.example.com/',
      'https://demo.example.com:443',
      ' https://demo.example.com ',
    ]) {
      expect(isFreeCheckAllowedOrigin(domain, allowlist)).toBe(true);
    }
  });

  it('does not cover a neighbouring origin — no wildcards, no subdomains', () => {
    for (const domain of [
      'https://www.demo.example.com',
      'https://staging.demo.example.com',
      'https://demo.example.com.evil.test',
      'https://example.com',
      'https://demo.example.co',
      'https://demo.example.com:8443',
      'http://demo.example.com',
    ]) {
      expect(isFreeCheckAllowedOrigin(domain, allowlist)).toBe(false);
    }
  });

  it('refuses a domain that is not an origin at all', () => {
    for (const domain of ['', 'demo.example.com', 'not a url']) {
      expect(isFreeCheckAllowedOrigin(domain, allowlist)).toBe(false);
    }
  });
});

describe('normalizeFreeCheckOrigin', () => {
  it('answers the canonical origin, or null when there is none', () => {
    expect(normalizeFreeCheckOrigin(' https://Demo.example.com/ ')).toBe(
      'https://demo.example.com',
    );
    expect(normalizeFreeCheckOrigin('https://demo.example.com:8443')).toBe(
      'https://demo.example.com:8443',
    );
    expect(normalizeFreeCheckOrigin('demo.example.com')).toBeNull();
    expect(normalizeFreeCheckOrigin('https://user:pass@demo.example.com')).toBeNull();
  });
});
