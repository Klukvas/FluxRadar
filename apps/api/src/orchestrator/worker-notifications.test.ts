import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFixtureSite, type FixtureSite } from '@fluxradar/crawler';

import { createApp } from '../index.ts';
import { silentLogger } from '../http/logger.ts';
import { MockMailer } from '../email/mailer.ts';
import { fakePerformanceRunner } from '../test-utils/performance-fixtures.ts';
import { purchaseScan } from '../test-utils/purchase-scan.ts';
import { createTestDb, type TestDb } from '../test-utils/test-db.ts';
import { createDefaultAiProvider } from './geo.ts';
import { processPendingJobs, processScan } from './worker.ts';

// FluxRadar mails account messages only: verification and password reset.
//
// The money conversation belongs to the payment provider. Creem sends the buyer
// their own receipt, and a refund only becomes money when it is issued from the
// Creem dashboard — so the `purchase_confirmed` message this API used to send
// said the same thing a second time, and `refund_created` announced a payout
// that had not happened. Both senders are gone, together with the outbox they
// queued into; the EmailNotification table is kept for its history alone and
// nothing reads it any more.
//
// A scan's own progress was never mailed either: it runs in about two minutes
// with the workspace open in front of the owner.
//
// This file is the half of that rule a type cannot state — the money paths run
// end to end here, and it fails the moment a sender is wired back in.

/** Every scan notification's subject opened with this; the auth mails do not. */
const NOTIFICATION_SUBJECT_PREFIX = 'FluxRadar: ';

/**
 * The challenge Cloudflare serves in front of a site that has blocked us.
 *
 * The same 403-to-everything site as `blocked-site.test.ts`, which is where
 * what it resolves to — Failed with a full refund — is actually pinned. Here it
 * is only the cheapest way to make a *paid* scan produce a refund record.
 */
function challengeFetcher() {
  return async (url: string) => ({
    finalUrl: url,
    status: 403,
    headers: {
      'content-type': 'text/html; charset=UTF-8',
      server: 'cloudflare',
      'cf-mitigated': 'challenge',
      'cf-ray': '8f2c1d0e4a2b0000',
    },
    body:
      '<html><head><title>Attention Required! | Cloudflare</title></head>' +
      '<body><h1>Sorry, you have been blocked</h1></body></html>',
    redirectChain: [],
    timingMs: 12,
    truncated: false,
  });
}

