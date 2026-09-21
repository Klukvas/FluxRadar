import { describe, expect, it } from 'vitest';

import type { ConfiguredEgressLocation } from '../integrations/crawl-egress-config.ts';
import { EGRESS_LOCATIONS, egressLocation } from '../integrations/crawl-egress-locations.ts';
import { EgressLocationNotConfiguredError, resolveScanEgress } from './egress.ts';

const KYIV_PROXY = { host: '203.0.113.10', port: 13128, credentials: null } as const;
const FRANKFURT_PROXY = { host: '198.51.100.20', port: 3128, credentials: null } as const;
const OVERRIDE = { host: '198.51.100.7', port: 3128, credentials: null } as const;

const KYIV: ConfiguredEgressLocation = {
  location: EGRESS_LOCATIONS[0]!,
  proxy: KYIV_PROXY,
  expectedIp: '203.0.113.10',
};
const FRANKFURT: ConfiguredEgressLocation = {
  location: egressLocation({
    id: 'de',
    countryCode: 'DE',
    city: 'Frankfurt',
    label: { en: 'Germany, Frankfurt', uk: 'Німеччина, Франкфурт' },
  }),
  proxy: FRANKFURT_PROXY,
  expectedIp: null,
};

describe('resolveScanEgress', () => {
  it('crawls through the location the scan recorded', () => {
    const egress = resolveScanEgress(undefined, 'de', [KYIV, FRANKFURT]);

    expect(egress.proxy).toEqual(FRANKFURT_PROXY);
    expect(egress.location?.location.id).toBe('de');
  });

  it('sends a scan that predates the choice where every such scan went: the default', () => {
    const egress = resolveScanEgress(undefined, undefined, [FRANKFURT, KYIV]);

    expect(egress.location?.location.id).toBe('ua');
    expect(egress.proxy).toEqual(KYIV_PROXY);
  });

  it('crawls directly when nothing is configured', () => {
    expect(resolveScanEgress(undefined, undefined, [])).toEqual({ proxy: null, location: null });
  });

  it('refuses a recorded location that is no longer configured, rather than going elsewhere', () => {
    // Crawling Kyiv, or going direct, would print a country on the report
    // that the crawl never left from.
    expect(() => resolveScanEgress(undefined, 'de', [KYIV])).toThrow(
      EgressLocationNotConfiguredError,
    );
    expect(() => resolveScanEgress(undefined, 'de', [])).toThrow(/"de" is not configured/);
  });

  it('keeps a loopback fixture crawl direct, whatever the environment configures', () => {
    expect(resolveScanEgress({ dangerouslyAllowLoopback: true }, 'ua', [KYIV])).toEqual({
      proxy: null,
      location: null,
    });
  });

  it('lets an explicit override win over the loopback rule', () => {
    expect(
      resolveScanEgress({ dangerouslyAllowLoopback: true, egressProxy: OVERRIDE }, 'ua', [KYIV]),
    ).toEqual({ proxy: OVERRIDE, location: null });
  });

  it('lets an explicit null override the environment', () => {
    expect(resolveScanEgress({ egressProxy: null }, 'ua', [KYIV])).toEqual({
      proxy: null,
      location: null,
    });
  });
});
