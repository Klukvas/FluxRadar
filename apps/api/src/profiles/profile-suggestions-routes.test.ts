import type { SafeFetchResult } from '@fluxradar/safe-fetch';
import express from 'express';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { RequestRateLimiter } from '../auth/rate-limit.ts';
import { errorHandler } from '../http/error-handler.ts';
import { silentLogger } from '../http/logger.ts';
import { profilesRouter } from './routes.ts';
import type { ProfileSuggestions } from './profile-suggestions.ts';

const SESSION_COOKIE = 'fluxradar_session=test-token-00000000000000000000000000000000';

type Fetcher = (url: string) => Promise<SafeFetchResult>;

function response(url: string, status: number, body: string, extraHeaders = {}): SafeFetchResult {
  return {
    finalUrl: url,
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...extraHeaders },
    body,
    redirectChain: [],
    timingMs: 4,
    truncated: false,
  };
}

/**
 * A site that answers the preflight with a readable homepage and no robots.txt.
 *
 * The preflight asks every site two things — its robots.txt and its start page —
 * so a test that does not care about reachability still has to answer both, and
 * this is the shape that means "let us in".
 */
function reachableSite(): Fetcher {
  return async (url) =>
    url.endsWith('/robots.txt')
      ? response(url, 404, 'not found')
      : response(url, 200, '<html><body>hello</body></html>');
}

function appWith(options: {
  readonly authenticated?: boolean;
  readonly accountId?: string;
  readonly suggest?: (
    domain: string,
    targetLanguage: 'en' | 'uk',
    signal?: AbortSignal,
  ) => Promise<ProfileSuggestions>;
  readonly limiter?: RequestRateLimiter;
  /** The site the reachability preflight talks to; reachable unless stated. */
  readonly fetcher?: Fetcher;
}) {
  const app = express();
  app.use(
    express.json(),
    profilesRouter({
      prisma: {
        session: {
          findUnique:
            options.authenticated === false
              ? vi.fn().mockResolvedValue(null)
              : vi.fn().mockResolvedValue({
                  accountId: options.accountId ?? 'owner',
                  expiresAt: new Date('2099-01-01'),
                }),
        },
      } as unknown as PrismaClient,
      now: () => new Date(),
      requestRateLimiter: options.limiter,
      suggestProfile: options.suggest,
      probe: { fetcher: options.fetcher ?? reachableSite() },
    }),
    errorHandler(silentLogger),
  );
  return app;
}

