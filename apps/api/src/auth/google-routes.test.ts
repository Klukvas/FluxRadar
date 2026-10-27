import type { PrismaClient, GoogleLoginState } from '@prisma/client';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../http/error-handler.ts';
import { silentLogger } from '../http/logger.ts';
import { googleAuthRouter } from './google-routes.ts';
import { GoogleEmailAuthorityError } from './google-provider.ts';
import { LoginRateLimiter } from './rate-limit.ts';
import { verifyPassword } from './passwords.ts';

const ORIGIN = 'http://localhost:5174';
const NOW = new Date('2026-10-26T12:00:00Z');

function fixture(options: { prefix?: string; origin?: string } = {}) {
  const origin = options.origin ?? ORIGIN;
  const states = new Map<string, GoogleLoginState>();
  const googleLoginState = {
    create: vi.fn(async ({ data }: { data: GoogleLoginState }) => {
      states.set(data.stateHash, data);
      return data;
    }),
    findUnique: vi.fn(
      async ({ where }: { where: { stateHash: string } }) => states.get(where.stateHash) ?? null,
    ),
    deleteMany: vi.fn(
      async ({
        where,
      }: {
        where: { stateHash?: string; bindingHash?: string; expiresAt: { gt?: Date; lte?: Date } };
      }) => {
        const matches = [...states.values()].filter(
          (state) =>
            (where.stateHash === undefined || state.stateHash === where.stateHash) &&
            (where.bindingHash === undefined || state.bindingHash === where.bindingHash) &&
            (where.expiresAt.gt === undefined || state.expiresAt > where.expiresAt.gt) &&
            (where.expiresAt.lte === undefined || state.expiresAt <= where.expiresAt.lte),
        );
        for (const state of matches) states.delete(state.stateHash);
        return { count: matches.length };
      },
    ),
  };
  const account = {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'new-account' }),
  };
  const provider = {
    authorizationUrl: vi.fn(
      (state: string, nonce: string, challenge: string) =>
        `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ state, nonce, code_challenge: challenge })}`,
    ),
    exchange: vi.fn().mockResolvedValue({ subject: 'stable-google-sub', email: 'owner@gmail.com' }),
  };
  const attachSession = vi.fn().mockResolvedValue(undefined);
  let clock = NOW;
  const app = express();
  app.use(express.json());
  app.use(
    options.prefix ?? '',
    googleAuthRouter(
      {
        prisma: { googleLoginState, account } as unknown as PrismaClient,
        googleProvider: provider,
        frontendOrigin: origin,
        now: () => clock,
        internalFreeEmails: new Set(),
        loginRateLimiter: new LoginRateLimiter(),
      },
      attachSession,
    ),
  );
  app.use(errorHandler(silentLogger));
  const start = async (rememberMe = false) => {
    const response = await request(app)
      .post('/auth/google/start')
      .set('Origin', ORIGIN)
      .send({ rememberMe });
    expect(response.status).toBe(200);
    const url = new URL(response.body.data.url as string);
    const cookie = (response.headers['set-cookie'] as unknown as string[])[0]?.split(';')[0] ?? '';
    return {
      state: url.searchParams.get('state') ?? '',
      nonce: url.searchParams.get('nonce'),
      cookie,
    };
  };
  return {
    app,
    provider,
    account,
    attachSession,
    start,
    states,
    advance: () => {
      clock = new Date(NOW.getTime() + 11 * 60_000);
    },
  };
}

beforeEach(() => {
  vi.stubEnv('GOOGLE_LOGIN_CLIENT_ID', 'test.apps.googleusercontent.com');
  vi.stubEnv('GOOGLE_LOGIN_CLIENT_SECRET', 'test-only');
  vi.stubEnv('GOOGLE_LOGIN_REDIRECT_URI', 'http://localhost:3310/auth/google/callback');
});
afterEach(() => vi.unstubAllEnvs());

