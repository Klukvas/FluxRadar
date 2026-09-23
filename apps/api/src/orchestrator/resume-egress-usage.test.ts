import { RULESET_VERSION, scanScopeSchema } from '@fluxradar/contracts';
import type { SafeFetchResult } from '@fluxradar/safe-fetch';
import type { Scan } from '@prisma/client';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import { silentLogger } from '../http/logger.ts';
import type { ConfiguredEgressLocation } from '../integrations/crawl-egress-config.ts';
import type { EgressHealth } from '../integrations/crawl-egress-health.ts';
import { EGRESS_LOCATIONS } from '../integrations/crawl-egress-locations.ts';
import { usageMonthOf } from '../integrations/crawl-egress-usage.ts';
import {
  createTestDb,
  seedAccountWithProfile,
  type SeededAccount,
  type TestDb,
} from '../test-utils/test-db.ts';
import type { ScanCheckpointState } from './checkpoint.ts';
import type { WorkerDeps } from './deps.ts';
import { createDefaultAiProvider } from './geo.ts';
import { CRAWL_STAGE, runScanAttempt, type ScanAttemptControl } from './run-attempt.ts';

// How much traffic a paused and resumed scan is counted for.
//
// The crawler hands the pages of a previous attempt back inside the resumed
// attempt's own result, so counting that result's total booked the whole site
// against the VPS's monthly allowance a second time — and a third, for a scan
// paused twice. What crossed the proxy is counted once, and what the resume
// really did read is counted too.

const NOW = new Date('2026-09-23T10:00:00.000Z');

const KYIV: ConfiguredEgressLocation = {
  location: EGRESS_LOCATIONS[0]!,
  proxy: { host: '203.0.113.10', port: 13128, credentials: null },
  expectedIp: '203.0.113.10',
};

const HEALTHY: EgressHealth = {
  state: 'healthy',
  observedIp: '203.0.113.10',
  expectedIp: '203.0.113.10',
  latencyMs: 8,
  detail: null,
  checkedAt: NOW,
};

const HOME =
  '<html><head><title>Home</title></head><body><a href="/pricing">Plans</a></body></html>';
const PRICING = '<html><head><title>Plans</title></head><body><p>Two of them.</p></body></html>';
const HOME_BYTES = Buffer.byteLength(HOME, 'utf8');
const PRICING_BYTES = Buffer.byteLength(PRICING, 'utf8');

let db: TestDb;
let account: SeededAccount;

beforeEach(async () => {
  db = await createTestDb();
  account = await seedAccountWithProfile(db.prisma);
});

afterEach(async () => {
  await db.cleanup();
});

/** A two-page site behind a stub transport: no robots.txt and no sitemap. */
function respond(url: string): SafeFetchResult {
  const { pathname } = new URL(url);
  if (pathname === '/robots.txt' || pathname.endsWith('.xml')) {
    return {
      finalUrl: url,
      status: 404,
      headers: {},
      body: '',
      redirectChain: [],
      timingMs: 2,
      truncated: false,
    };
  }
  return {
    finalUrl: url,
    status: 200,
    headers: { 'content-type': 'text/html' },
    body: pathname === '/pricing' ? PRICING : HOME,
    redirectChain: [],
    timingMs: 3,
    truncated: false,
  };
}

function deps(onPageRead: () => void = (): void => {}): WorkerDeps {
  return {
    prisma: db.prisma,
    logger: silentLogger,
    now: () => NOW,
    createAiProvider: (scan, profile) =>
      createDefaultAiProvider(profile.name, new URL(scan.domain).hostname),
    createPerformanceRunner: () => undefined,
    egressLocations: [KYIV],
    probeEgress: () => Promise.resolve(HEALTHY),
    crawl: {
      fetcher: (url) => {
        const response = respond(url);
        if (response.status === 200) onPageRead();
        return Promise.resolve(response);
      },
    },
  };
}