describe('POST /profiles/suggestions', () => {
  it('requires a session before reading a public page', async () => {
    const suggest = vi.fn();
    const response = await request(appWith({ authenticated: false, suggest }))
      .post('/profiles/suggestions')
      .send({ domain: 'https://example.test' });
    expect(response.status).toBe(401);
    expect(suggest).not.toHaveBeenCalled();
  });

  it('accepts only a valid https origin and returns the bounded proposal', async () => {
    const suggest = vi.fn().mockResolvedValue({ name: 'Example', targetLanguages: 'en' });
    const response = await request(appWith({ suggest }))
      .post('/profiles/suggestions')
      .set('Cookie', SESSION_COOKIE)
      .send({ domain: 'https://example.test' });
    expect(response.status).toBe(200);
    expect(suggest).toHaveBeenCalledWith('https://example.test', 'en', expect.any(AbortSignal));
    expect(response.body.data).toEqual({ name: 'Example', targetLanguages: 'en' });
  });

  it('passes the requested UI locale to the single suggestion operation', async () => {
    const suggest = vi.fn().mockResolvedValue({ industry: 'Продуктова студія' });
    const response = await request(appWith({ suggest }))
      .post('/profiles/suggestions')
      .set('Cookie', SESSION_COOKIE)
      .send({ domain: 'https://example.test', targetLanguage: 'uk' });
    expect(response.status).toBe(200);
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest).toHaveBeenCalledWith('https://example.test', 'uk', expect.any(AbortSignal));
  });

  // The form decides which fields it may fill and which it has to say it could
  // not; both depend on the endpoint passing the proposal through untouched,
  // including leaving an unstated field out rather than sending it empty.
  it('passes every stated field through and omits the ones the page did not state', async () => {
    const suggest = vi.fn().mockResolvedValue({
      name: 'fluxLab.dev',
      businessDescription: 'Kyiv product studio behind SaaS apps.',
      offerings: 'SaaS Development, Dedicated Development Teams',
      region: 'United States, Ukraine',
      targetLanguages: 'en, uk',
    });
    const response = await request(appWith({ suggest }))
      .post('/profiles/suggestions')
      .set('Cookie', SESSION_COOKIE)
      .send({ domain: 'https://flux-lab.test' });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      name: 'fluxLab.dev',
      businessDescription: 'Kyiv product studio behind SaaS apps.',
      offerings: 'SaaS Development, Dedicated Development Teams',
      region: 'United States, Ukraine',
      targetLanguages: 'en, uk',
    });
    expect(Object.keys(response.body.data)).not.toContain('industry');
    expect(Object.keys(response.body.data)).not.toContain('targetAudience');
  });

  it('returns a stated business type and audience when the page has them', async () => {
    const response = await request(
      appWith({
        suggest: vi
          .fn()
          .mockResolvedValue({ industry: 'Dentist', targetAudience: 'Families with children' }),
      }),
    )
      .post('/profiles/suggestions')
      .set('Cookie', SESSION_COOKIE)
      .send({ domain: 'https://clinic.test' });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      industry: 'Dentist',
      targetAudience: 'Families with children',
    });
  });

  it('rejects non-origin input before calling the public fetcher', async () => {
    const suggest = vi.fn();
    const response = await request(appWith({ suggest }))
      .post('/profiles/suggestions')
      .set('Cookie', SESSION_COOKIE)
      .send({ domain: 'http://127.0.0.1/private' });
    expect(response.status).toBe(400);
    expect(suggest).not.toHaveBeenCalled();
  });

  it('does not expose a fetch failure and leaves manual saving possible', async () => {
    const response = await request(
      appWith({ suggest: vi.fn().mockRejectedValue(new Error('dns secret detail')) }),
    )
      .post('/profiles/suggestions')
      .set('Cookie', SESSION_COOKIE)
      .send({ domain: 'https://example.test' });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe(
      'Could not read public details from this site. You can still save it manually.',
    );
    expect(JSON.stringify(response.body)).not.toContain('dns secret detail');
  });

  it('limits reads by both account and IP', async () => {
    const app = appWith({
      suggest: vi.fn().mockResolvedValue({}),
      limiter: new RequestRateLimiter(() => 1_000),
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await request(app)
        .post('/profiles/suggestions')
        .set('Cookie', SESSION_COOKIE)
        .send({ domain: 'https://example.test' });
      expect(response.status).toBe(200);
    }
    const response = await request(app)
      .post('/profiles/suggestions')
      .set('Cookie', SESSION_COOKIE)
      .send({ domain: 'https://example.test' });
    expect(response.status).toBe(429);
  });

  it('keeps the IP limit when each request has a different account', async () => {
    const limiter = new RequestRateLimiter(() => 1_000);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await request(
        appWith({
          accountId: `owner-${attempt}`,
          suggest: vi.fn().mockResolvedValue({}),
          limiter,
        }),
      )
        .post('/profiles/suggestions')
        .set('Cookie', SESSION_COOKIE)
        .send({ domain: 'https://example.test' });
      expect(response.status).toBe(200);
    }
    const response = await request(
      appWith({ accountId: 'owner-new', suggest: vi.fn().mockResolvedValue({}), limiter }),
    )
      .post('/profiles/suggestions')
      .set('Cookie', SESSION_COOKIE)
      .send({ domain: 'https://example.test' });
    expect(response.status).toBe(429);
  });
});

