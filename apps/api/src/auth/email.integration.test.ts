import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../index.ts';
import { MockMailer } from '../email/mailer.ts';
import { silentLogger } from '../http/logger.ts';
import { createTestDb, type TestDb, TEST_WEBHOOK_SECRET } from '../test-utils/test-db.ts';

describe('CR-02 email lifecycle', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it('creates a hashed verification token and verifies it once', async () => {
    const mailer = new MockMailer();
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
      mailer,
    });
    const register = await request(app)
      .post('/auth/register')
      .send({ email: 'verify@example.com', password: 'correct-horse-1' });
    expect(register.status).toBe(201);
    expect(await db.prisma.emailToken.count()).toBe(1);
    expect((await db.prisma.emailToken.findFirstOrThrow()).tokenHash).not.toContain('verify');
    const token = /verify_email=([^\s]+)/.exec(mailer.messages[0]?.text ?? '')?.[1];
    expect(token).toEqual(expect.any(String));

    const verified = await request(app).get(`/auth/verify-email?token=${token}`);
    expect(verified.status).toBe(200);
    expect(verified.body.data.status).toBe('verified');
    const reused = await request(app).get(`/auth/verify-email?token=${token}`);
    expect(reused.status).toBe(409);
  });

  it('keeps password reset requests non-enumerating and invalidates sessions', async () => {
    const mailer = new MockMailer();
    const app = createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
      mailer,
    });
    const register = await request(app)
      .post('/auth/register')
      .send({ email: 'reset@example.com', password: 'correct-horse-1' });
    const firstCookie = register.headers['set-cookie']?.[0];
    const known = await request(app)
      .post('/auth/password-reset/request')
      .send({ email: 'reset@example.com' });
    const unknown = await request(app)
      .post('/auth/password-reset/request')
      .send({ email: 'missing@example.com' });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    const token = /reset_token=([^\s]+)/.exec(mailer.messages.at(-1)?.text ?? '')?.[1];
    expect(token).toEqual(expect.any(String));

    const reset = await request(app)
      .post('/auth/password-reset/confirm')
      .send({ token, password: 'new-correct-1' });
    expect(reset.status).toBe(200);
    expect(firstCookie).toBeDefined();
    expect((await request(app).get('/auth/me').set('Cookie', firstCookie!)).status).toBe(401);
    const login = await request(app)
      .post('/auth/login')
      .send({ email: 'reset@example.com', password: 'new-correct-1' });
    expect(login.status).toBe(200);
  });
});
