// Route contract for the AI query-ideas endpoint.
//
// The endpoint spends money on an external provider and sends the account's own
// Search Console rows to it, so the things worth pinning are the boundaries:
// who may ask, how often, what the answer may contain, and what it says when
// there is nothing to ask or nobody to ask.
//
// Prisma is mocked inline, as in export/routes.test.ts, so no database is
// needed to test a route whose whole job is a decision.

import type { AiProvider, NormalizedAiResponse } from '@fluxradar/ai';
import type { PrismaClient } from '@prisma/client';
import express from 'express';
import request, { type Test } from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { RequestRateLimiter, AI_IDEAS_LIMIT } from '../../auth/rate-limit.ts';
import { errorHandler } from '../../http/error-handler.ts';
import { silentLogger } from '../../http/logger.ts';
import { queryIdeasRouter } from './query-ideas-routes.ts';
import type { GoogleDataSnapshot } from './types.ts';

const ACCOUNT_ID = 'account_owner';
const OTHER_ACCOUNT_ID = 'account_stranger';
const SESSION_COOKIE = 'fluxradar_session=test-token-00000000000000000000000000000000';
const SCAN_ID = 'scan_abc123';

const SNAPSHOT: GoogleDataSnapshot = {
  source: 'google',
  readOnly: true,
  fetchedAt: '2026-09-06T09:30:00.000Z',
  dateRange: { startDate: '2026-08-07', endDate: '2026-09-03' },
  searchConsole: {
    state: 'connected',
    detail: 'ok',
    data: {
      siteUrl: 'sc-domain:example.com',
      totals: { clicks: 1234, impressions: 56789, ctr: 0.0217, position: 12.34 },
      topQueries: [
        { key: 'site audit', clicks: 300, impressions: 4000, ctr: 0.075, position: 3.2 },
      ],
      topPages: [
        {
          key: 'https://example.com/pricing',
          clicks: 200,
          impressions: 900,
          ctr: 0.22,
          position: 5,
        },
      ],
    },
  },
  analytics: { state: 'no_data', detail: 'none', data: null },
};

function scanRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SCAN_ID,
    accountId: ACCOUNT_ID,
    siteProfileId: 'profile_1',
    plan: 'Complete',
    domain: 'https://example.com',
    status: 'Completed',
    purchaseId: null,
    purchase: null,
    modules: [
      { module: 'Analytics', runtimeStatus: 'Partial', metadataJson: JSON.stringify(SNAPSHOT) },
    ],
    ...overrides,
  };
}

function makePrisma(scan: Record<string, unknown> | null): PrismaClient {
  return {
    scan: {
      findFirst: vi.fn((args: { where: { id: string; accountId: string } }) =>
        Promise.resolve(scan !== null && args.where.accountId === ACCOUNT_ID ? scan : null),
      ),
    },
    siteProfile: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: 'profile_1', accountId: ACCOUNT_ID, name: 'Example' }),
    },
    session: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ accountId: ACCOUNT_ID, expiresAt: new Date('2099-01-01') }),
    },
  } as unknown as PrismaClient;
}

function providerReturning(rawText: string): AiProvider {
  return {
    config: {
      provider: 'anthropic',
      apiVersion: '2023-06-01',
      modelId: 'claude-sonnet-5',
      timeoutMs: 1000,
      maxRetries: 1,
    },
    send: (): Promise<NormalizedAiResponse> =>
      Promise.resolve({
        provider: 'anthropic',
        apiVersion: '2023-06-01',
        modelId: 'claude-sonnet-5',
        requestId: 'req-1',
        requestIdSource: 'provider',
        createdAt: '2026-09-08T00:00:00.000Z',
        rawText,
        citations: [],
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
        usageSource: 'provider',
        finishReason: 'stop',
      }),
  };
}

interface AppOptions {
  readonly scan?: Record<string, unknown> | null;
  readonly provider?: AiProvider | null;
  readonly limiter?: RequestRateLimiter;
}

function makeApp(options: AppOptions = {}) {
  const app = express();
  app.use(express.json());
  app.use(
    queryIdeasRouter({
      prisma: makePrisma(options.scan === undefined ? scanRow() : options.scan),
      now: () => new Date('2026-09-08T12:00:00.000Z'),
      logger: silentLogger,
      ...(options.limiter !== undefined ? { requestRateLimiter: options.limiter } : {}),
      createProvider: () => options.provider ?? null,
    }),
  );
  app.use(errorHandler(silentLogger));
  return app;
}

function authed(req: Test): Test {
  return req.set('Cookie', SESSION_COOKIE);
}

const IDEAS_PATH = `/scans/${SCAN_ID}/search-console/query-ideas`;

const GOOD_ANSWER = JSON.stringify({
  ideas: [
    { query: 'аудит сайта онлайн', language: 'ru', rationale: 'Близко к измеренному запросу.' },
    { query: 'аудит сайту онлайн', language: 'uk', rationale: 'Українською цього ще немає.' },
    { query: 'website audit tool', language: 'en', rationale: 'Adjacent to what already ranks.' },
  ],
});