// The form reads a site as soon as an address is typed, so these two are what
// stand between a keystroke and an outbound request: the site's own answer about
// whether it may be read, and a bound on how much of that may run at once.
describe('reachability preflight before a public read', () => {
  const PATH = '/profiles/suggestions';

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((next) => {
      resolve = next;
    });
    return { promise, resolve };
  }

  it('asks the site whether we may read it before reading anything', async () => {
    const order: string[] = [];
    const app = appWith({
      fetcher: async (url) => {
        order.push(url.endsWith('/robots.txt') ? 'robots' : 'probe');
        return url.endsWith('/robots.txt')
          ? response(url, 404, 'not found')
          : response(url, 200, '<html><body>hello</body></html>');
      },
      suggest: async () => {
        order.push('extract');
        return { name: 'Example' };
      },
    });

    const result = await request(app).post(PATH).set('Cookie', SESSION_COOKIE).send({
      domain: 'https://example.test',
    });

    expect(result.status).toBe(200);
    expect(order).toEqual(['robots', 'probe', 'extract']);
  });

  it('honours a robots.txt that disallows our crawler and never reads the homepage', async () => {
    const suggest = vi.fn();
    const result = await request(
      appWith({
        suggest,
        fetcher: async (url) =>
          url.endsWith('/robots.txt')
            ? response(url, 200, 'User-agent: *\nDisallow: /', { 'content-type': 'text/plain' })
            : response(url, 200, '<html><body>secret</body></html>'),
      }),
    )
      .post(PATH)
      .set('Cookie', SESSION_COOKIE)
      .send({ domain: 'https://private.test' });

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('SITE_BLOCKED_BY_ROBOTS');
    expect(suggest).not.toHaveBeenCalled();
  });

  it('names a site that refuses our crawler instead of blaming the reader', async () => {
    const suggest = vi.fn();
    const result = await request(
      appWith({
        suggest,
        fetcher: async (url) =>
          url.endsWith('/robots.txt')
            ? response(url, 404, 'not found')
            : response(url, 403, '<html>blocked</html>', { server: 'cloudflare' }),
      }),
    )
      .post(PATH)
      .set('Cookie', SESSION_COOKIE)
      .send({ domain: 'https://walled.test' });

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('SITE_ACCESS_DENIED');
    expect(suggest).not.toHaveBeenCalled();
  });

  it('reports a site that does not answer at all', async () => {
    const suggest = vi.fn();
    const result = await request(
      appWith({
        suggest,
        fetcher: async (url) => {
          if (url.endsWith('/robots.txt')) return response(url, 404, 'not found');
          throw new Error('getaddrinfo ENOTFOUND');
        },
      }),
    )
      .post(PATH)
      .set('Cookie', SESSION_COOKIE)
      .send({ domain: 'https://missing.test' });

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('SITE_UNREACHABLE');
    // The site's own failure text is evidence for the log, not for the response.
    expect(JSON.stringify(result.body)).not.toContain('ENOTFOUND');
    expect(suggest).not.toHaveBeenCalled();
  });

  it('reports a site that answers without a readable page', async () => {
    const suggest = vi.fn();
    const result = await request(
      appWith({
        suggest,
        fetcher: async (url) =>
          url.endsWith('/robots.txt')
            ? response(url, 404, 'not found')
            : response(url, 500, 'upstream error'),
      }),
    )
      .post(PATH)
      .set('Cookie', SESSION_COOKIE)
      .send({ domain: 'https://broken.test' });

    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('SITE_BAD_RESPONSE');
    expect(suggest).not.toHaveBeenCalled();
  });

  it('refuses a duplicate read of the same address while the first is running', async () => {
    const reached = deferred<void>();
    const held = deferred<ProfileSuggestions>();
    const app = appWith({
      suggest: () => {
        reached.resolve();
        return held.promise;
      },
    });
    // `.then` is what makes supertest send: without it the request is still
    // only described, and nothing would ever be in flight to collide with.
    const first = request(app)
      .post(PATH)
      .set('Cookie', SESSION_COOKIE)
      .send({ domain: 'https://example.test' })
      .then((result) => result);
    await reached.promise;

    const duplicate = await request(app).post(PATH).set('Cookie', SESSION_COOKIE).send({
      domain: 'https://example.test',
    });

    expect(duplicate.status).toBe(429);
    expect(duplicate.headers['retry-after']).toBe('15');
    held.resolve({ name: 'Example' });
    expect((await first).status).toBe(200);
  });

  it('frees the address again once its read has finished', async () => {
    const app = appWith({ suggest: vi.fn().mockResolvedValue({ name: 'Example' }) });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await request(app).post(PATH).set('Cookie', SESSION_COOKIE).send({
        domain: 'https://example.test',
      });
      expect(result.status).toBe(200);
    }
  });

  it('lets two different addresses be read at the same time', async () => {
    const held = deferred<ProfileSuggestions>();
    const reached = deferred<void>();
    const app = appWith({
      suggest: (domain) => {
        if (domain === 'https://first.test') {
          reached.resolve();
          return held.promise;
        }
        return Promise.resolve({ name: 'Second' });
      },
    });
    const first = request(app)
      .post(PATH)
      .set('Cookie', SESSION_COOKIE)
      .send({ domain: 'https://first.test' })
      .then((result) => result);
    await reached.promise;

    const second = await request(app).post(PATH).set('Cookie', SESSION_COOKIE).send({
      domain: 'https://second.test',
    });

    expect(second.status).toBe(200);
    expect(second.body.data).toEqual({ name: 'Second' });
    held.resolve({ name: 'First' });
    expect((await first).status).toBe(200);
  });
});