describe('Google login HTTP lifecycle', () => {
  it('returns the state cookie through the real /api stripping mount', async () => {
    vi.stubEnv('GOOGLE_LOGIN_REDIRECT_URI', 'https://fluxradar.net/api/auth/google/callback');
    const f = fixture({ prefix: '/api' });
    const browser = request.agent(f.app);
    const started = await browser.post('/api/auth/google/start').set('Origin', ORIGIN).send({});
    expect(started.status).toBe(200);
    const cookie = String(started.headers['set-cookie']);
    expect(cookie).toContain('Path=/api/auth/google');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    const state = new URL(started.body.data.url as string).searchParams.get('state');
    const result = await browser.get('/api/auth/google/callback').query({ state, code: 'code' });
    expect(result.status).toBe(303);
    expect(result.headers.location).toBe(`${ORIGIN}/profiles?google_auth=success`);
    expect(f.attachSession).toHaveBeenCalledTimes(1);
    expect(String(result.headers['set-cookie'])).toContain('Path=/api/auth/google');
  });

  it('keeps prefixed state cookies Secure in production behind the proxy', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('GOOGLE_LOGIN_REDIRECT_URI', 'https://fluxradar.net/api/auth/google/callback');
    const f = fixture({ prefix: '/api', origin: 'https://fluxradar.net' });
    const started = await request(f.app)
      .post('/api/auth/google/start')
      .set('Origin', 'https://fluxradar.net')
      .send({});
    expect(started.status).toBe(200);
    expect(String(started.headers['set-cookie'])).toContain('Secure');
    expect(String(started.headers['set-cookie'])).toContain('Path=/api/auth/google');
  });

  it('creates a verified Google-only account and uses the existing session attachment with remember-me', async () => {
    const f = fixture();
    const attempt = await f.start(true);
    expect(f.states.size).toBe(1);
    const stored = [...f.states.values()][0];
    expect(stored?.stateHash === attempt.state).toBe(false);
    expect(stored?.nonceHash === attempt.nonce).toBe(false);
    const result = await request(f.app)
      .get('/auth/google/callback')
      .query({ state: attempt.state, code: 'server-code' })
      .set('Cookie', attempt.cookie);
    expect(result.status).toBe(303);
    expect(result.headers.location).toBe(`${ORIGIN}/profiles?google_auth=success`);
    expect(f.account.create).toHaveBeenCalledWith({
      data: {
        email: 'owner@gmail.com',
        googleSubject: 'stable-google-sub',
        passwordHash: null,
        emailVerifiedAt: NOW,
      },
    });
    expect(f.attachSession).toHaveBeenCalledWith(expect.anything(), 'new-account', true);
    expect(f.states.size).toBe(0);
    expect(await verifyPassword('any-password', null)).toBe(false);
  });

  it('preserves the validated interface language without relying on browser preferences', async () => {
    const f = fixture();
    const started = await request(f.app)
      .post('/auth/google/start')
      .set('Origin', ORIGIN)
      .send({ language: 'uk' });
    const state = new URL(started.body.data.url as string).searchParams.get('state');
    const cookie = (started.headers['set-cookie'] as unknown as string[])[0]?.split(';')[0] ?? '';
    const result = await request(f.app)
      .get('/auth/google/callback')
      .query({ state, code: 'code' })
      .set('Cookie', cookie);
    expect(result.headers.location).toBe(`${ORIGIN}/profiles?google_auth=success&lang=uk`);
  });

  it('finds repeat users by subject without updating email or re-linking', async () => {
    const f = fixture();
    f.account.findUnique.mockResolvedValueOnce({
      id: 'existing-subject',
      email: 'owner@gmail.com',
    });
    const attempt = await f.start();
    await request(f.app)
      .get('/auth/google/callback')
      .query({ state: attempt.state, code: 'code' })
      .set('Cookie', attempt.cookie);
    expect(f.account.findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { googleSubject: 'stable-google-sub' },
    });
    expect(f.account.create).not.toHaveBeenCalled();
    expect(f.attachSession).toHaveBeenCalledWith(expect.anything(), 'existing-subject', false);
  });

  it('rejects existing password-account email without linking or signing in', async () => {
    const f = fixture();
    f.account.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'password-account' });
    const attempt = await f.start();
    const result = await request(f.app)
      .get('/auth/google/callback')
      .query({ state: attempt.state, code: 'code' })
      .set('Cookie', attempt.cookie);
    expect(result.headers.location).toBe(`${ORIGIN}/profiles?google_auth_error=email_exists`);
    expect(f.account.create).not.toHaveBeenCalled();
    expect(f.attachSession).not.toHaveBeenCalled();
  });

  it('refuses a changed email on an existing subject without retaining stale verified privileges', async () => {
    const f = fixture();
    f.account.findUnique.mockResolvedValueOnce({
      id: 'existing-subject',
      email: 'former-owner@gmail.com',
    });
    const attempt = await f.start();
    const result = await request(f.app)
      .get('/auth/google/callback')
      .query({ state: attempt.state, code: 'code' })
      .set('Cookie', attempt.cookie);
    expect(result.headers.location).toBe(`${ORIGIN}/profiles?google_auth_error=email_changed`);
    expect(f.attachSession).not.toHaveBeenCalled();
    expect(f.account.create).not.toHaveBeenCalled();
  });

  it('refuses cross-origin or missing-origin initiation', async () => {
    const f = fixture();
    expect(
      (
        await request(f.app)
          .post('/auth/google/start')
          .set('Origin', 'https://attacker.example')
          .send({})
      ).status,
    ).toBe(403);
    expect((await request(f.app).post('/auth/google/start').send({})).status).toBe(403);
    expect(f.states.size).toBe(0);
  });

  it('rejects invalid remember-me before storing an attempt', async () => {
    const f = fixture();
    expect(
      (
        await request(f.app)
          .post('/auth/google/start')
          .set('Origin', ORIGIN)
          .send({ rememberMe: 'yes' })
      ).status,
    ).toBe(400);
    expect(f.states.size).toBe(0);
  });

  it.each(['missing-cookie', 'other-browser', 'wrong-state', 'expired'])(
    'rejects %s before contacting Google',
    async (kind) => {
      const f = fixture();
      const attempt = await f.start();
      if (kind === 'expired') f.advance();
      const req = request(f.app)
        .get('/auth/google/callback')
        .query({ state: kind === 'wrong-state' ? 'a'.repeat(43) : attempt.state, code: 'code' });
      if (kind !== 'missing-cookie')
        req.set(
          'Cookie',
          kind === 'other-browser' ? `fluxradar_google_login=${'b'.repeat(43)}` : attempt.cookie,
        );
      const result = await req;
      expect(result.headers.location).toBe(`${ORIGIN}/profiles?google_auth_error=failed`);
      expect(f.provider.exchange).not.toHaveBeenCalled();
      expect(f.attachSession).not.toHaveBeenCalled();
    },
  );

  it('atomically consumes state once even for simultaneous callbacks', async () => {
    const f = fixture();
    const attempt = await f.start();
    const responses = await Promise.all(
      [1, 2].map(() =>
        request(f.app)
          .get('/auth/google/callback')
          .query({ state: attempt.state, code: 'code' })
          .set('Cookie', attempt.cookie),
      ),
    );
    expect(
      responses.filter((res) => res.headers.location?.includes('google_auth=success')),
    ).toHaveLength(1);
    expect(f.provider.exchange).toHaveBeenCalledTimes(1);
    expect(f.attachSession).toHaveBeenCalledTimes(1);
  });

  it('consumes cancellation and rejects a subsequent replay', async () => {
    const f = fixture();
    const attempt = await f.start();
    const cancelled = await request(f.app)
      .get('/auth/google/callback')
      .query({ state: attempt.state, error: 'access_denied' })
      .set('Cookie', attempt.cookie);
    expect(cancelled.headers.location).toBe(`${ORIGIN}/profiles?google_auth_error=cancelled`);
    await request(f.app)
      .get('/auth/google/callback')
      .query({ state: attempt.state, code: 'code' })
      .set('Cookie', attempt.cookie);
    expect(f.provider.exchange).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid token', new Error('provider internals'), 'failed'],
    ['non-authoritative email', new GoogleEmailAuthorityError(), 'use_email'],
  ])('redirects %s safely and clears the attempt cookie', async (_name, error, code) => {
    const f = fixture();
    f.provider.exchange.mockRejectedValueOnce(error);
    const attempt = await f.start();
    const result = await request(f.app)
      .get('/auth/google/callback')
      .query({ state: attempt.state, code: 'code' })
      .set('Cookie', attempt.cookie);
    expect(result.headers.location).toBe(`${ORIGIN}/profiles?google_auth_error=${code}`);
    expect(result.headers['referrer-policy']).toBe('no-referrer');
    expect(result.text).not.toContain('provider internals');
    expect(f.attachSession).not.toHaveBeenCalled();
    expect(String(result.headers['set-cookie']).includes('Expires=Thu, 01 Jan 1970')).toBe(true);
  });

  it('reports unavailable without storing state when not configured', async () => {
    vi.stubEnv('GOOGLE_LOGIN_CLIENT_ID', '');
    vi.stubEnv('GOOGLE_LOGIN_CLIENT_SECRET', '');
    vi.stubEnv('GOOGLE_LOGIN_REDIRECT_URI', '');
    const f = fixture();
    expect((await request(f.app).get('/auth/google/status')).body.data.enabled).toBe(false);
    expect(
      (await request(f.app).post('/auth/google/start').set('Origin', ORIGIN).send({})).status,
    ).toBe(503);
    expect(f.states.size).toBe(0);
  });
});
