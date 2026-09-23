import { scanScopeSchema } from '@fluxradar/contracts';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { silentLogger } from '../http/logger.ts';
import { createApp } from '../index.ts';
import type { ConfiguredEgressLocation } from '../integrations/crawl-egress-config.ts';
import type { EgressHealth } from '../integrations/crawl-egress-health.ts';
import { EGRESS_LOCATIONS, egressLocation } from '../integrations/crawl-egress-locations.ts';
import { createEgressLocationMonitor } from '../integrations/crawl-egress-monitor.ts';
import { createTestDb, type TestDb } from '../test-utils/test-db.ts';
import {
  resolveLaunchEgressLocation,
  scopeWithEgressLocation,
  type LaunchEgress,
} from './launch-egress.ts';

// The owner chooses the country a check leaves from (D-228). The server checks
// the choice rather than trusting it: a location that does not exist here, or
// whose proxy is not answering, refuses the launch — before a scan, a checkout
// or the one free check is spent on it.

const OWNER = 'owner@example.com';

const KYIV: ConfiguredEgressLocation = {
  location: EGRESS_LOCATIONS[0]!,
  proxy: { host: '203.0.113.10', port: 13128, credentials: null },
  expectedIp: null,
};
const FRANKFURT: ConfiguredEgressLocation = {
  location: egressLocation({
    id: 'de',
    countryCode: 'DE',
    city: 'Frankfurt',
    label: { en: 'Germany, Frankfurt', uk: 'Німеччина, Франкфурт' },
  }),
  proxy: { host: '198.51.100.20', port: 3128, credentials: null },
  expectedIp: null,
};

function health(state: EgressHealth['state']): EgressHealth {
  return {
    state,
    observedIp: null,
    expectedIp: null,
    latencyMs: state === 'healthy' ? 12 : null,
    detail: state === 'healthy' ? null : 'ECONNREFUSED',
    checkedAt: new Date(),
  };
}

