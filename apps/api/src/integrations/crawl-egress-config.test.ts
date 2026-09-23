import { describe, expect, it } from 'vitest';

import { validateRuntimeConfig } from './config.ts';
import {
  defaultEgressLocation,
  readCrawlEgressConfig,
  readCrawlEgressLocations,
} from './crawl-egress-config.ts';
import { EGRESS_LOCATIONS, egressLocation } from './crawl-egress-locations.ts';

const PRODUCTION_BASE = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@postgres:5432/fluxradar',
  INTEGRATION_ENCRYPTION_KEY: 'a'.repeat(64),
  SESSION_SECRET: 'b'.repeat(64),
} as const;

// A registry with a second country, as the next one will be added: one entry,
// variables by convention. Nothing else in the code changes for it.
const GERMANY = egressLocation({
  id: 'de',
  countryCode: 'DE',
  city: 'Frankfurt',
  label: { en: 'Germany, Frankfurt', uk: 'Німеччина, Франкфурт' },
});
const TWO_COUNTRIES = [...EGRESS_LOCATIONS, GERMANY];

describe('crawl egress configuration', () => {
  it('treats an absent value as a direct crawl', () => {
    expect(readCrawlEgressConfig({})).toEqual({ state: 'not_configured' });
    expect(readCrawlEgressLocations({})).toEqual([]);
  });

  it('treats a blank value as a direct crawl', () => {
    expect(readCrawlEgressConfig({ CRAWL_EGRESS_PROXY_URL: '   ' })).toEqual({
      state: 'not_configured',
    });
  });

  it('reads the legacy variable as the Ukrainian location, so current deployments keep working', () => {
    const [ukraine, ...rest] = readCrawlEgressLocations({
      CRAWL_EGRESS_PROXY_URL: 'http://bot:pass@203.0.113.10:13128',
      CRAWL_EGRESS_EXPECTED_IP: '203.0.113.10',
    });

    expect(rest).toEqual([]);
    expect(ukraine?.location.id).toBe('ua');
    expect(ukraine?.location.label).toEqual({ en: 'Ukraine, Kyiv', uk: 'Україна, Київ' });
    expect(ukraine?.proxy).toEqual({
      host: '203.0.113.10',
      port: 13128,
      credentials: { username: 'bot', password: 'pass' },
    });
    expect(ukraine?.expectedIp).toBe('203.0.113.10');
  });

  it('names new locations by convention: CRAWL_EGRESS_PROXY_URL_<CODE>', () => {
    expect(GERMANY.proxyEnvVar).toBe('CRAWL_EGRESS_PROXY_URL_DE');
    expect(GERMANY.expectedIpEnvVar).toBe('CRAWL_EGRESS_EXPECTED_IP_DE');
    expect(
      egressLocation({ id: 'de-fra', countryCode: 'DE', city: 'Frankfurt', label: GERMANY.label })
        .proxyEnvVar,
    ).toBe('CRAWL_EGRESS_PROXY_URL_DE_FRA');
  });

  it('reads a second country from its own variable, in registry order', () => {
    const locations = readCrawlEgressLocations(
      {
        CRAWL_EGRESS_PROXY_URL_DE: 'http://bot:pass@198.51.100.7:3128',
        CRAWL_EGRESS_PROXY_URL: 'http://bot:pass@203.0.113.10:13128',
      },
      TWO_COUNTRIES,
    );

    expect(locations.map((entry) => entry.location.id)).toEqual(['ua', 'de']);
    expect(locations[1]?.proxy.host).toBe('198.51.100.7');
  });

  it('treats a missing location as simply absent, not as a failure', () => {
    const result = readCrawlEgressConfig(
      { CRAWL_EGRESS_PROXY_URL_DE: 'http://bot:pass@198.51.100.7:3128' },
      TWO_COUNTRIES,
    );

    expect(result.state).toBe('configured');
    if (result.state !== 'configured') return;
    expect(result.locations.map((entry) => entry.location.id)).toEqual(['de']);
  });

  it('reports an unusable value by variable name, without the value', () => {
    const result = readCrawlEgressConfig({ CRAWL_EGRESS_PROXY_URL: 'http://bot:hunter2@proxy' });

    expect(result.state).toBe('invalid');
    if (result.state !== 'invalid') return;
    expect(result.missing).toEqual(['CRAWL_EGRESS_PROXY_URL']);
    expect(result.reason).not.toContain('hunter2');
  });

  it('names the second country when its value is the unusable one', () => {
    const result = readCrawlEgressConfig(
      {
        CRAWL_EGRESS_PROXY_URL: 'http://bot:pass@203.0.113.10:13128',
        CRAWL_EGRESS_PROXY_URL_DE: 'http://bot:hunter2@proxy',
      },
      TWO_COUNTRIES,
    );

    expect(result.state).toBe('invalid');
    if (result.state !== 'invalid') return;
    expect(result.missing).toEqual(['CRAWL_EGRESS_PROXY_URL_DE']);
    expect(result.reason).not.toContain('hunter2');
  });

  it('refuses a proxy variable for a country nobody registered', () => {
    // The operator meant a country to appear; without this it silently would not.
    const result = readCrawlEgressConfig({
      CRAWL_EGRESS_PROXY_URL_PL: 'http://bot:secret@192.0.2.5:3128',
    });

    expect(result.state).toBe('invalid');
    if (result.state !== 'invalid') return;
    expect(result.missing).toEqual(['CRAWL_EGRESS_PROXY_URL_PL']);
    expect(result.reason).not.toContain('secret');
  });

  it('refuses an expected address that is not an address', () => {
    const result = readCrawlEgressConfig({
      CRAWL_EGRESS_PROXY_URL: 'http://bot:pass@203.0.113.10:13128',
      CRAWL_EGRESS_EXPECTED_IP: '203.0.113',
    });

    expect(result.state).toBe('invalid');
    if (result.state !== 'invalid') return;
    expect(result.missing).toEqual(['CRAWL_EGRESS_EXPECTED_IP']);
  });

  it('defaults to Ukraine, and to the first configured country without it', () => {
    const both = readCrawlEgressLocations(
      {
        CRAWL_EGRESS_PROXY_URL: 'http://bot:pass@203.0.113.10:13128',
        CRAWL_EGRESS_PROXY_URL_DE: 'http://bot:pass@198.51.100.7:3128',
      },
      TWO_COUNTRIES,
    );
    const germanyOnly = readCrawlEgressLocations(
      { CRAWL_EGRESS_PROXY_URL_DE: 'http://bot:pass@198.51.100.7:3128' },
      TWO_COUNTRIES,
    );

    expect(defaultEgressLocation(both)?.location.id).toBe('ua');
    expect(defaultEgressLocation(germanyOnly)?.location.id).toBe('de');
    expect(defaultEgressLocation([])).toBeNull();
  });

  it('refuses to boot production on an unusable value rather than crawling directly', () => {
    expect(() =>
      validateRuntimeConfig({ ...PRODUCTION_BASE, CRAWL_EGRESS_PROXY_URL: 'http://proxy' }),
    ).toThrow(/CRAWL_EGRESS_PROXY_URL/);
    expect(() =>
      validateRuntimeConfig({
        ...PRODUCTION_BASE,
        CRAWL_EGRESS_PROXY_URL_XX: 'http://bot:pass@192.0.2.5:3128',
      }),
    ).toThrow(/CRAWL_EGRESS_PROXY_URL_XX/);
  });

  it('boots production without the variable at all', () => {
    expect(() => validateRuntimeConfig({ ...PRODUCTION_BASE })).not.toThrow();
  });
});