/** A paid scan that records Kyiv as the place it is crawled from (D-228). */
async function seedScanFrom(maxPages: number): Promise<Scan> {
  const scope = scanScopeSchema.parse({
    includeSubdomains: false,
    maxPages,
    maxDepth: 1,
    egressLocation: KYIV.location.id,
  });
  return db.prisma.scan.create({
    data: {
      accountId: account.accountId,
      siteProfileId: account.siteProfileId,
      plan: 'Basic',
      domain: account.domain,
      status: 'Running',
      scopeJson: JSON.stringify(scope),
      rulesetVersion: RULESET_VERSION,
    },
  });
}

interface StoppingControl {
  readonly control: ScanAttemptControl;
  /** The last checkpoint the attempt wrote — what the next one resumes from. */
  lastSaved(): ScanCheckpointState | null;
}

/**
 * A control that pauses the attempt at its first module boundary.
 *
 * It flips the moment the crawl phase checkpoints, which is the case the double
 * count lived in: the crawl finished and its bytes were counted, and then the
 * pause arrived. Driven by the checkpoint rather than by a timer, so the test
 * says where the pause landed instead of hoping.
 */
function pauseAfterCrawl(resumeFrom: ScanCheckpointState | null): StoppingControl {
  let stop = false;
  let saved: ScanCheckpointState | null = null;
  return {
    control: {
      resumeFrom,
      isStopRequested: () => stop,
      save: (state) => {
        saved = state;
        if (state.stage === CRAWL_STAGE) stop = true;
        return Promise.resolve();
      },
    },
    lastSaved: () => saved,
  };
}

/** A control that pauses mid-crawl: `stop` is flipped by the page the test reads. */
function pauseDuringCrawl(): StoppingControl & { onPageRead: () => void } {
  let stop = false;
  let saved: ScanCheckpointState | null = null;
  return {
    control: {
      resumeFrom: null,
      isStopRequested: () => stop,
      save: (state) => {
        saved = state;
        return Promise.resolve();
      },
    },
    lastSaved: () => saved,
    onPageRead: () => {
      stop = true;
    },
  };
}

async function countedBytes(): Promise<number> {
  const rows = await db.prisma.crawlEgressLocationUsage.findMany();
  expect(rows.map((row) => `${row.location}/${row.month}`)).toEqual([
    `${KYIV.location.id}/${usageMonthOf(NOW)}`,
  ]);
  return Number(rows[0]?.bytes ?? 0);
}

describe('the traffic a resumed scan is counted for', () => {
  it('counts every page a fresh attempt read', async () => {
    const scan = await seedScanFrom(2);

    await runScanAttempt(deps(), scan.id, { control: pauseAfterCrawl(null).control });

    await expect(countedBytes()).resolves.toBe(HOME_BYTES + PRICING_BYTES);
  });

  // The regression: the resumed attempt's result still contains both pages, and
  // counting its total again doubled the scan's traffic.
  it('does not count the pages again when the pause came after the crawl', async () => {
    const scan = await seedScanFrom(2);
    const first = pauseAfterCrawl(null);

    const paused = await runScanAttempt(deps(), scan.id, { control: first.control });

    expect(paused.stopped).toBe(true);
    await expect(countedBytes()).resolves.toBe(HOME_BYTES + PRICING_BYTES);

    const checkpoint = first.lastSaved();
    expect(checkpoint?.crawl.egressRecorded).toBe(true);
    await runScanAttempt(deps(), scan.id, { control: pauseAfterCrawl(checkpoint).control });

    await expect(countedBytes()).resolves.toBe(HOME_BYTES + PRICING_BYTES);
  });

  // The other half of the same sum: a pause mid-crawl leaves pages nobody
  // counted yet, and the resume must count what it reads on top of them.
  it('counts what the resume read itself when the pause came mid-crawl', async () => {
    const scan = await seedScanFrom(2);
    const first = pauseDuringCrawl();

    const paused = await runScanAttempt(deps(first.onPageRead), scan.id, {
      control: first.control,
    });

    expect(paused.stopped).toBe(true);
    // The homepage crossed the proxy before the pause, and is on the bill for
    // it whether or not the attempt went on to run a module.
    await expect(countedBytes()).resolves.toBe(HOME_BYTES);

    await runScanAttempt(deps(), scan.id, {
      control: pauseAfterCrawl(first.lastSaved()).control,
    });

    await expect(countedBytes()).resolves.toBe(HOME_BYTES + PRICING_BYTES);
  });
});
