// The shared stand for the late Free AI preview's database tests (D-236): a
// real Free check launched with its AI box unticked and run to Completed
// against a local fixture site, an API bound to one listening server per test,
// and AI providers that record every request reaching a transport.

import type { Server } from 'node:http';

import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { CURRENT_AI_PROCESSING_NOTICE_VERSION } from '@fluxradar/ai';
import type { AiProvider, AiRequest } from '@fluxradar/ai';
import { startFixtureSite, type FixtureSite } from '@fluxradar/crawler';
import type { CrawlFetcher } from '@fluxradar/crawler';

import { createApp } from '../index.ts';
import { silentLogger } from '../http/logger.ts';
import { createDefaultAiProvider } from '../orchestrator/geo.ts';
import type { WorkerDeps } from '../orchestrator/deps.ts';
import { processScan } from '../orchestrator/worker.ts';
import { createTestDb, type TestDb } from './test-db.ts';

export type TestAgent = ReturnType<typeof request.agent>;

export const GEO = 'AI SEO / GEO';

export const CONSENT = {
  aiConsent: { providers: ['anthropic'], noticeVersion: CURRENT_AI_PROCESSING_NOTICE_VERSION },
};

/** Wraps the test-runtime fixture provider and records what reached it. */
export function recordingProviders(
  sent: AiRequest[],
  onSend?: (aiRequest: AiRequest) => void,
): WorkerDeps['createAiProvider'] {
  return (scan, profile) => {
    const inner = createDefaultAiProvider(profile.name, new URL(scan.domain).hostname);
    const provider: AiProvider = {
      config: inner.config,
      send: (aiRequest, promptText, signal) => {
        sent.push(aiRequest);
        onSend?.(aiRequest);
        return inner.send(aiRequest, promptText, signal);
      },
    };
    return provider;
  };
}

export interface Owner {
  readonly cookie: string;
  readonly accountId: string;
  readonly scanId: string;
  readonly profileId: string;
}

export interface WorkerOverrides {
  readonly fetcher?: CrawlFetcher;
  readonly probeEgress?: WorkerDeps['probeEgress'];
  readonly createAiProvider?: WorkerDeps['createAiProvider'];
}

export interface LateFreePreviewHarness {
  readonly db: () => TestDb;
  /** Every AI request that reached a (mock) transport in this test. */
  readonly sent: () => AiRequest[];
  readonly fixtureOrigin: () => string;
  workerDeps(overrides?: WorkerOverrides): WorkerDeps;
  app(allowedOrigins?: ReadonlySet<string>): TestAgent;
  register(agent: TestAgent, email: string): Promise<{ cookie: string; accountId: string }>;
  finishedUnconsentedFreeCheck(agent: TestAgent, email?: string): Promise<Owner>;
  press(agent: TestAgent, owner: Owner): request.Test;
  geoRow(scanId: string): ReturnType<TestDb['prisma']['scanModule']['findUniqueOrThrow']>;
}

/** Registers the suite hooks and returns the stand. Call once per describe. */
export function useLateFreePreviewHarness(): LateFreePreviewHarness {
  let fixture: FixtureSite;
  let db: TestDb;
  let sent: AiRequest[] = [];
  let servers: Server[] = [];

  beforeAll(async () => {
    fixture = await startFixtureSite();
  });
  afterAll(async () => {
    await fixture.close();
  });
  beforeEach(async () => {
    db = await createTestDb();
    sent = [];
    servers = [];
  });
  afterEach(async () => {
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await db.cleanup();
  });

  const workerDeps = (overrides: WorkerOverrides = {}): WorkerDeps => ({
    prisma: db.prisma,
    logger: silentLogger,
    createAiProvider: overrides.createAiProvider ?? recordingProviders(sent),
    ...(overrides.probeEgress === undefined ? {} : { probeEgress: overrides.probeEgress }),
    crawl: {
      originOverride: () => fixture.origin,
      dangerouslyAllowLoopback: true,
      ...(overrides.fetcher === undefined ? {} : { fetcher: overrides.fetcher }),
    },
  });

  // One listening server per app for the whole test. Handing supertest the
  // bare app makes it listen on a fresh ephemeral port for every request, and
  // with keep-alive sockets in the pool a request occasionally reached the
  // fixture site instead (an empty-bodied 404).
  const app = (allowedOrigins: ReadonlySet<string> = new Set()): TestAgent => {
    const server = createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
      freeCheckAllowedOrigins: allowedOrigins,
    }).listen(0, '127.0.0.1');
    servers.push(server);
    return request.agent(server);
  };

  const register = async (agent: TestAgent, email: string) => {
    const response = await agent
      .post('/auth/register')
      .send({ email, password: 'correct-horse-1' });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const cookie = response.headers['set-cookie']?.[0]?.split(';', 1)[0];
    if (cookie === undefined) throw new Error('registration did not set a session cookie');
    return { cookie, accountId: response.body.data.accountId as string };
  };

  const geoRow = (scanId: string) =>
    db.prisma.scanModule.findUniqueOrThrow({ where: { scanId_module: { scanId, module: GEO } } });

  const finishedUnconsentedFreeCheck = async (
    agent: TestAgent,
    email = 'owner@example.com',
  ): Promise<Owner> => {
    const owner = await register(agent, email);
    const profile = await agent
      .post('/profiles')
      .set('Cookie', owner.cookie)
      .send({ name: 'Fixture Site', domain: 'https://example.com' });
    expect(profile.status, JSON.stringify(profile.body)).toBe(201);
    const created = await agent
      .post(`/profiles/${profile.body.data.id as string}/free-check`)
      .set('Cookie', owner.cookie)
      .send({});
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const scanId = created.body.data.id as string;
    expect((await processScan(workerDeps(), scanId)).outcome).toBe('Completed');
    expect(await geoRow(scanId)).toMatchObject({
      runtimeStatus: 'Not applicable',
      statusReason: 'ConsentMissing',
    });
    expect(sent).toEqual([]);
    return { ...owner, scanId, profileId: profile.body.data.id as string };
  };

  const press = (agent: TestAgent, owner: Owner) =>
    agent.post(`/scans/${owner.scanId}/free-ai-preview`).set('Cookie', owner.cookie).send(CONSENT);

  return {
    db: () => db,
    sent: () => sent,
    fixtureOrigin: () => fixture.origin,
    workerDeps,
    app,
    register,
    finishedUnconsentedFreeCheck,
    press,
    geoRow,
  };
}
