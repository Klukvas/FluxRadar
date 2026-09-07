import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../index.ts';
import { silentLogger } from './logger.ts';
import { checkDatabaseReady } from './health.ts';
import { createTestDb, type TestDb, TEST_WEBHOOK_SECRET } from '../test-utils/test-db.ts';

// CR-04: liveness stays cheap and DB-free; readiness runs a bounded SELECT 1 and
// fails closed with a safe 503 that never exposes connection detail.
describe('CR-04 DB-aware health', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it('serves liveness without touching the database', async () => {
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
    });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
  });

  it('reports ready when SELECT 1 succeeds', async () => {
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
    });
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: { status: 'ready' }, error: null });
    expect(await checkDatabaseReady(db.prisma)).toBe(true);
  });

  it('returns a safe 503 without connection detail when the database is unreachable', async () => {
    const unreachable = {
      $queryRaw: () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.1:5432')),
    } as unknown as TestDb['prisma'];
    const app = createApp({
      prisma: unreachable,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
    });
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.data.status).toBe('not-ready');
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(res.body)).not.toContain('5432');
  });

  it('times out slow probes and reports not-ready', async () => {
    const slow = {
      $queryRaw: () => new Promise(() => undefined),
    } as unknown as TestDb['prisma'];
    expect(await checkDatabaseReady(slow, 20)).toBe(false);
  });

  // Liveness answering 200 while the database is gone is the whole point of
  // splitting the two: a DB outage must take the process out of rotation, not
  // restart it in a loop that guarantees it is also cold when the DB returns.
  it('keeps answering liveness while the database is unreachable', async () => {
    const unreachable = {
      $queryRaw: () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.1:5432')),
    } as unknown as TestDb['prisma'];
    const app = createApp({
      prisma: unreachable,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
    });

    const [live, ready] = await Promise.all([
      request(app).get('/health'),
      request(app).get('/health/ready'),
    ]);

    expect(live.status).toBe(200);
    expect(live.body.data.status).toBe('ok');
    expect(ready.status).toBe(503);
  });

  // A probe that hangs is worse than one that fails: the orchestrator waits on
  // it instead of taking the instance out. The bound has to hold over HTTP, not
  // only in the helper.
  it('answers readiness within the timeout when the database never replies', async () => {
    const app = createApp({
      prisma: { $queryRaw: () => new Promise(() => undefined) } as unknown as TestDb['prisma'],
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
      readinessTimeoutMs: 50,
    });

    const startedAt = process.hrtime.bigint();
    const response = await request(app).get('/health/ready');
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    expect(response.status).toBe(503);
    expect(response.body.data.status).toBe('not-ready');
    expect(elapsedMs).toBeLessThan(2_000);
  });

  it('never names the database in a readiness answer', async () => {
    const unreachable = {
      $queryRaw: () =>
        Promise.reject(
          new Error('password authentication failed for user "fluxradar" at postgres:5432'),
        ),
    } as unknown as TestDb['prisma'];
    const app = createApp({
      prisma: unreachable,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
    });

    const response = await request(app).get('/health/ready');

    const body = JSON.stringify(response.body);
    for (const secretish of ['password', 'fluxradar', 'postgres', '5432', 'authentication']) {
      expect(body).not.toContain(secretish);
    }
  });

  // deploy/public-smoke.sh greps these exact shapes and the deploy gate polls
  // /health/ready before it switches traffic; both must keep matching.
  it('keeps the response shapes the deploy gate greps for', async () => {
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
    });

    expect(JSON.stringify((await request(app).get('/health')).body)).toContain('"status":"ok"');
    expect(JSON.stringify((await request(app).get('/health/ready')).body)).toContain(
      '"status":"ready"',
    );
  });
});