describe('who may ask', () => {
  it('refuses an unauthenticated caller', async () => {
    const response = await request(makeApp()).post(IDEAS_PATH);

    expect(response.status).toBe(401);
  });

  // The tenant boundary: another account's scan is indistinguishable from one
  // that does not exist, and nothing is generated for it.
  it('answers 404 for a scan the caller does not own', async () => {
    const prisma = {
      scan: { findFirst: vi.fn().mockResolvedValue(null) },
      siteProfile: { findUnique: vi.fn() },
      session: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ accountId: OTHER_ACCOUNT_ID, expiresAt: new Date('2099-01-01') }),
      },
    } as unknown as PrismaClient;
    const app = express();
    app.use(express.json());
    app.use(
      queryIdeasRouter({
        prisma,
        now: () => new Date(),
        logger: silentLogger,
        createProvider: () => providerReturning(GOOD_ANSWER),
      }),
    );
    app.use(errorHandler(silentLogger));

    const response = await authed(request(app).post(IDEAS_PATH));

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('is a POST, so opening a report never spends on the provider by itself', async () => {
    const response = await authed(request(makeApp()).get(IDEAS_PATH));

    expect(response.status).toBe(404);
  });

  it('stops an account that asks in a loop', async () => {
    const limiter = new RequestRateLimiter();
    const app = makeApp({ provider: providerReturning(GOOD_ANSWER), limiter });

    for (let attempt = 0; attempt < AI_IDEAS_LIMIT; attempt += 1) {
      expect((await authed(request(app).post(IDEAS_PATH))).status).toBe(200);
    }
    const blocked = await authed(request(app).post(IDEAS_PATH));

    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });
});

describe('what comes back', () => {
  it('returns validated ideas with the model that wrote them', async () => {
    const response = await authed(
      request(makeApp({ provider: providerReturning(GOOD_ANSWER) })).post(IDEAS_PATH),
    );

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.state).toBe('generated');
    expect(response.body.data.model).toBe('claude-sonnet-5');
    expect(response.body.data.generatedAt).toBe('2026-09-08T12:00:00.000Z');
    expect(response.body.data.ideas.map((idea: { language: string }) => idea.language)).toEqual([
      'ru',
      'uk',
      'en',
    ]);
  });

  // The whole point of the block: an idea is a query and a reason. No count, no
  // position, nothing shaped like a Search Console row.
  it('never returns anything shaped like a measurement', async () => {
    const response = await authed(
      request(
        makeApp({
          provider: providerReturning(
            JSON.stringify({
              ideas: [
                {
                  query: 'website audit tool',
                  language: 'en',
                  rationale: 'Adjacent.',
                  clicks: 500,
                  impressions: 9000,
                  position: 1.2,
                },
              ],
            }),
          ),
        }),
      ).post(IDEAS_PATH),
    );

    expect(response.body.data.ideas).toEqual([
      { query: 'website audit tool', language: 'en', rationale: 'Adjacent.' },
    ]);
  });

  it('says the deployment has no provider instead of failing', async () => {
    const response = await authed(request(makeApp({ provider: null })).post(IDEAS_PATH));

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ state: 'not_configured' });
  });

  it('says there is nothing to work from when the scan read no Search Console data', async () => {
    const noData = scanRow({
      modules: [
        {
          module: 'Analytics',
          runtimeStatus: 'Unavailable',
          metadataJson: JSON.stringify({
            ...SNAPSHOT,
            searchConsole: { state: 'not_connected', detail: 'x', data: null },
          }),
        },
      ],
    });
    const response = await authed(
      request(makeApp({ scan: noData, provider: providerReturning(GOOD_ANSWER) })).post(IDEAS_PATH),
    );

    expect(response.body.data).toEqual({ state: 'unavailable' });
  });

  it('says the same for a plan that never ran the Analytics module at all', async () => {
    const response = await authed(
      request(
        makeApp({ scan: scanRow({ modules: [] }), provider: providerReturning(GOOD_ANSWER) }),
      ).post(IDEAS_PATH),
    );

    expect(response.body.data).toEqual({ state: 'unavailable' });
  });

  it('survives an Analytics row whose metadata is not a Google snapshot', async () => {
    const response = await authed(
      request(
        makeApp({
          scan: scanRow({
            modules: [
              { module: 'Analytics', runtimeStatus: 'Completed', metadataJson: 'not json at all' },
            ],
          }),
          provider: providerReturning(GOOD_ANSWER),
        }),
      ).post(IDEAS_PATH),
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ state: 'unavailable' });
  });

  it('reports a model that answered nothing usable as empty', async () => {
    const response = await authed(
      request(makeApp({ provider: providerReturning('No thanks.') })).post(IDEAS_PATH),
    );

    expect(response.body.data).toEqual({ state: 'empty' });
  });

  it('degrades to failed without echoing the provider’s own message', async () => {
    const exploding: AiProvider = {
      config: providerReturning('').config,
      send: () => Promise.reject(new Error('Anthropic HTTP 401 key sk-live-abcdef')),
    };
    const response = await authed(request(makeApp({ provider: exploding })).post(IDEAS_PATH));

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ state: 'failed' });
    expect(JSON.stringify(response.body)).not.toMatch(/sk-live|401|Anthropic/);
  });
});
