import type { SafeFetchResult } from '@fluxradar/safe-fetch';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../index.ts';
import { silentLogger } from '../http/logger.ts';
import { RequestRateLimiter } from '../auth/rate-limit.ts';
import { createTestDb, TEST_WEBHOOK_SECRET, type TestDb } from '../test-utils/test-db.ts';
import { REACHABILITY_PROBE_TTL_MS } from './reachability-routes.ts';

// Whether a site will let our crawler in, asked before the owner pays.
//
// Without this a customer could buy a $120 audit of a site that refuses us,
// wait for the scan, and get a refund instead of a report. The endpoint is the
// answer; `fastspring-005-reachability-gate.test.ts` is the refusal it feeds.

const PROBE_PATH = (profileId: string) => `/profiles/${profileId}/reachability`;

function htmlResponse(url: string, status = 200): SafeFetchResult {
  return {
    finalUrl: url,
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: '<html><body>hello</body></html>',
    redirectChain: [],
    timingMs: 5,
    truncated: false,
  };
}

function challenge(url: string): SafeFetchResult {
  return {
    finalUrl: url,
    status: 403,
    headers: { 'content-type': 'text/html', server: 'cloudflare', 'cf-mitigated': 'challenge' },
    body: '<html>blocked</html>',
    redirectChain: [],
    timingMs: 5,
    truncated: false,
  };
}