describe('launching a scan from a chosen egress location', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  /** An app whose locations answer as `up` says; everything else is down. */
  async function signedIn(locations: readonly ConfiguredEgressLocation[], up: readonly string[]) {
    const egress = createEgressLocationMonitor({
      locations,
      logger: silentLogger,
      probe: async (proxy) =>
        health(
          locations.some(
            (entry) => entry.proxy.host === proxy?.host && up.includes(entry.location.id),
          )
            ? 'healthy'
            : 'unreachable',
        ),
    });
    const app = createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
      internalFreeEmails: new Set([OWNER]),
      egress,
    });
    const agent = request.agent(app);
    await agent.post('/auth/register').send({ email: OWNER, password: 'correct-horse-1' });
    const profile = await agent
      .post('/profiles')
      .send({ name: 'Example', domain: 'https://example.com' });
    return { agent, profileId: profile.body.data.id as string };
  }

  function internalCheckout(
    agent: ReturnType<typeof request.agent>,
    profileId: string,
    scope: Record<string, unknown>,
  ) {
    return agent.post('/billing/internal-checkout').send({
      siteProfileId: profileId,
      plan: 'Complete',
      scope: { includeSubdomains: false, ...scope },
    });
  }

  it('offers only the locations that are configured and answering', async () => {
    const { agent } = await signedIn([KYIV, FRANKFURT], ['ua']);

    const config = await agent.get('/scans/launch-config');

    expect(config.status).toBe(200);
    expect(config.body.data.egress).toEqual({
      mode: 'proxy',
      locations: [
        {
          id: 'ua',
          countryCode: 'UA',
          city: 'Kyiv',
          label: { en: 'Ukraine, Kyiv', uk: 'Україна, Київ' },
        },
      ],
      defaultLocationId: 'ua',
    });
  });

  it('says a deployment without any proxy crawls directly, with nothing to choose', async () => {
    const { agent } = await signedIn([], []);

    const config = await agent.get('/scans/launch-config');

    expect(config.body.data.egress).toEqual({
      mode: 'direct',
      locations: [],
      defaultLocationId: null,
    });
  });

  it('records the chosen location in the scan and shows it in the report', async () => {
    const { agent, profileId } = await signedIn([KYIV, FRANKFURT], ['ua', 'de']);

    const launched = await internalCheckout(agent, profileId, { egressLocation: 'de' });

    expect(launched.status).toBe(201);
    const scan = await agent.get(`/scans/${launched.body.data.scanId as string}`);
    expect(scan.body.data.executionConfig.scope.egressLocation).toBe('de');
    // 'de' exists only in this test's configuration, not in the shipped
    // registry, so the report has no label for it — and still names it by its
    // code rather than calling a recorded location "not recorded".
    expect(scan.body.data.egressLocation).toEqual({
      id: 'de',
      countryCode: null,
      city: null,
      label: null,
    });
  });

  it('records the default location for a launch that names none', async () => {
    const { agent, profileId } = await signedIn([KYIV], ['ua']);

    const launched = await internalCheckout(agent, profileId, {});

    expect(launched.status).toBe(201);
    const scan = await agent.get(`/scans/${launched.body.data.scanId as string}`);
    expect(scan.body.data.executionConfig.scope.egressLocation).toBe('ua');
    expect(scan.body.data.egressLocation.label.uk).toBe('Україна, Київ');
  });

  it('refuses a location this deployment does not have, and creates nothing', async () => {
    const { agent, profileId } = await signedIn([KYIV], ['ua']);

    const launched = await internalCheckout(agent, profileId, { egressLocation: 'de' });

    expect(launched.status).toBe(400);
    expect(launched.body.error.code).toBe('EGRESS_LOCATION_UNKNOWN');
    expect(await db.prisma.scan.count()).toBe(0);
  });

  it('refuses a location whose proxy is not answering, instead of going elsewhere', async () => {
    const { agent, profileId } = await signedIn([KYIV, FRANKFURT], ['ua']);

    const launched = await internalCheckout(agent, profileId, { egressLocation: 'de' });

    expect(launched.status).toBe(503);
    expect(launched.body.error.code).toBe('EGRESS_LOCATION_UNAVAILABLE');
    expect(launched.body.error.message).toContain('Germany, Frankfurt');
    expect(await db.prisma.scan.count()).toBe(0);
  });

  it('refuses a location on a deployment that crawls directly', async () => {
    const { agent, profileId } = await signedIn([], []);

    const launched = await internalCheckout(agent, profileId, { egressLocation: 'ua' });

    expect(launched.status).toBe(400);
    expect(launched.body.error.code).toBe('EGRESS_LOCATION_UNKNOWN');
  });

  it('runs a Free check from the default location, whatever the request names', async () => {
    const { agent, profileId } = await signedIn([KYIV, FRANKFURT], ['ua', 'de']);

    const free = await agent
      .post(`/profiles/${profileId}/free-check`)
      .send({ scope: { includeSubdomains: false, egressLocation: 'de' } });

    expect(free.status).toBe(201);
    expect(free.body.data.executionConfig.scope.egressLocation).toBe('ua');
    expect(free.body.data.egressLocation.id).toBe('ua');
  });

  it('does not spend the one free check while the default location is down', async () => {
    const { agent, profileId } = await signedIn([KYIV], []);

    const free = await agent.post(`/profiles/${profileId}/free-check`).send({});

    expect(free.status).toBe(503);
    expect(free.body.error.code).toBe('EGRESS_LOCATION_UNAVAILABLE');
    const account = await db.prisma.account.findUniqueOrThrow({ where: { email: OWNER } });
    expect(account.freeCheckUsedAt).toBeNull();
    expect(await db.prisma.scan.count()).toBe(0);
  });

  it('runs a Free check directly, recording no location, where no proxy exists', async () => {
    const { agent, profileId } = await signedIn([], []);

    const free = await agent.post(`/profiles/${profileId}/free-check`).send({});

    expect(free.status).toBe(201);
    expect(free.body.data.executionConfig.scope.egressLocation).toBeUndefined();
    expect(free.body.data.egressLocation).toBeNull();
  });

  it('does not pretend a scan from before the choice was Ukrainian', async () => {
    const { agent, profileId } = await signedIn([KYIV], ['ua']);
    const launched = await internalCheckout(agent, profileId, {});
    const scanId = launched.body.data.scanId as string;
    // Rewrite it into the shape every scan had before D-228: no location field.
    const row = await db.prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
    const config = JSON.parse(row.executionConfigJson ?? '{}') as {
      scope: Record<string, unknown>;
    };
    const { egressLocation: recorded, ...legacyScope } = config.scope;
    await db.prisma.scan.update({
      where: { id: scanId },
      data: {
        executionConfigJson: JSON.stringify({ ...config, scope: legacyScope }),
        scopeJson: JSON.stringify(legacyScope),
      },
    });

    const scan = await agent.get(`/scans/${scanId}`);

    expect(recorded).toBe('ua');
    expect(scan.body.data.egressLocation).toBeNull();
  });
});

describe('the location a stored scope may name', () => {
  const SCOPE = scanScopeSchema.parse({ includeSubdomains: false, egressLocation: 'de' });

  function monitorOf(locations: readonly ConfiguredEgressLocation[]) {
    return createEgressLocationMonitor({
      locations,
      logger: silentLogger,
      probe: async () => health('healthy'),
    });
  }

  it('is the one checked at launch, whatever the request carried', async () => {
    const egress = await resolveLaunchEgressLocation(monitorOf([KYIV, FRANKFURT]), undefined);

    // The request said Frankfurt, the check (the default) said Kyiv: Kyiv is stored.
    expect(scopeWithEgressLocation({ ...SCOPE }, egress).egressLocation).toBe('ua');
  });

  it('is none at all on a deployment that crawls directly', async () => {
    const egress = await resolveLaunchEgressLocation(monitorOf([]), undefined);
    const stored = JSON.parse(JSON.stringify(scopeWithEgressLocation({ ...SCOPE }, egress)));

    expect(stored).not.toHaveProperty('egressLocation');
  });

  it('cannot come from a location nobody checked', () => {
    // The functions that create a scan or a checkout session take a
    // `LaunchEgress`, and only `resolveLaunchEgressLocation` makes one. If this
    // line ever compiles, that guarantee is gone and tsc fails on the unused
    // directive.
    // @ts-expect-error — a bare location is not a checked one
    const forged: LaunchEgress = { location: KYIV };

    expect(forged.location).toBe(KYIV);
  });
});
