import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FREE_CHECK_RULE_IDS } from '@fluxradar/contracts';
import { startFixtureSite, type FixtureSite } from '@fluxradar/crawler';

import { createApp } from '../index.ts';
import { silentLogger } from '../http/logger.ts';
import { createDefaultAiProvider } from '../orchestrator/geo.ts';
import { processScan } from '../orchestrator/worker.ts';
import { createTestDb, type TestDb } from '../test-utils/test-db.ts';
import { freeScanScope } from './free-scan-scope.ts';

// What a Free check records about itself.
//
// `Scan.scopeJson` used to be a three-word stub on this plan, so the one place
// that says how a scan was configured said nothing — the report, the export and
// the next scan's form all read it, and all three read a placeholder. It now
// holds the settings the check will actually run with, which is a different
// thing from the settings that were requested: Free is the fixed homepage check
// and the crawler enforces that whatever arrives.

const PASSWORD = 'sufficiently-long-password';

const AMBITIOUS_SCOPE = {
  includeSubdomains: true,
  maxPages: 500,
  maxDepth: 9,
  urlPatterns: ['/docs/*'],
  excludePatterns: ['/admin/*'],
  queryPolicy: 'include' as const,
  respectRobots: false,
  robotsOverrideConfirmed: true,
  userAgent: 'mobile' as const,
};

describe('freeScanScope', () => {
  it('keeps the user agent and states the homepage check for everything else', () => {
    expect(freeScanScope(AMBITIOUS_SCOPE)).toEqual({
      includeSubdomains: false,
      maxPages: 1,
      maxDepth: 0,
      queryPolicy: 'ignore',
      respectRobots: true,
      robotsOverrideConfirmed: false,
      userAgent: 'mobile',
    });
  });

  it('has a complete scope of its own when nothing was requested', () => {
    expect(freeScanScope()).toEqual({
      includeSubdomains: false,
      maxPages: 1,
      maxDepth: 0,
      queryPolicy: 'ignore',
      respectRobots: true,
      robotsOverrideConfirmed: false,
      userAgent: 'desktop',
    });
  });
});

describe('free check scope persistence', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  function app() {
    return createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
    });
  }

  async function signedIn(email: string) {
    const agent = request.agent(app());
    const registered = await agent.post('/auth/register').send({ email, password: PASSWORD });
    expect(registered.status).toBe(201);
    return agent;
  }

  it('stores the settings the check runs with, not the ones that were asked for', async () => {
    const agent = await signedIn('scoped@example.com');
    const profile = await agent
      .post('/profiles')
      .send({ name: 'Site', domain: 'https://scoped.example' });

    const created = await agent
      .post(`/profiles/${profile.body.data.id}/free-check`)
      .send({ scope: AMBITIOUS_SCOPE });

    expect(created.status).toBe(201);
    // The response, the stored row and a later read all agree.
    expect(created.body.data.scope).toEqual({
      includeSubdomains: false,
      maxPages: 1,
      maxDepth: 0,
      queryPolicy: 'ignore',
      respectRobots: true,
      robotsOverrideConfirmed: false,
      userAgent: 'mobile',
    });
    const stored = await db.prisma.scan.findUniqueOrThrow({
      where: { id: created.body.data.id },
    });
    expect(JSON.parse(stored.scopeJson)).toEqual(created.body.data.scope);
    const reread = await agent.get(`/scans/${created.body.data.id}`);
    expect(reread.body.data.scope).toEqual(created.body.data.scope);
  });

  it('records a complete scope for a request that carried none', async () => {
    const agent = await signedIn('bare@example.com');
    const profile = await agent
      .post('/profiles')
      .send({ name: 'Site', domain: 'https://bare.example' });

    const created = await agent.post(`/profiles/${profile.body.data.id}/free-check`).send({});

    expect(created.status).toBe(201);
    expect(created.body.data.scope).toEqual({
      includeSubdomains: false,
      maxPages: 1,
      maxDepth: 0,
      queryPolicy: 'ignore',
      respectRobots: true,
      robotsOverrideConfirmed: false,
      userAgent: 'desktop',
    });
  });

  // The whole point of persisting the configuration: the next scan of the same
  // site can be opened on it. This is the read the form makes.
  it('serves the latest scope back on the profile scan list', async () => {
    const agent = await signedIn('prefill@example.com');
    const profile = await agent
      .post('/profiles')
      .send({ name: 'Site', domain: 'https://prefill.example' });
    const created = await agent
      .post(`/profiles/${profile.body.data.id}/free-check`)
      .send({ scope: { ...AMBITIOUS_SCOPE, userAgent: 'mobile' } });
    expect(created.status).toBe(201);

    const listed = await agent.get(`/profiles/${profile.body.data.id}/scans?limit=1&offset=0`);

    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].scope.userAgent).toBe('mobile');
    expect(listed.body.data[0].scope.maxPages).toBe(1);
  });

  it('starts a check from a raw address with no profile saved first', async () => {
    const agent = await signedIn('raw-url@example.com');

    const resolved = await agent
      .post('/profiles/resolve')
      .send({ domain: 'https://www.rawstart.example' });
    expect(resolved.status).toBe(201);
    const created = await agent
      .post(`/profiles/${resolved.body.data.profile.id}/free-check`)
      .send({ scope: { includeSubdomains: false, userAgent: 'desktop' } });

    expect(created.status).toBe(201);
    expect(created.body.data.plan).toBe('Free');
    expect(created.body.data.domain).toBe('https://www.rawstart.example');
    expect(created.body.data.profileId).toBe(resolved.body.data.profile.id);
  });

  // Nothing above may loosen the boundary: a scope that does not parse is still
  // a rejected request, not a scan created from a shrug.
  it('still refuses a malformed scope', async () => {
    const agent = await signedIn('malformed@example.com');
    const profile = await agent
      .post('/profiles')
      .send({ name: 'Site', domain: 'https://malformed.example' });

    const created = await agent
      .post(`/profiles/${profile.body.data.id}/free-check`)
      .send({ scope: { includeSubdomains: 'yes' } });

    expect(created.status).toBe(400);
    await expect(db.prisma.scan.count()).resolves.toBe(0);
  });
});