describe('site reachability before a purchase', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  function buildApp(options: {
    fetcher?: (url: string) => Promise<SafeFetchResult>;
    now?: () => Date;
    requestRateLimiter?: RequestRateLimiter;
  }) {
    return createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
      ...(options.now !== undefined ? { now: options.now } : {}),
      ...(options.requestRateLimiter !== undefined
        ? { requestRateLimiter: options.requestRateLimiter }
        : {}),
      // The probe rides the same transport seam the paid crawl does: one
      // `crawl.fetcher`, so a test cannot hand the two different sites.
      crawl: {
        dangerouslyAllowLoopback: true,
        ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }),
      },
    });
  }

  async function signIn(app: ReturnType<typeof buildApp>, email = 'owner@example.com') {
    const agent = request.agent(app);
    const registered = await agent
      .post('/auth/register')
      .send({ email, password: 'correct-horse-1' });
    expect(registered.status).toBe(201);
    const cookie = registered.headers['set-cookie']?.[0]?.split(';', 1)[0] ?? '';
    const profile = await agent
      .post('/profiles')
      .set('Cookie', cookie)
      .send({ name: 'Fixture Site', domain: `https://${email.split('@')[0]}.example.com` });
    expect(profile.status).toBe(201);
    return { agent, cookie, profileId: profile.body.data.id as string };
  }

  it('requires a session', async () => {
    const app = buildApp({ fetcher: async (url) => htmlResponse(url) });
    expect((await request(app).get(PROBE_PATH('anything'))).status).toBe(401);
    expect((await request(app).post(PROBE_PATH('anything'))).status).toBe(401);
  });

  it("answers 404 for another account's profile", async () => {
    const app = buildApp({ fetcher: async (url) => htmlResponse(url) });
    const owner = await signIn(app, 'owner@example.com');
    const stranger = await signIn(app, 'stranger@example.com');

    const response = await stranger.agent
      .post(PROBE_PATH(owner.profileId))
      .set('Cookie', stranger.cookie);

    expect(response.status).toBe(404);
  });

  it('says a site has never been checked rather than implying it failed', async () => {
    const app = buildApp({ fetcher: async (url) => htmlResponse(url) });
    const { agent, cookie, profileId } = await signIn(app);

    const response = await agent.get(PROBE_PATH(profileId)).set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body.data.state).toBeNull();
    expect(response.body.data.canPurchase).toBe(false);
  });

  it('records a reachable site and allows the purchase', async () => {
    const app = buildApp({ fetcher: async (url) => htmlResponse(url) });
    const { agent, cookie, profileId } = await signIn(app);

    const probe = await agent.post(PROBE_PATH(profileId)).set('Cookie', cookie);

    expect(probe.status).toBe(200);
    expect(probe.body.data.state).toBe('reachable');
    expect(probe.body.data.canPurchase).toBe(true);
    // Stored, because the checkout re-reads it rather than trusting the browser.
    const stored = await db.prisma.siteReachabilityProbe.findUniqueOrThrow({
      where: { siteProfileId: profileId },
    });
    expect(stored.state).toBe('reachable');
  });

  it('records a blocked site, keeps the evidence, and refuses the purchase', async () => {
    const app = buildApp({
      fetcher: async (url) => (url.endsWith('/robots.txt') ? challenge(url) : challenge(url)),
    });
    const { agent, cookie, profileId } = await signIn(app);

    const probe = await agent.post(PROBE_PATH(profileId)).set('Cookie', cookie);

    expect(probe.body.data.state).toBe('access-denied');
    expect(probe.body.data.startStatus).toBe(403);
    expect(probe.body.data.accessControlSignals).toContain('server: cloudflare');
    expect(probe.body.data.canPurchase).toBe(false);
  });

  it('replaces the previous answer instead of keeping a history of refusals', async () => {
    let blocked = true;
    const app = buildApp({
      fetcher: async (url) => (blocked ? challenge(url) : htmlResponse(url)),
    });
    const { agent, cookie, profileId } = await signIn(app);

    await agent.post(PROBE_PATH(profileId)).set('Cookie', cookie);
    blocked = false;
    const second = await agent.post(PROBE_PATH(profileId)).set('Cookie', cookie);

    expect(second.body.data.state).toBe('reachable');
    expect(
      await db.prisma.siteReachabilityProbe.count({ where: { siteProfileId: profileId } }),
    ).toBe(1);
  });

  it('forgets a result the moment the profile points somewhere else', async () => {
    const app = buildApp({ fetcher: async (url) => htmlResponse(url) });
    const { agent, cookie, profileId } = await signIn(app);
    const probe = await agent.post(PROBE_PATH(profileId)).set('Cookie', cookie);
    expect(probe.body.data.canPurchase).toBe(true);

    await agent
      .patch(`/profiles/${profileId}`)
      .set('Cookie', cookie)
      .send({ domain: 'https://somewhere-else.example.com' });

    // The stored answer was about the old domain. Reporting it for the new one
    // would let an owner probe an easy site, repoint the profile and buy a scan
    // of a site nobody checked.
    const read = await agent.get(PROBE_PATH(profileId)).set('Cookie', cookie);
    expect(read.body.data.state).toBeNull();
    expect(read.body.data.canPurchase).toBe(false);
  });

  it('stops counting a probe once it is out of date', async () => {
    let clock = new Date('2026-09-21T10:00:00.000Z');
    const app = buildApp({ fetcher: async (url) => htmlResponse(url), now: () => clock });
    const { agent, cookie, profileId } = await signIn(app);
    await agent.post(PROBE_PATH(profileId)).set('Cookie', cookie);

    clock = new Date(clock.getTime() + REACHABILITY_PROBE_TTL_MS + 1000);
    const read = await agent.get(PROBE_PATH(profileId)).set('Cookie', cookie);

    // A site that was reachable an hour ago may be behind a challenge now.
    expect(read.body.data.state).toBe('reachable');
    expect(read.body.data.expired).toBe(true);
    expect(read.body.data.canPurchase).toBe(false);
  });

  it('rate-limits the check, because each call reaches somebody else’s server', async () => {
    const limiter = new RequestRateLimiter();
    const app = buildApp({
      fetcher: async (url) => htmlResponse(url),
      requestRateLimiter: limiter,
    });
    const { agent, cookie, profileId } = await signIn(app);

    let lastStatus = 200;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      lastStatus = (await agent.post(PROBE_PATH(profileId)).set('Cookie', cookie)).status;
      if (lastStatus === 429) break;
    }

    expect(lastStatus).toBe(429);
    // Reading the stored answer is free; only taking a new one is limited.
    expect((await agent.get(PROBE_PATH(profileId)).set('Cookie', cookie)).status).toBe(200);
  });
});
