import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { silentLogger } from '../http/logger.ts';
import { createApp } from '../index.ts';
import type { ConfiguredEgressLocation } from '../integrations/crawl-egress-config.ts';
import type { EgressHealth } from '../integrations/crawl-egress-health.ts';
import { EGRESS_LOCATIONS, egressLocation } from '../integrations/crawl-egress-locations.ts';
import { createEgressLocationMonitor } from '../integrations/crawl-egress-monitor.ts';
import { usageMonthOf } from '../integrations/crawl-egress-usage.ts';
import { createTestDb, type TestDb } from '../test-utils/test-db.ts';
import type { WorkerDeps } from './deps.ts';
import { createDefaultAiProvider } from './geo.ts';
import { processScan } from './worker.ts';

// A scan leaves from the location recorded at its launch (D-228) — through
// that location's proxy, checked before the first request, and counted
// against that location's traffic plan. A second country is one registry entry
// and one variable: nothing in this file's subject was edited to support it.

const OWNER = 'owner@example.com';
const NOW = new Date('2026-09-21T12:00:00.000Z');

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

function health(state: EgressHealth['state']): EgressHealth {
  return {
    state,
    observedIp: null,
    expectedIp: null,
    latencyMs: 10,
    detail: state === 'healthy' ? null : 'ECONNREFUSED',
    checkedAt: NOW,
  };
}

const PAGE = '<html><head><title>Fine</title></head><body><h1>Fine</h1></body></html>';

describe('a scan crawls from the location it recorded', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  async function launchFrom(location: string): Promise<string> {
    const app = createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
      internalFreeEmails: new Set([OWNER]),
      egress: createEgressLocationMonitor({
        locations: [KYIV, FRANKFURT],
        logger: silentLogger,
        probe: async () => health('healthy'),
      }),
    });
    const agent = request.agent(app);
    await agent.post('/auth/register').send({ email: OWNER, password: 'correct-horse-1' });
    const profile = await agent
      .post('/profiles')
      .send({ name: 'Example', domain: 'https://example.com' });
    const launched = await agent.post('/billing/dev-checkout').send({
      siteProfileId: profile.body.data.id as string,
      plan: 'Basic',
      scope: { includeSubdomains: false, maxPages: 1, egressLocation: location },
    });
    expect(launched.status).toBe(201);
    return launched.body.data.scanId as string;
  }

  function worker(
    probed: { proxyHost: string | undefined; expectedIp: string | null | undefined }[],
    frankfurtUp: boolean,
    fetched: { count: number },
  ): WorkerDeps {
    return {
      prisma: db.prisma,
      logger: silentLogger,
      now: () => NOW,
      createAiProvider: (scan, profile) =>
        createDefaultAiProvider(profile.name, new URL(scan.domain).hostname),
      createPerformanceRunner: () => undefined,
      egressLocations: [KYIV, FRANKFURT],
      crawl: {
        fetcher: async (url) => {
          fetched.count += 1;
          return {
            finalUrl: url,
            status: url.endsWith('/robots.txt') || url.endsWith('.xml') ? 404 : 200,
            headers: { 'content-type': 'text/html' },
            body: PAGE,
            redirectChain: [],
            timingMs: 3,
            truncated: false,
          };
        },
      },
      probeEgress: async (proxy, options) => {
        probed.push({ proxyHost: proxy?.host, expectedIp: options.expectedIp });
        return health(
          proxy?.host === FRANKFURT.proxy.host && !frankfurtUp ? 'unreachable' : 'healthy',
        );
      },
    };
  }

  it('checks and counts the chosen location, not the default one', async () => {
    const scanId = await launchFrom('de');
    const probed: { proxyHost: string | undefined; expectedIp: string | null | undefined }[] = [];

    await processScan(worker(probed, true, { count: 0 }), scanId);

    expect(probed).toEqual([{ proxyHost: '198.51.100.20', expectedIp: '198.51.100.20' }]);
    const usage = await db.prisma.crawlEgressLocationUsage.findMany();
    expect(usage.map((row) => row.location)).toEqual(['de']);
    expect(usage[0]?.month).toBe(usageMonthOf(NOW));
    expect(Number(usage[0]?.bytes)).toBeGreaterThan(0);
  });

  it('fails as a platform failure when the chosen location is down, without going elsewhere', async () => {
    const scanId = await launchFrom('de');
    const probed: { proxyHost: string | undefined; expectedIp: string | null | undefined }[] = [];
    const fetched = { count: 0 };

    const result = await processScan(worker(probed, false, fetched), scanId);

    expect(result.outcome).toBe('Failed');
    // Not one request: not direct, and not through Kyiv either — that would be
    // a report from a country nobody chose.
    expect(fetched.count).toBe(0);
    expect(probed.every((entry) => entry.proxyHost === '198.51.100.20')).toBe(true);
    const scan = await db.prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
    expect(scan.crawlSummaryJson).toBeNull();
    expect(scan.statusReason).not.toBe('SiteUnreachable');
    expect(scan.platformRetryCount).toBe(1);
  });
});
