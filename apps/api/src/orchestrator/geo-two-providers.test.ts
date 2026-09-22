// What a paid scan records when two providers answer its visibility questions.
//
// The module used to ask one vendor, so "which assistant said this" was never a
// question the report had to answer. Now it is: every request, every stored
// answer and every unavailable row has to name the provider it belongs to, and
// a customer who only consented to one of them has to get exactly that one.

import { CURRENT_AI_PROCESSING_NOTICE_VERSION } from '@fluxradar/ai';
import { startFixtureSite, type FixtureSite } from '@fluxradar/crawler';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteAccountData } from '../data-retention.ts';
import { silentLogger } from '../http/logger.ts';
import { createApp } from '../index.ts';
import { purchaseScan } from '../test-utils/purchase-scan.ts';
import { createTestDb, type TestDb } from '../test-utils/test-db.ts';
import { createDefaultAiProvider, GEO_VISIBILITY_PROVIDERS } from './geo.ts';
import { processScan } from './worker.ts';

type TestAgent = ReturnType<typeof request.agent>;

/** The notice the OpenAI questions were never disclosed under. */
const PREVIOUS_NOTICE_VERSION = 'core-ai-processing-notice-v3';

interface ScannedAccount {
  readonly accountId: string;
  readonly cookie: string;
  readonly scanId: string;
}

describe('a paid scan asked of two providers', () => {
  let fixture: FixtureSite;
  let db: TestDb;

  beforeAll(async () => {
    fixture = await startFixtureSite();
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.cleanup();
  });

  async function runPaidScan(
    email: string,
    consent: { providers: readonly string[]; noticeVersion: string },
  ): Promise<ScannedAccount> {
    const app = createApp({ prisma: db.prisma, autoProcess: false, logger: silentLogger });
    const agent: TestAgent = request.agent(app);
    const registration = await agent
      .post('/auth/register')
      .send({ email, password: 'correct-horse-1' });
    expect(registration.status).toBe(201);
    const cookie = registration.headers['set-cookie']?.[0]?.split(';', 1)[0] ?? '';
    // The profile carries context, so the discovery questions are generated and
    // each provider is asked more than the two fixed awareness questions.
    const profile = await agent.post('/profiles').set('Cookie', cookie).send({
      name: 'Fixture Site',
      domain: 'https://example.com',
      industry: 'Dental clinic',
      region: 'Kyiv',
      offerings: 'Implants and emergency appointments',
      targetAudience: 'Families looking for dental care',
      targetLanguages: 'Ukrainian, English',
    });
    expect(profile.status).toBe(201);
    const { scanId } = await purchaseScan(db.prisma, {
      siteProfileId: profile.body.data.id as string,
      plan: 'Basic',
      scope: { includeSubdomains: false, maxPages: 5 },
      aiConsent: {
        providers: consent.providers as ('anthropic' | 'openai')[],
        noticeVersion: consent.noticeVersion,
      },
    });
    await processScan(
      {
        prisma: db.prisma,
        logger: silentLogger,
        createAiProvider: (scan, siteProfile) =>
          createDefaultAiProvider(siteProfile.name, new URL(scan.domain).hostname),
        crawl: { originOverride: () => fixture.origin, dangerouslyAllowLoopback: true },
      },
      scanId,
    );
    return { accountId: registration.body.data.accountId as string, cookie, scanId };
  }

  async function geoModuleOf(scanId: string) {
    const module = await db.prisma.scanModule.findFirstOrThrow({
      where: { scanId, module: 'AI SEO / GEO' },
    });
    const metadata = JSON.parse(module.metadataJson ?? '{}') as {
      providerVisibility: {
        providers: readonly string[];
        webSearch: boolean;
        requests: readonly { provider: string; status: string; reason?: string }[];
      };
    };
    return { module, visibility: metadata.providerVisibility };
  }

  it('asks every question of both providers and stores both answers', async () => {
    const { scanId } = await runPaidScan('two-providers@example.com', {
      providers: ['anthropic', 'openai'],
      noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
    });

    const { module, visibility } = await geoModuleOf(scanId);
    expect(module.runtimeStatus).toBe('Completed');
    expect(visibility.providers).toEqual([...GEO_VISIBILITY_PROVIDERS]);
    expect(visibility.webSearch).toBe(true);

    const responses = await db.prisma.aiResponseRecord.findMany({ where: { scanId } });
    const byProvider = (provider: string) =>
      responses.filter((response) => response.provider === provider).length;
    // One generation request at Anthropic, then the same visibility questions
    // twice over: 1 + 2 × N, with N the same on both sides.
    expect(byProvider('openai')).toBeGreaterThan(0);
    expect(byProvider('anthropic')).toBe(byProvider('openai') + 1);
    expect(responses).toHaveLength(1 + 2 * byProvider('openai'));
    expect(visibility.requests.every((entry) => entry.status === 'response')).toBe(true);
  });

  it('gives a scan bought under the previous notice only the provider it disclosed', async () => {
    const { cookie, scanId } = await runPaidScan('v3-consent@example.com', {
      providers: ['anthropic'],
      noticeVersion: PREVIOUS_NOTICE_VERSION,
    });

    const { module, visibility } = await geoModuleOf(scanId);
    // The entitlement still runs, and it still runs honestly: half the answers
    // are missing and the module says so instead of quietly asking anyway.
    expect(module.runtimeStatus).toBe('Partial');
    const openAiRequests = visibility.requests.filter((entry) => entry.provider === 'openai');
    expect(openAiRequests.length).toBeGreaterThan(0);
    expect(openAiRequests.every((entry) => entry.reason === 'ConsentMissing')).toBe(true);
    expect(
      visibility.requests
        .filter((entry) => entry.provider === 'anthropic')
        .every((entry) => entry.status === 'response'),
    ).toBe(true);

    const responses = await db.prisma.aiResponseRecord.findMany({ where: { scanId } });
    expect(responses.every((response) => response.provider === 'anthropic')).toBe(true);

    // The report has to say who did not answer, and an unavailable row has no
    // ai_response record to read the provider from.
    const app = createApp({ prisma: db.prisma, autoProcess: false, logger: silentLogger });
    const dashboard = await request(app).get(`/scans/${scanId}/dashboard`).set('Cookie', cookie);
    expect(dashboard.status).toBe(200);
    const observations = dashboard.body.data.geoObservations as readonly {
      status: string;
      provider: string | null;
    }[];
    const unavailable = observations.filter((observation) => observation.status === 'unavailable');
    expect(unavailable.length).toBeGreaterThan(0);
    expect(unavailable.every((observation) => observation.provider === 'openai')).toBe(true);
  });

  it('deletes every stored answer of both providers with the account', async () => {
    const { accountId, scanId } = await runPaidScan('deleted@example.com', {
      providers: ['anthropic', 'openai'],
      noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION,
    });
    expect(await db.prisma.aiResponseRecord.count({ where: { scanId } })).toBeGreaterThan(1);

    await deleteAccountData(db.prisma, accountId);

    expect(await db.prisma.aiResponseRecord.count({ where: { scanId } })).toBe(0);
  });
});
