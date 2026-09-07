import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../index.ts';
import { silentLogger } from '../http/logger.ts';
import { createTestDb, type TestDb, TEST_WEBHOOK_SECRET } from '../test-utils/test-db.ts';
import { REGISTER_EMAIL_LIMIT, REGISTER_LIMIT, RequestRateLimiter } from './rate-limit.ts';

// What a refused request looks like on the wire, and which of the expensive
// endpoints are actually behind a limit.

const PASSWORD = 'sufficiently-long-password';

describe('rate limited endpoints', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  function buildApp(requestRateLimiter?: RequestRateLimiter) {
    return createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
      ...(requestRateLimiter !== undefined ? { requestRateLimiter } : {}),
    });
  }

  it('refuses a registration flood with a 429 that says when to come back', async () => {
    const agent = request.agent(buildApp());

    const attempts = [];
    for (let attempt = 0; attempt <= REGISTER_LIMIT; attempt += 1) {
      attempts.push(
        await agent
          .post('/auth/register')
          .send({ email: `flood-${attempt}@example.com`, password: PASSWORD }),
      );
    }

    const refused = attempts[attempts.length - 1];
    expect(refused?.status).toBe(429);
    expect(refused?.body).toEqual({
      success: false,
      data: null,
      error: { code: 'RATE_LIMITED', message: 'too many requests, try again later' },
    });
    expect(Number(refused?.headers['retry-after'])).toBeGreaterThan(0);
    // The response says nothing about how the limit is keyed or how full it is.
    expect(JSON.stringify(refused?.body)).not.toContain('register:');
  });

  // Every attempt sends a verification email to an address the caller named, so
  // one address must not be reachable by simply retrying.
  it('limits repeated registrations of one address independently of the client', async () => {
    const app = buildApp();
    const email = 'target@example.com';

    const statuses: number[] = [];
    for (let attempt = 0; attempt <= REGISTER_EMAIL_LIMIT; attempt += 1) {
      const response = await request(app)
        .post('/auth/register')
        .send({ email, password: PASSWORD });
      statuses.push(response.status);
    }

    // First one creates the account, the next ones conflict, then the limit bites.
    expect(statuses[0]).toBe(201);
    expect(statuses[statuses.length - 1]).toBe(429);
  });

  // The limiter has to run before bcrypt: hashing at cost 12 is the expensive
  // part, and a limit that runs after it lets a flood spend that CPU anyway.
  it('refuses a flooded registration without hashing its password', async () => {
    const limiter = new RequestRateLimiter();
    const agent = request.agent(buildApp(limiter));
    for (let attempt = 0; attempt < REGISTER_LIMIT; attempt += 1) {
      await agent
        .post('/auth/register')
        .send({ email: `warmup-${attempt}@example.com`, password: PASSWORD });
    }

    const startedAt = process.hrtime.bigint();
    const refused = await agent
      .post('/auth/register')
      .send({ email: 'refused@example.com', password: PASSWORD });
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    expect(refused.status).toBe(429);
    // A bcrypt hash at cost 12 takes hundreds of milliseconds; a refusal that
    // skipped it is far below any plausible threshold on any machine.
    expect(elapsedMs).toBeLessThan(100);
    expect(await db.prisma.account.count({ where: { email: 'refused@example.com' } })).toBe(0);
  });

  it('holds an account to its scan ceiling and answers with Retry-After', async () => {
    const agent = request.agent(buildApp());
    await agent.post('/auth/register').send({ email: 'scanner@example.com', password: PASSWORD });
    const profile = await agent
      .post('/profiles')
      .send({ name: 'Site', domain: 'https://scanner.example.com' });
    const profileId = profile.body.data.id as string;

    // The Free check is one-per-account, so the endpoint refuses on business
    // grounds first; the limiter still counts every attempt.
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await agent.post(`/profiles/${profileId}/free-check`).send({});
      statuses.push(response.status);
    }

    expect(statuses).toContain(429);
    const refused = await agent.post(`/profiles/${profileId}/free-check`).send({});
    expect(refused.status).toBe(429);
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('leaves health probes outside the limits', async () => {
    const app = buildApp();

    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect((await request(app).get('/health')).status).toBe(200);
    }
    expect((await request(app).get('/health/ready')).status).toBe(200);
  });
});
