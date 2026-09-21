import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../index.ts';
import { silentLogger } from '../http/logger.ts';
import type { PerformanceSnapshot } from '../integrations/performance.ts';
import { createTestDb, TEST_WEBHOOK_SECRET, type TestDb } from '../test-utils/test-db.ts';
import { createDefaultAiProvider } from './geo.ts';
import { processScan } from './worker.ts';

// A paid scan of a site that answers 403 to every request.
//
// This is the 2026-09-21 ukrdentclub.ua report. Cloudflare refused our whole
// network, so every request — homepage, robots.txt, sitemap — came back as a
// challenge page. Nothing about that is a broken connection, so the scan read
// the 403 as "the site is up", ran every rule against the challenge markup, put
// the rules that need a real page into NotApplicable (which leaves the coverage
// denominator, so the modules reported 100%), scored the site 96.95 on zero
// pages read, and — because Google PSI measures a blocked site perfectly well —
// resolved to Partial. Partial means no automatic refund. The customer paid
// $120 for an audit of a site we never saw, and was told it went fine.
//
// Every assertion below is one of the claims that report made.

/** The challenge Cloudflare serves in front of a site that has blocked us. */
const CHALLENGE_BODY =
  '<html><head><title>Attention Required! | Cloudflare</title></head>' +
  '<body><h1>Sorry, you have been blocked</h1><p>You are unable to access this site.</p></body></html>';

function challengeFetcher() {
  return async (url: string) => ({
    finalUrl: url,
    status: 403,
    headers: {
      'content-type': 'text/html; charset=UTF-8',
      server: 'cloudflare',
      'cf-mitigated': 'challenge',
      'cf-ray': '8f2c1d0e4a2b0000',
    },
    body: CHALLENGE_BODY,
    redirectChain: [],
    timingMs: 12,
    truncated: false,
  });
}

/**
 * Performance measured, and measured well.
 *
 * PSI asks Google, not the site, so it answers whatever our own crawler was
 * refused. Without this runner the test would pass for the wrong reason: the
 * scan would fail because nothing ran, rather than because nothing was read.
 */
function measuredPerformance(): PerformanceSnapshot {
  return {
    source: 'pagespeed',
    origin: 'https://example.com',
    strategy: 'desktop',
    performanceScore: 87,
    metrics: { largestContentfulPaintMs: 2100 },
    fetchedAt: '2026-09-21T00:00:00.000Z',
  };
}

describe('a paid scan of a site that blocks the crawler', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  async function runBlockedScan() {
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const registration = await agent
      .post('/auth/register')
      .send({ email: 'blocked@example.com', password: 'correct-horse-1' });
    const cookie = registration.headers['set-cookie']?.[0]?.split(';', 1)[0] ?? '';
    const profile = await agent
      .post('/profiles')
      .set('Cookie', cookie)
      .send({ name: 'Blocked Site', domain: 'https://example.com' });
    const checkout = await agent
      .post('/billing/dev-checkout')
      .set('Cookie', cookie)
      .send({
        siteProfileId: profile.body.data.id as string,
        plan: 'Complete',
        scope: { includeSubdomains: false },
      });
    const scanId = checkout.body.data.scanId as string;

    const result = await processScan(
      {
        prisma: db.prisma,
        logger: silentLogger,
        createAiProvider: (scan, siteProfile) =>
          createDefaultAiProvider(siteProfile.name, new URL(scan.domain).hostname),
        createPerformanceRunner: () => async () => measuredPerformance(),
        crawl: { dangerouslyAllowLoopback: true, fetcher: challengeFetcher() },
      },
      scanId,
    );
    return { scanId, result };
  }

  it('fails the scan and refunds it in full, although Performance measured fine', async () => {
    const { scanId, result } = await runBlockedScan();

    expect(result.outcome).toBe('Failed');
    const scan = await db.prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
    expect(scan.status).toBe('Failed');
    const refund = await db.prisma.refundRecord.findUniqueOrThrow({
      where: { purchaseId: scan.purchaseId as string },
    });
    expect(refund.reasonCode).toBe('EXTERNAL_NO_USABLE_OUTPUT');
  });

  it('says the site denied us access, not that the scan produced nothing', async () => {
    const { scanId } = await runBlockedScan();

    const scan = await db.prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
    // The owner of a blocked site can fix this in an allowlist. "NoUsableOutput"
    // tells them nothing they can act on.
    expect(scan.statusReason).toBe('SiteDeniedAccess');
  });

  it('records what the crawl saw, including the vendor in front of the site', async () => {
    const { scanId } = await runBlockedScan();

    const scan = await db.prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
    const summary = JSON.parse(scan.crawlSummaryJson ?? 'null') as {
      reach: string;
      startStatus: number;
      pagesRead: number;
      accessControlSignals: readonly string[];
    };
    expect(summary.reach).toBe('access-denied');
    expect(summary.startStatus).toBe(403);
    expect(summary.pagesRead).toBe(0);
    expect(summary.accessControlSignals).toContain('server: cloudflare');
  });

  it('scores nothing at all', async () => {
    const { scanId } = await runBlockedScan();

    const modules = await db.prisma.scanModule.findMany({ where: { scanId } });
    expect(modules.length).toBeGreaterThan(0);
    // 96.95 out of 100, on zero pages read, is the number this prevents.
    expect(modules.every((module) => module.score === null)).toBe(true);
    expect(modules.every((module) => module.usableOutput === false)).toBe(true);
  });

  it('marks every section Unavailable rather than Completed at 100% coverage', async () => {
    const { scanId } = await runBlockedScan();

    const modules = await db.prisma.scanModule.findMany({ where: { scanId } });
    for (const module of modules) {
      expect(module.runtimeStatus).toBe('Unavailable');
      // The old bug in one line: checks that need a real page went to
      // NotApplicable, left the denominator, and the module read 100%.
      expect(module.coverage).toBe(0);
      expect(module.statusReason).toBe('SiteDeniedAccess');
    }
  });

  it('creates no findings, because a challenge page is not the site', async () => {
    const { scanId } = await runBlockedScan();

    const issues = await db.prisma.issue.findMany({ where: { scanId } });
    expect(issues).toEqual([]);
  });

  it('spends no AI quota on a scan that is about to be refunded', async () => {
    const { scanId } = await runBlockedScan();

    expect(await db.prisma.aiResponseRecord.count({ where: { scanId } })).toBe(0);
  });
});

