import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../index.ts';
import { silentLogger } from '../http/logger.ts';
import { createTestDb, TEST_WEBHOOK_SECRET, type TestDb } from '../test-utils/test-db.ts';

// The account screen's two server reads: a signed-in password change, and the
// owner's purchase history.

const NOW = new Date('2026-09-18T12:00:00.000Z');
const PASSWORD = 'correct-horse-1';

function cookieOf(response: request.Response): string {
  const cookie = response.headers['set-cookie']?.[0]?.split(';', 1)[0];
  if (cookie === undefined) throw new Error('response did not set a session cookie');
  return cookie;
}

describe('account routes', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  function makeApp() {
    return createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
      now: () => NOW,
    });
  }

  async function register(app: ReturnType<typeof makeApp>, email: string): Promise<string> {
    const response = await request(app).post('/auth/register').send({ email, password: PASSWORD });
    expect(response.status).toBe(201);
    return cookieOf(response);
  }

  async function login(app: ReturnType<typeof makeApp>, email: string, password: string) {
    return request(app).post('/auth/login').send({ email, password });
  }

  describe('POST /account/password', () => {
    it('refuses a wrong current password without signing the owner out', async () => {
      const app = makeApp();
      const cookie = await register(app, 'wrong-current@example.com');

      const response = await request(app)
        .post('/account/password')
        .set('Cookie', cookie)
        .send({ currentPassword: 'not-my-password', newPassword: 'another-horse-2' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('CURRENT_PASSWORD_INCORRECT');
      expect((await request(app).get('/auth/me').set('Cookie', cookie)).status).toBe(200);
      expect((await login(app, 'wrong-current@example.com', PASSWORD)).status).toBe(200);
    });

    it('changes the password and ends every other session, keeping this one', async () => {
      const app = makeApp();
      const here = await register(app, 'change@example.com');
      const elsewhere = cookieOf(await login(app, 'change@example.com', PASSWORD));

      const response = await request(app)
        .post('/account/password')
        .set('Cookie', here)
        .send({ currentPassword: PASSWORD, newPassword: 'another-horse-2' });

      expect(response.status).toBe(200);
      expect((await request(app).get('/auth/me').set('Cookie', here)).status).toBe(200);
      expect((await request(app).get('/auth/me').set('Cookie', elsewhere)).status).toBe(401);
      expect((await login(app, 'change@example.com', PASSWORD)).status).toBe(401);
      expect((await login(app, 'change@example.com', 'another-horse-2')).status).toBe(200);
    });

    it('holds a new password to the registration rules', async () => {
      const app = makeApp();
      const cookie = await register(app, 'short@example.com');

      const response = await request(app)
        .post('/account/password')
        .set('Cookie', cookie)
        .send({ currentPassword: PASSWORD, newPassword: 'short' });

      expect(response.status).toBe(400);
      expect((await login(app, 'short@example.com', PASSWORD)).status).toBe(200);
    });

    it('stops guessing the current password after five attempts', async () => {
      const app = makeApp();
      const cookie = await register(app, 'guess@example.com');
      const attempt = () =>
        request(app)
          .post('/account/password')
          .set('Cookie', cookie)
          .send({ currentPassword: 'guess', newPassword: 'another-horse-2' });

      for (let index = 0; index < 5; index += 1) {
        expect((await attempt()).status).toBe(400);
      }
      expect((await attempt()).status).toBe(429);
    });

    it('requires a session', async () => {
      const response = await request(makeApp())
        .post('/account/password')
        .send({ currentPassword: PASSWORD, newPassword: 'another-horse-2' });
      expect(response.status).toBe(401);
    });
  });

  describe('GET /account/purchases', () => {
    it("lists the owner's purchases with the site and the scan they started, and nobody else's", async () => {
      const app = makeApp();
      const cookie = await register(app, 'buyer@example.com');
      const otherCookie = await register(app, 'other-buyer@example.com');
      const profile = await request(app)
        .post('/profiles')
        .set('Cookie', cookie)
        .send({ name: 'Shop', domain: 'https://shop.example.com' });
      expect(profile.status).toBe(201);
      const checkout = await request(app)
        .post('/billing/dev-checkout')
        .set('Cookie', cookie)
        .send({
          siteProfileId: profile.body.data.id,
          plan: 'Basic',
          scope: { includeSubdomains: false, maxPages: 15 },
        });
      expect(checkout.status).toBe(201);

      const mine = await request(app).get('/account/purchases').set('Cookie', cookie);
      const theirs = await request(app).get('/account/purchases').set('Cookie', otherCookie);

      expect(mine.status).toBe(200);
      expect(mine.body.data).toHaveLength(1);
      expect(mine.body.data[0]).toMatchObject({
        plan: 'Basic',
        status: 'paid',
        domain: 'https://shop.example.com',
        profileName: 'Shop',
        scanId: checkout.body.data.scanId,
      });
      expect(typeof mine.body.data[0].amount).toBe('number');
      expect(theirs.body.data).toEqual([]);
    });
  });
});
