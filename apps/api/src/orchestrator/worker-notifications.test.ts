import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startFixtureSite, type FixtureSite } from '@fluxradar/crawler';

import { createApp } from '../index.ts';
import { silentLogger } from '../http/logger.ts';
import { MockMailer } from '../email/mailer.ts';
import { createTestDb, TEST_WEBHOOK_SECRET, type TestDb } from '../test-utils/test-db.ts';
import { createDefaultAiProvider } from './geo.ts';
import { processPendingJobs } from './worker.ts';

// A scan's own progress is not mailed. It runs in about two minutes with the
// workspace open in front of the owner, so "started", "completed" and "failed"
// arrived after they had already seen the result; only money is mailed now.
//
// `ScanNotificationKind` is the compile-time half of that rule. This is the
// half that notices a sender being wired back into the worker — a `kind` the
// union still allows, sent from a place nothing else asserts about.

/** Every scan notification's subject opens with this; the auth mails do not. */
const NOTIFICATION_SUBJECT_PREFIX = 'FluxRadar: ';

describe('what a scan mails while it runs', () => {
  let db: TestDb;
  let fixture: FixtureSite;
  let mailer: MockMailer;

  beforeAll(async () => {
    fixture = await startFixtureSite();
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    db = await createTestDb();
    mailer = new MockMailer();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  /** The mail the scan sent, without the verification message registration sends. */
  function notificationSubjects(): readonly string[] {
    return mailer.messages
      .map((message) => message.subject)
      .filter((subject) => subject.startsWith(NOTIFICATION_SUBJECT_PREFIX));
  }

  function makeApp() {
    return createApp({
      prisma: db.prisma,
      webhookSecret: TEST_WEBHOOK_SECRET,
      autoProcess: false,
      logger: silentLogger,
      mailer,
    });
  }

  async function runQueuedScans(): Promise<void> {
    await processPendingJobs({
      prisma: db.prisma,
      logger: silentLogger,
      mailer,
      createAiProvider: (scan, siteProfile) =>
        createDefaultAiProvider(siteProfile.name, new URL(scan.domain).hostname),
      crawl: { originOverride: () => fixture.origin, dangerouslyAllowLoopback: true },
    });
  }

  async function registeredAgent(email: string) {
    const app = makeApp();
    const agent = request.agent(app);
    const registered = await agent
      .post('/auth/register')
      .send({ email, password: 'correct-horse-1' });
    expect(registered.status).toBe(201);
    const cookie = registered.headers['set-cookie']?.[0]?.split(';', 1)[0];
    if (cookie === undefined) throw new Error('registration did not set a session cookie');
    const profile = await agent
      .post('/profiles')
      .set('Cookie', cookie)
      .send({ name: 'Fixture Site', domain: 'https://example.com' });
    expect(profile.status).toBe(201);
    return { agent, cookie, profileId: profile.body.data.id as string };
  }

  it('mails nothing at all for a free check that runs to completion', async () => {
    const { agent, cookie, profileId } = await registeredAgent('free-mail@example.com');
    const created = await agent
      .post(`/profiles/${profileId}/free-check`)
      .set('Cookie', cookie)
      .send({});
    expect(created.status).toBe(201);

    await runQueuedScans();
    // Every notification is fire-and-forget, so absence is only meaningful once
    // a sender would have had its turn. It claims its row before it sends, so
    // the table answers the same question even if delivery itself were slow.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const scan = await db.prisma.scan.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(scan.status).not.toBe('Pending');
    expect(notificationSubjects()).toEqual([]);
    expect(await db.prisma.emailNotification.count()).toBe(0);
  });

  it('mails the confirmed purchase and nothing else for a paid scan', async () => {
    const { agent, cookie, profileId } = await registeredAgent('paid-mail@example.com');
    const checkout = await agent
      .post('/billing/dev-checkout')
      .set('Cookie', cookie)
      .send({
        siteProfileId: profileId,
        plan: 'Basic',
        scope: { includeSubdomains: false, maxPages: 5 },
      });
    expect(checkout.status).toBe(201);

    await runQueuedScans();

    // The purchase mail is sent from the checkout route without being awaited.
    await vi.waitFor(() => {
      expect(notificationSubjects()).toEqual(['FluxRadar: purchase confirmed']);
    });
    expect(await db.prisma.emailNotification.count()).toBe(1);
  });
});