// Our own outage, told apart from the customer's site being down.
//
// Every paid crawl leaves through one VPS. When it stops answering, every fetch
// fails — and without this the scan would read that as "the site is
// unreachable", spend the customer's paid scan on our outage, and tell them
// their site is broken. Crawling directly instead is not the answer either:
// that is the Hetzner block the proxy exists to avoid (D-220).
describe('a scan whose egress proxy is down', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it('fails as a platform failure, and never blames the site or goes direct', async () => {
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const registration = await agent
      .post('/auth/register')
      .send({ email: 'egress@example.com', password: 'correct-horse-1' });
    const cookie = registration.headers['set-cookie']?.[0]?.split(';', 1)[0] ?? '';
    const profile = await agent
      .post('/profiles')
      .set('Cookie', cookie)
      .send({ name: 'Healthy Site', domain: 'https://example.com' });
    const checkout = await agent
      .post('/billing/dev-checkout')
      .set('Cookie', cookie)
      .send({
        siteProfileId: profile.body.data.id as string,
        plan: 'Complete',
        scope: { includeSubdomains: false },
      });
    const scanId = checkout.body.data.scanId as string;

    let fetched = 0;
    const result = await processScan(
      {
        prisma: db.prisma,
        logger: silentLogger,
        createAiProvider: (scan, siteProfile) =>
          createDefaultAiProvider(siteProfile.name, new URL(scan.domain).hostname),
        crawl: {
          egressProxy: { url: 'http://proxy.test:13128' } as never,
          fetcher: async (url) => {
            fetched += 1;
            return {
              finalUrl: url,
              status: 200,
              headers: { 'content-type': 'text/html' },
              body: '<html><body>the site is perfectly fine</body></html>',
              redirectChain: [],
              timingMs: 4,
              truncated: false,
            };
          },
        },
        probeEgress: async () => ({
          state: 'unreachable' as const,
          observedIp: null,
          expectedIp: null,
          latencyMs: null,
          detail: 'ECONNREFUSED',
          checkedAt: new Date(),
        }),
      },
      scanId,
    );

    expect(result.outcome).toBe('Failed');
    // Not one request left the process: going direct is what the proxy exists
    // to prevent, and a site that is up must never be recorded as down.
    expect(fetched).toBe(0);
    const scan = await db.prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
    expect(scan.crawlSummaryJson).toBeNull();
    expect(scan.statusReason).not.toBe('SiteUnreachable');
    // Our platform, our retry, our refund reason.
    expect(scan.platformRetryCount).toBe(1);
    const refund = await db.prisma.refundRecord.findUniqueOrThrow({
      where: { purchaseId: scan.purchaseId as string },
    });
    expect(refund.reasonCode).toBe('PLATFORM_FAILURE_AFTER_RETRY');
  });
});
