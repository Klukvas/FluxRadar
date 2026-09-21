import { egressLocationIdSchema } from '@fluxradar/contracts';
import { describe, expect, it } from 'vitest';

import {
  EGRESS_LOCATIONS,
  egressLocation,
  egressLocationView,
  findEgressLocation,
} from './crawl-egress-locations.ts';

// The registry is edited by hand, one entry per country, and its ids are
// written into every scan that uses them. A copy-pasted entry that repeats an
// id or a variable would not fail anywhere else: lookups take the first match,
// and the second country would silently never exist.

describe('the egress location registry', () => {
  it('gives every location its own id', () => {
    const ids = EGRESS_LOCATIONS.map((location) => location.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every location its own variables', () => {
    const variables = EGRESS_LOCATIONS.flatMap((location) => [
      location.proxyEnvVar,
      location.expectedIpEnvVar,
    ]);

    expect(new Set(variables).size).toBe(variables.length);
  });

  it('uses ids a scan scope accepts, and labels in both languages', () => {
    for (const location of EGRESS_LOCATIONS) {
      expect(egressLocationIdSchema.safeParse(location.id).success).toBe(true);
      expect(location.countryCode).toMatch(/^[A-Z]{2}$/);
      expect(location.label.en.trim()).not.toBe('');
      expect(location.label.uk.trim()).not.toBe('');
      expect(location.monthlyTrafficBytes).toBeGreaterThan(0);
    }
  });

  it('keeps Ukraine on the variable names it had before there was a choice', () => {
    const ukraine = findEgressLocation('ua');

    expect(ukraine?.proxyEnvVar).toBe('CRAWL_EGRESS_PROXY_URL');
    expect(ukraine?.expectedIpEnvVar).toBe('CRAWL_EGRESS_EXPECTED_IP');
  });

  it('refuses an entry whose id a scan scope would not accept', () => {
    expect(() =>
      egressLocation({
        id: 'Germany',
        countryCode: 'DE',
        city: 'Frankfurt',
        label: { en: 'Germany, Frankfurt', uk: 'Німеччина, Франкфурт' },
      }),
    ).toThrow();
  });

  it('describes an unknown recorded id by itself, and an unrecorded one as nothing', () => {
    expect(egressLocationView('pl')).toEqual({
      id: 'pl',
      countryCode: null,
      city: null,
      label: null,
    });
    expect(egressLocationView(undefined)).toBeNull();
  });
});
