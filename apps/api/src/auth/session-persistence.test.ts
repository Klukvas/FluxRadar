import type { PrismaClient } from '@prisma/client';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { NotConfiguredMailer } from '../email/mailer.ts';
import { errorHandler } from '../http/error-handler.ts';
import { silentLogger } from '../http/logger.ts';
import { hashPassword } from './passwords.ts';
import { LoginRateLimiter } from './rate-limit.ts';
import { authRouter } from './routes.ts';

const NOW = new Date('2026-09-10T12:00:00Z');
const PASSWORD = 'isolated-test-password';
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function appForAuth(): express.Express {
  const account = {
    id: 'account-test',
    email: 'cookie@example.com',
    passwordHash,
    emailVerifiedAt: NOW,
    onboardingCompletedAt: null,
    onboardingSkippedAt: null,
  };
  const prisma = {
    account: {
      findUnique: vi.fn().mockResolvedValue(account),
      create: vi.fn().mockResolvedValue(account),
    },
    session: { create: vi.fn().mockResolvedValue({}) },
    emailToken: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;
  const app = express();
  app.use(express.json());
  app.use(
    authRouter({
      prisma,
      loginRateLimiter: new LoginRateLimiter(),
      now: () => NOW,
      internalFreeEmails: new Set(),
      mailer: new NotConfiguredMailer(),
    }),
  );
  app.use(errorHandler(silentLogger));
  return app;
}

describe('auth cookie persistence over HTTP', () => {
  it('logs in with a session cookie when Remember me is omitted', async () => {
    const response = await request(appForAuth()).post('/auth/login').send({
      email: 'cookie@example.com',
      password: PASSWORD,
    });
    expect(response.status).toBe(200);
    const cookie = String(response.headers['set-cookie']);
    expect(cookie.includes('fluxradar_session=')).toBe(true);
    expect(cookie.includes('HttpOnly')).toBe(true);
    expect(cookie.includes('SameSite=Lax')).toBe(true);
    // Assert booleans so a failing test never prints the session token.
    expect(/Expires=|Max-Age=/i.test(cookie)).toBe(false);
  });

  it.each(['/auth/login', '/auth/register'])(
    'uses a session cookie for %s with Remember me unchecked',
    async (path) => {
      const response = await request(appForAuth()).post(path).send({
        email: 'cookie@example.com',
        password: PASSWORD,
        rememberMe: false,
      });
      expect(response.status).toBe(path === '/auth/register' ? 201 : 200);
      expect(/Expires=|Max-Age=/i.test(String(response.headers['set-cookie']))).toBe(false);
    },
  );

  it.each(['/auth/login', '/auth/register'])(
    'rejects a non-boolean Remember me value for %s',
    async (path) => {
      const response = await request(appForAuth()).post(path).send({
        email: 'cookie@example.com',
        password: PASSWORD,
        rememberMe: 'true',
      });
      expect(response.status).toBe(400);
      expect(response.headers['set-cookie'] === undefined).toBe(true);
    },
  );

  it('preserves Secure and HttpOnly in production without forcing persistence', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const response = await request(appForAuth()).post('/auth/login').send({
      email: 'cookie@example.com',
      password: PASSWORD,
    });
    expect(response.status).toBe(200);
    const cookie = String(response.headers['set-cookie']);
    expect(cookie.includes('Secure')).toBe(true);
    expect(cookie.includes('HttpOnly')).toBe(true);
    expect(cookie.includes('SameSite=Lax')).toBe(true);
    expect(cookie.includes('Path=/')).toBe(true);
    expect(/Expires=|Max-Age=/i.test(cookie)).toBe(false);
  });

  it.each(['/auth/login', '/auth/register'])(
    'persists %s for seven days only with Remember me',
    async (path) => {
      const response = await request(appForAuth()).post(path).send({
        email: 'cookie@example.com',
        password: PASSWORD,
        rememberMe: true,
      });
      expect(response.status).toBe(path === '/auth/register' ? 201 : 200);
      const cookie = String(response.headers['set-cookie']);
      expect(cookie.includes('Expires=Thu, 17 Sep 2026 12:00:00 GMT')).toBe(true);
      expect(cookie.includes('Max-Age=')).toBe(false);
    },
  );
});
