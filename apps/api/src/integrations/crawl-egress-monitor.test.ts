import { describe, expect, it, vi } from 'vitest';

import { silentLogger } from '../http/logger.ts';
import type { ConfiguredEgressLocation } from './crawl-egress-config.ts';
import type { EgressHealth } from './crawl-egress-health.ts';
import { EGRESS_LOCATIONS, egressLocation } from './crawl-egress-locations.ts';
import { createEgressLocationMonitor, EGRESS_HEALTH_MAX_AGE_MS } from './crawl-egress-monitor.ts';

// D-225 watched one proxy. With a choice of countries (D-228) the same checks
// run per location, and a location that is down stops being offered.

const KYIV: ConfiguredEgressLocation = {
  location: EGRESS_LOCATIONS[0]!,
  proxy: { host: '203.0.113.10', port: 13128, credentials: null },
  expectedIp: '203.0.113.10',
};
const FRANKFURT: ConfiguredEgressLocation = {
  location: egressLocation({
    id: 'de',
    countryCode: 'DE',
    city: 'Frankfurt',
    label: { en: 'Germany, Frankfurt', uk: 'Німеччина, Франкфурт' },
  }),
  proxy: { host: '198.51.100.20', port: 3128, credentials: null },
  expectedIp: '198.51.100.20',
};

const T0 = new Date('2026-09-21T10:00:00.000Z');

function health(state: EgressHealth['state'], checkedAt: Date = T0): EgressHealth {
  return { state, observedIp: null, expectedIp: null, latencyMs: 10, detail: null, checkedAt };
}

describe('createEgressLocationMonitor', () => {
  it('offers only the locations whose proxy answers', async () => {
    const monitor = createEgressLocationMonitor({
      locations: [KYIV, FRANKFURT],
      logger: silentLogger,
      now: () => T0,
      probe: async (proxy) => health(proxy?.host === KYIV.proxy.host ? 'healthy' : 'unreachable'),
    });

    const available = await monitor.available();

    expect(available.map((entry) => entry.location.id)).toEqual(['ua']);
  });

  it('checks each location through its own proxy, against its own address', async () => {
    const probe = vi.fn(async () => health('healthy'));
    const monitor = createEgressLocationMonitor({
      locations: [KYIV, FRANKFURT],
      logger: silentLogger,
      now: () => T0,
      probe,
      probeOptions: { probeUrl: 'https://probe.test/trace' },
    });

    const statuses = await monitor.checkAll();

    expect(statuses.map((status) => status.configured.location.id)).toEqual(['ua', 'de']);
    expect(probe).toHaveBeenCalledWith(KYIV.proxy, {
      probeUrl: 'https://probe.test/trace',
      expectedIp: '203.0.113.10',
    });
    expect(probe).toHaveBeenCalledWith(FRANKFURT.proxy, {
      probeUrl: 'https://probe.test/trace',
      expectedIp: '198.51.100.20',
    });
  });

  it('answers from the last check while it is fresh, and asks again once it is not', async () => {
    let clock = T0;
    const probe = vi.fn(async () => health('healthy', clock));
    const monitor = createEgressLocationMonitor({
      locations: [KYIV],
      logger: silentLogger,
      now: () => clock,
      probe,
    });

    await monitor.checkAll();
    clock = new Date(T0.getTime() + EGRESS_HEALTH_MAX_AGE_MS - 1);
    await monitor.healthOf(KYIV);
    expect(probe).toHaveBeenCalledTimes(1);

    clock = new Date(T0.getTime() + EGRESS_HEALTH_MAX_AGE_MS + 1);
    await monitor.healthOf(KYIV);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('asks on demand before the first timed check has answered, instead of offering nothing', async () => {
    const probe = vi.fn(async () => health('healthy'));
    const monitor = createEgressLocationMonitor({
      locations: [KYIV],
      logger: silentLogger,
      now: () => T0,
      probe,
    });

    expect((await monitor.available()).map((entry) => entry.location.id)).toEqual(['ua']);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('sends one probe per location when a launch arrives during a check', async () => {
    let release: (value: EgressHealth) => void = () => undefined;
    const probe = vi.fn(
      () =>
        new Promise<EgressHealth>((resolve) => {
          release = resolve;
        }),
    );
    const monitor = createEgressLocationMonitor({
      locations: [KYIV],
      logger: silentLogger,
      now: () => T0,
      probe,
    });

    const timed = monitor.checkAll();
    const launch = monitor.healthOf(KYIV);
    release(health('healthy'));
    await Promise.all([timed, launch]);

    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('logs an outage as an error naming the location', async () => {
    const error = vi.fn();
    const monitor = createEgressLocationMonitor({
      locations: [FRANKFURT],
      logger: { ...silentLogger, error },
      now: () => T0,
      probe: async () => health('unreachable'),
    });

    await monitor.checkAll();

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('unreachable'),
      expect.objectContaining({ location: 'de', state: 'unreachable' }),
    );
  });

  it('defaults to Ukraine, and has no default for a deployment that crawls directly', () => {
    const both = createEgressLocationMonitor({
      locations: [FRANKFURT, KYIV],
      logger: silentLogger,
    });
    const direct = createEgressLocationMonitor({ locations: [], logger: silentLogger });

    expect(both.defaultLocation?.location.id).toBe('ua');
    expect(both.find('de')?.location.id).toBe('de');
    expect(both.find('pl')).toBeNull();
    expect(direct.defaultLocation).toBeNull();
  });
});