// The record above is not the enforcement — the crawler is. Nothing in this
// change may let a Free request buy a wider crawl than the plan sells, so this
// runs one for real against the fixture site and counts what it read.
describe('free check crawl enforcement', () => {
  let db: TestDb;
  let fixture: FixtureSite;

  beforeAll(async () => {
    fixture = await startFixtureSite();
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it('reads the homepage only, however many pages the request asked for', async () => {
    const app = createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const registered = await agent
      .post('/auth/register')
      .send({ email: 'enforced@example.com', password: PASSWORD });
    expect(registered.status).toBe(201);
    const profile = await agent
      .post('/profiles')
      .send({ name: 'Site', domain: 'https://enforced.example' });
    const created = await agent
      .post(`/profiles/${profile.body.data.id}/free-check`)
      .send({ scope: AMBITIOUS_SCOPE });
    expect(created.status).toBe(201);

    const outcome = await processScan(
      {
        prisma: db.prisma,
        logger: silentLogger,
        createAiProvider: (scan, siteProfile) =>
          createDefaultAiProvider(siteProfile.name, new URL(scan.domain).hostname),
        crawl: { originOverride: () => fixture.origin, dangerouslyAllowLoopback: true },
      },
      created.body.data.id as string,
    );

    expect(outcome.outcome).toBe('Completed');
    // Four fixed rules against one page. A crawl that had followed the
    // fixture's links — which the request asked it to, twice over — would put
    // several pages behind each of them.
    const seo = await db.prisma.scanModule.findFirstOrThrow({
      where: { scanId: created.body.data.id as string, module: 'SEO' },
    });
    expect(seo.applicableChecks).toBe(FREE_CHECK_RULE_IDS.length);
    expect(seo.completedApplicableChecks).toBe(FREE_CHECK_RULE_IDS.length);
    // And every finding is about the homepage, not about a page a wider crawl
    // would have reached.
    const issueUrls = await db.prisma.issue.findMany({
      where: { scanId: created.body.data.id as string },
      select: { normalizedUrl: true },
    });
    expect(new Set(issueUrls.map((issue) => issue.normalizedUrl)).size).toBeLessThanOrEqual(1);
  });
});
