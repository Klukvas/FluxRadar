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
function appWith(options: {
  readonly authenticated?: boolean;
  readonly accountId?: string;
  readonly suggest?: (domain: string) => Promise<ProfileSuggestions>;
  readonly limiter?: RequestRateLimiter;
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
    expect(suggest).toHaveBeenCalledWith('https://example.test');
    expect(response.body.data).toEqual({ name: 'Example', targetLanguages: 'en' });
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
