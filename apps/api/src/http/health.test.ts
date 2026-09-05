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
});