describe('what the money paths mail', () => {
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

  /** The mail a scan sent, without the account messages registration sends. */
  function notificationSubjects(): readonly string[] {
    return mailer.messages
      .map((message) => message.subject)
      .filter((subject) => subject.startsWith(NOTIFICATION_SUBJECT_PREFIX));
  }

  function makeApp(internalFreeEmails?: ReadonlySet<string>) {
    return createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
      mailer,
      ...(internalFreeEmails === undefined ? {} : { internalFreeEmails }),
    });
  }

  async function runQueuedScans(): Promise<void> {
    await processPendingJobs({
      prisma: db.prisma,
      logger: silentLogger,
      createAiProvider: (scan, siteProfile) =>
        createDefaultAiProvider(siteProfile.name, new URL(scan.domain).hostname),
      crawl: { originOverride: () => fixture.origin, dangerouslyAllowLoopback: true },
    });
  }

  async function registeredAgent(email: string, internalFreeEmails?: ReadonlySet<string>) {
    const app = makeApp(internalFreeEmails);
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

  /** The verification message registration sends, which must keep arriving. */
  function verificationSubjects(): readonly string[] {
    return mailer.messages
      .map((message) => message.subject)
      .filter((subject) => subject === 'Verify your FluxRadar email');
  }

  it('mails nothing at all for a free check that runs to completion', async () => {
    const { agent, cookie, profileId } = await registeredAgent('free-mail@example.com');
    const created = await agent
      .post(`/profiles/${profileId}/free-check`)
      .set('Cookie', cookie)
      .send({});
    expect(created.status).toBe(201);

    await runQueuedScans();
    // A sender used to be fire-and-forget, so absence is only meaningful once
    // one would have had its turn. It claimed its row before sending, so the
    // table answers the same question even if delivery itself were slow.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const scan = await db.prisma.scan.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(scan.status).not.toBe('Pending');
    expect(notificationSubjects()).toEqual([]);
    expect(await db.prisma.emailNotification.count()).toBe(0);
    expect(verificationSubjects()).toEqual(['Verify your FluxRadar email']);
  });

  it('runs a paid scan without confirming the purchase by email', async () => {
    const email = 'paid-mail@example.com';
    // The internal free-access checkout is the paid-plan path this suite can
    // drive end to end: it creates a paid-plan scan through the app — and
    // therefore through the app's mailer — without a provider order.
    const { agent, cookie, profileId } = await registeredAgent(email, new Set([email]));
    const checkout = await agent
      .post('/billing/internal-checkout')
      .set('Cookie', cookie)
      .send({
        siteProfileId: profileId,
        plan: 'Basic',
        scope: { includeSubdomains: false, maxPages: 5 },
      });
    expect(checkout.status).toBe(201);
    const scanId = checkout.body.data.scanId as string;

    await runQueuedScans();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The purchase still happened: the scan was created and it ran.
    const scan = await db.prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
    expect(scan.plan).toBe('Basic');
    expect(scan.status).not.toBe('Pending');
    expect(notificationSubjects()).toEqual([]);
    expect(await db.prisma.emailNotification.count()).toBe(0);
    expect(verificationSubjects()).toEqual(['Verify your FluxRadar email']);
  });

  it('leaves a notification queued before the senders were removed undelivered', async () => {
    const email = 'queued-mail@example.com';
    const { agent, cookie, profileId } = await registeredAgent(email, new Set([email]));
    const account = await db.prisma.account.findUniqueOrThrow({ where: { email } });
    const checkout = await agent
      .post('/billing/internal-checkout')
      .set('Cookie', cookie)
      .send({
        siteProfileId: profileId,
        plan: 'Basic',
        scope: { includeSubdomains: false, maxPages: 5 },
      });
    expect(checkout.status).toBe(201);
    const scanId = checkout.body.data.scanId as string;
    // A row the old outbox left behind: due, unsent, and still pointing at a
    // scan that exists. Nothing may pick it up.
    const stranded = await db.prisma.emailNotification.create({
      data: {
        accountId: account.id,
        eventKey: `purchase_confirmed:${scanId}`,
        kind: 'purchase_confirmed',
        detail: 'Your paid audit is ready to run.',
        status: 'queued',
        nextAttemptAt: new Date(Date.now() - 60_000),
      },
    });

    await runQueuedScans();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const after = await db.prisma.emailNotification.findUniqueOrThrow({
      where: { id: stranded.id },
    });
    expect(after.status).toBe('queued');
    expect(after.attemptCount).toBe(0);
    expect(after.sentAt).toBeNull();
    expect(notificationSubjects()).toEqual([]);
  });

  it('refunds a failed paid scan without mailing the refund', async () => {
    const { profileId } = await registeredAgent('refund-mail@example.com');
    const { scanId, purchaseId } = await purchaseScan(db.prisma, {
      siteProfileId: profileId,
      plan: 'Complete',
      scope: {},
    });

    const result = await processScan(
      {
        prisma: db.prisma,
        logger: silentLogger,
        createAiProvider: (scan, siteProfile) =>
          createDefaultAiProvider(siteProfile.name, new URL(scan.domain).hostname),
        // PSI asks Google, not the site, so Performance measures a blocked site
        // perfectly well. Without this the scan would fail because nothing ran,
        // rather than because nothing was read (blocked-site.test.ts).
        createPerformanceRunner: () =>
          fakePerformanceRunner({ score: 87, fetchedAt: '2026-09-21T00:00:00.000Z' }),
        crawl: { dangerouslyAllowLoopback: true, fetcher: challengeFetcher() },
      },
      scanId,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The refund behaviour is untouched: the record is still written, and it is
    // still what the run reports back.
    expect(result.outcome).toBe('Failed');
    expect(result.refundId).not.toBeNull();
    await expect(
      db.prisma.refundRecord.findUniqueOrThrow({ where: { purchaseId } }),
    ).resolves.toMatchObject({ purchaseId });
    expect(notificationSubjects()).toEqual([]);
    expect(await db.prisma.emailNotification.count()).toBe(0);
  });
});
