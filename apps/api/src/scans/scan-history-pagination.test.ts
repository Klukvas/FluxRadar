import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { RULESET_VERSION } from '@fluxradar/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../index.ts';
import { silentLogger } from '../http/logger.ts';
import { MAX_PAGE_OFFSET } from '../http/pagination.ts';
import { createTestDb, type TestDb } from '../test-utils/test-db.ts';

// Scan history is paged by PostgreSQL, not by loading the account's whole
// history and slicing it in JavaScript. These tests pin the two things that had
// to keep holding across that move: the page a client asks for is the page it
// gets — stably, with a truthful total — and the Complete-only history gate
// still decides visibility exactly as it did.

type TestAgent = ReturnType<typeof request.agent>;

const PASSWORD = 'sufficiently-long-password';

describe('scan history pagination', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  function buildApp() {
    return createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
    });
  }

  async function register(agent: TestAgent, email: string): Promise<string> {
    const response = await agent.post('/auth/register').send({ email, password: PASSWORD });
    expect(response.status).toBe(201);
    return response.body.data.accountId as string;
  }

  async function createProfile(agent: TestAgent, domain: string): Promise<string> {
    const response = await agent.post('/profiles').send({ name: 'Site', domain });
    expect(response.status).toBe(201);
    return response.body.data.id as string;
  }

  /**
   * Seeds history directly so a test can state the exact plans and timestamps it
   * needs; going through checkout would also cost a bcrypt hash and a webhook
   * per scan and could not produce a createdAt collision at all.
   */
  async function seedScans(
    prisma: PrismaClient,
    params: {
      readonly accountId: string;
      readonly siteProfileId: string;
      readonly domain: string;
      readonly plan: 'Free' | 'Basic' | 'Complete';
      readonly count: number;
      readonly createdAt?: (index: number) => Date;
    },
  ): Promise<readonly string[]> {
    const ids: string[] = [];
    for (let index = 0; index < params.count; index += 1) {
      const scan = await prisma.scan.create({
        data: {
          accountId: params.accountId,
          siteProfileId: params.siteProfileId,
          plan: params.plan,
          domain: params.domain,
          status: 'Completed',
          scopeJson: JSON.stringify({ includeSubdomains: false }),
          rulesetVersion: RULESET_VERSION,
          createdAt: params.createdAt?.(index) ?? new Date(Date.UTC(2026, 0, 1 + index)),
        },
      });
      ids.push(scan.id);
    }
    return ids;
  }

  it('serves the requested page with a truthful total and hasNext', async () => {
    const agent = request.agent(buildApp());
    const accountId = await register(agent, 'pager@example.com');
    const siteProfileId = await createProfile(agent, 'https://pager.example.com');
    await seedScans(db.prisma, {
      accountId,
      siteProfileId,
      domain: 'https://pager.example.com',
      plan: 'Complete',
      count: 7,
    });

    const first = await agent.get('/scans?limit=3&offset=0');
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(3);
    expect(first.body.meta).toEqual({ total: 7, page: 1, limit: 3, hasNext: true });

    const last = await agent.get('/scans?limit=3&offset=6');
    expect(last.body.data).toHaveLength(1);
    expect(last.body.meta).toEqual({ total: 7, page: 3, limit: 3, hasNext: false });
  });

  it('walks the whole history exactly once across pages, newest first', async () => {
    const agent = request.agent(buildApp());
    const accountId = await register(agent, 'walker@example.com');
    const siteProfileId = await createProfile(agent, 'https://walker.example.com');
    const seeded = await seedScans(db.prisma, {
      accountId,
      siteProfileId,
      domain: 'https://walker.example.com',
      plan: 'Complete',
      count: 5,
    });

    const collected: string[] = [];
    for (let offset = 0; offset < 6; offset += 2) {
      const page = await agent.get(`/scans?limit=2&offset=${offset}`);
      collected.push(...page.body.data.map((scan: { id: string }) => scan.id));
    }

    expect(collected).toEqual([...seeded].reverse());
    expect(new Set(collected).size).toBe(seeded.length);
  });

  // Two scans created in the same millisecond are ordered by id, in the index
  // and in the query alike. Without that tie-breaker PostgreSQL may return them
  // in either order per page, which shows one twice and hides the other.
  it('keeps rows with an identical createdAt in a stable order across pages', async () => {
    const agent = request.agent(buildApp());
    const accountId = await register(agent, 'tie@example.com');
    const siteProfileId = await createProfile(agent, 'https://tie.example.com');
    const sameInstant = new Date(Date.UTC(2026, 1, 1, 12, 0, 0));
    await seedScans(db.prisma, {
      accountId,
      siteProfileId,
      domain: 'https://tie.example.com',
      plan: 'Complete',
      count: 6,
      createdAt: () => sameInstant,
    });

    const pages: string[] = [];
    for (let offset = 0; offset < 6; offset += 2) {
      const page = await agent.get(`/scans?limit=2&offset=${offset}`);
      pages.push(...page.body.data.map((scan: { id: string }) => scan.id));
    }

    expect(new Set(pages).size).toBe(6);
    const repeated = await agent.get('/scans?limit=2&offset=2');
    expect(repeated.body.data.map((scan: { id: string }) => scan.id)).toEqual(pages.slice(2, 4));
  });

  it('accepts the page/pageSize spelling and rejects a mixture', async () => {
    const agent = request.agent(buildApp());
    const accountId = await register(agent, 'spelling@example.com');
    const siteProfileId = await createProfile(agent, 'https://spelling.example.com');
    await seedScans(db.prisma, {
      accountId,
      siteProfileId,
      domain: 'https://spelling.example.com',
      plan: 'Complete',
      count: 4,
    });

    const byPage = await agent.get('/scans?pageSize=2&page=2');
    const byOffset = await agent.get('/scans?limit=2&offset=2');
    expect(byPage.status).toBe(200);
    expect(byPage.body.data).toEqual(byOffset.body.data);
    expect(byPage.body.meta).toEqual({ total: 4, page: 2, limit: 2, hasNext: false });

    expect((await agent.get('/scans?page=2&offset=2')).status).toBe(400);
    expect((await agent.get('/scans?limit=500')).status).toBe(400);
    expect((await agent.get(`/scans?offset=${MAX_PAGE_OFFSET + 1}`)).status).toBe(400);
  });

  it('pages a profile scan list and keeps it scoped to the profile', async () => {
    const agent = request.agent(buildApp());
    const accountId = await register(agent, 'profile-pager@example.com');
    const first = await createProfile(agent, 'https://first.example.com');
    const second = await createProfile(agent, 'https://second.example.com');
    await seedScans(db.prisma, {
      accountId,
      siteProfileId: first,
      domain: 'https://first.example.com',
      plan: 'Complete',
      count: 4,
    });
    await seedScans(db.prisma, {
      accountId,
      siteProfileId: second,
      domain: 'https://second.example.com',
      plan: 'Complete',
      count: 2,
    });

    const page = await agent.get(`/profiles/${first}/scans?limit=3`);
    expect(page.status).toBe(200);
    expect(page.body.data).toHaveLength(3);
    expect(page.body.meta).toEqual({ total: 4, page: 1, limit: 3, hasNext: true });
    expect(page.body.data.every((scan: { profileId: string }) => scan.profileId === first)).toBe(
      true,
    );

    const filtered = await agent.get(`/scans?profileId=${second}&limit=10`);
    expect(filtered.body.meta.total).toBe(2);
  });

  it('leaves another account history unreachable through the page parameters', async () => {
    const app = buildApp();
    const mine = request.agent(app);
    const theirs = request.agent(app);
    const myAccountId = await register(mine, 'mine@example.com');
    const myProfile = await createProfile(mine, 'https://mine.example.com');
    const theirAccountId = await register(theirs, 'theirs@example.com');
    const theirProfile = await createProfile(theirs, 'https://theirs.example.com');
    await seedScans(db.prisma, {
      accountId: myAccountId,
      siteProfileId: myProfile,
      domain: 'https://mine.example.com',
      plan: 'Complete',
      count: 2,
    });
    await seedScans(db.prisma, {
      accountId: theirAccountId,
      siteProfileId: theirProfile,
      domain: 'https://theirs.example.com',
      plan: 'Complete',
      count: 3,
    });

    const mineList = await mine.get('/scans?limit=100');
    expect(mineList.body.meta.total).toBe(2);
    expect((await mine.get(`/scans?profileId=${theirProfile}`)).status).toBe(404);
    expect((await mine.get(`/profiles/${theirProfile}/scans`)).status).toBe(404);
  });
});

describe('scan history gate under pagination', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  async function seedAccount(
    plans: readonly ('Free' | 'Basic' | 'Complete')[],
  ): Promise<{ readonly agent: TestAgent; readonly ids: readonly string[] }> {
    const app = createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
    });
    const agent = request.agent(app);
    const registered = await agent
      .post('/auth/register')
      .send({ email: `gate-${plans.join('-')}@example.com`, password: PASSWORD });
    const accountId = registered.body.data.accountId as string;
    const profile = await agent
      .post('/profiles')
      .send({ name: 'Site', domain: `https://gate-${plans.join('-')}.example.com` });
    const siteProfileId = profile.body.data.id as string;
    const ids: string[] = [];
    for (const [index, plan] of plans.entries()) {
      const scan = await db.prisma.scan.create({
        data: {
          accountId,
          siteProfileId,
          plan,
          domain: `https://gate-${plans.join('-')}.example.com`,
          status: 'Completed',
          scopeJson: JSON.stringify({ includeSubdomains: false }),
          rulesetVersion: RULESET_VERSION,
          createdAt: new Date(Date.UTC(2026, 0, 1 + index)),
        },
      });
      ids.push(scan.id);
    }
    return { agent, ids };
  }

  it('shows a Basic-only account its current result and nothing else', async () => {
    const { agent, ids } = await seedAccount(['Basic', 'Basic', 'Basic']);

    const current = await agent.get('/scans?limit=50');
    expect(current.status).toBe(200);
    expect(current.body.data).toHaveLength(1);
    expect(current.body.data[0].id).toBe(ids[ids.length - 1]);
    expect(current.body.meta).toEqual({ total: 1, page: 1, limit: 50, hasNext: false });
  });

  // The gated list holds exactly one row, so paging past it must be empty
  // rather than a second copy of the same scan.
  it('does not repeat the gated result on a later page', async () => {
    const { agent } = await seedAccount(['Basic', 'Basic']);

    const second = await agent.get('/scans?limit=1&offset=1');
    expect(second.status).toBe(200);
    expect(second.body.data).toEqual([]);
    expect(second.body.meta.hasNext).toBe(false);
  });

  it('still refuses an explicit history request without a Complete scan', async () => {
    const { agent } = await seedAccount(['Basic', 'Basic']);

    const history = await agent.get('/scans?history=true&limit=2&offset=0');
    expect(history.status).toBe(403);
    expect(history.body.error.code).toBe('HISTORY_REQUIRES_COMPLETE');
  });

  it('unlocks the full paged history once a Complete scan exists', async () => {
    const { agent, ids } = await seedAccount(['Basic', 'Complete', 'Basic']);

    const history = await agent.get('/scans?history=true&limit=2&offset=0');
    expect(history.status).toBe(200);
    expect(history.body.meta).toEqual({ total: 3, page: 1, limit: 2, hasNext: true });
    const rest = await agent.get('/scans?history=true&limit=2&offset=2');
    expect(rest.body.data).toHaveLength(1);
    expect(
      [...history.body.data, ...rest.body.data].map((scan: { id: string }) => scan.id),
    ).toEqual([...ids].reverse());
  });

  it('leaves a Free-only account its whole list', async () => {
    const { agent } = await seedAccount(['Free', 'Free']);

    const list = await agent.get('/scans');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.meta.total).toBe(2);
  });

  it('reports an empty history rather than refusing it', async () => {
    const { agent } = await seedAccount([]);

    const list = await agent.get('/scans?history=true');
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([]);
    expect(list.body.meta).toEqual({ total: 0, page: 1, limit: 50, hasNext: false });
  });
});
