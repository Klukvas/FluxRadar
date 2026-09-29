import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RULESET_VERSION } from '@fluxradar/contracts';

import { PURCHASE_STATUSES } from '../billing/constants.ts';
import { CREEM_PROVIDER } from '../billing/creem/config.ts';
import {
  createTestDb,
  seedAccountWithProfile,
  seedScan,
  type SeededAccount,
  type TestDb,
} from '../test-utils/test-db.ts';
import type { EmailMessage, Mailer } from './mailer.ts';
import { MockMailer } from './mailer.ts';
import {
  deliverDueScanNotifications,
  notifyScanEvent,
  type ScanNotificationKind,
} from './notifications.ts';

// Regression: a Creem test-mode production E2E run mailed real money emails
// for an order nobody paid. Test-mode Creem purchases stay silent; every
// other scan keeps its notifications.

const PAID_FLOW_KINDS: readonly ScanNotificationKind[] = ['purchase_confirmed', 'refund_created'];
const PAID_FLOW_SUBJECTS = ['FluxRadar: purchase confirmed', 'FluxRadar: refund created'];
const BASIC_PRODUCT = 'fluxradar-basic-scan';
const BASIC_PRICE = 55;

describe('scan notifications by purchase mode', () => {
  let db: TestDb;
  let account: SeededAccount;
  let mailer: MockMailer;

  beforeEach(async () => {
    db = await createTestDb();
    account = await seedAccountWithProfile(db.prisma);
    mailer = new MockMailer();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  /** A Creem-paid scan; `checkout: null` models a purchase whose session row is gone. */
  async function seedCreemScan(
    checkout: { liveMode: boolean } | null,
    provider: string = CREEM_PROVIDER,
  ): Promise<string> {
    const purchase = await db.prisma.purchase.create({
      data: {
        accountId: account.accountId,
        siteProfileId: account.siteProfileId,
        plan: 'Basic',
        provider,
        providerTransactionId: `ord_${randomUUID()}`,
        amountUsd: BASIC_PRICE,
        currency: 'USD',
        status: PURCHASE_STATUSES.paid,
      },
    });
    if (checkout !== null) {
      await db.prisma.checkoutSession.create({
        data: {
          provider,
          reference: `frcs_${randomUUID()}`,
          accountId: account.accountId,
          siteProfileId: account.siteProfileId,
          plan: 'Basic',
          productPath: BASIC_PRODUCT,
          expectedAmountUsd: BASIC_PRICE,
          liveMode: checkout.liveMode,
          status: 'completed',
          scopeJson: JSON.stringify({ includeSubdomains: false, maxPages: 12 }),
          purchaseId: purchase.id,
        },
      });
    }
    const scan = await db.prisma.scan.create({
      data: {
        purchaseId: purchase.id,
        accountId: account.accountId,
        siteProfileId: account.siteProfileId,
        plan: 'Basic',
        domain: account.domain,
        status: 'Pending',
        scopeJson: JSON.stringify({ includeSubdomains: false }),
        rulesetVersion: RULESET_VERSION,
      },
    });
    return scan.id;
  }

  async function notifyPaidFlow(scanId: string): Promise<void> {
    for (const kind of PAID_FLOW_KINDS) {
      await notifyScanEvent(db.prisma, mailer, scanId, kind, `detail for ${kind}`);
    }
  }

  it('sends nothing and claims no event for a Creem test-mode purchase', async () => {
    const scanId = await seedCreemScan({ liveMode: false });

    await notifyPaidFlow(scanId);

    expect(mailer.messages).toEqual([]);
    expect(await db.prisma.emailNotification.count()).toBe(0);
  });

  it('still mails every paid-flow event for a Creem live-mode purchase', async () => {
    const scanId = await seedCreemScan({ liveMode: true });

    await notifyPaidFlow(scanId);

    expect(mailer.messages.map((message) => message.subject)).toEqual(PAID_FLOW_SUBJECTS);
    expect(await db.prisma.emailNotification.count()).toBe(PAID_FLOW_KINDS.length);
  });

  it('still mails a Creem purchase whose checkout session no longer exists', async () => {
    const scanId = await seedCreemScan(null);

    await notifyPaidFlow(scanId);

    expect(mailer.messages.map((message) => message.subject)).toEqual(PAID_FLOW_SUBJECTS);
  });

  // A Free scan has neither a purchase nor a refund, so in production it
  // receives none of these messages. What is under test is the silencer's
  // decision, and that decision reads the purchase, not the kind: a scan with
  // no purchase row at all must not be mistaken for a test-mode order.
  it('silences nothing for a scan that has no purchase at all', async () => {
    const { scan } = await seedScan(db.prisma, {
      account,
      status: 'Pending',
      plan: 'Free',
      withPurchase: false,
    });

    await notifyPaidFlow(scan.id);

    expect(mailer.messages.map((message) => message.subject)).toEqual(PAID_FLOW_SUBJECTS);
  });

  it('sends nothing and claims no event for a historical FastSpring test-mode purchase', async () => {
    // Production still holds Purchase rows from FastSpring test-mode E2E runs;
    // the silencer keys off the checkout's liveMode, not the provider, so a
    // retired provider's test-mode order stays as silent as a Creem one.
    const scanId = await seedCreemScan({ liveMode: false }, 'fastspring');

    await notifyPaidFlow(scanId);

    expect(mailer.messages).toEqual([]);
    expect(await db.prisma.emailNotification.count()).toBe(0);
  });

  it('still mails a purchase from a provider no longer in use (e.g. a retired fastspring row)', async () => {
    const { scan, purchase } = await seedScan(db.prisma, { account, status: 'Pending' });
    await db.prisma.purchase.update({
      where: { id: purchase?.id ?? '' },
      data: { provider: 'fastspring' },
    });

    await notifyPaidFlow(scan.id);

    expect(mailer.messages.map((message) => message.subject)).toEqual(PAID_FLOW_SUBJECTS);
  });
});

// Regression: the emails named the domain and one sentence, with no way back to
// the scan they were about — the owner had to find the report on their own.
describe('the way back to the scan', () => {
  let db: TestDb;
  let account: SeededAccount;
  let mailer: MockMailer;

  beforeEach(async () => {
    db = await createTestDb();
    account = await seedAccountWithProfile(db.prisma);
    mailer = new MockMailer();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it('links a paid scan to its page on the web app', async () => {
    // The lifecycle mails are gone (D-235); a purchase and a refund are the two
    // events left, and each still has to reach the scan it is about.
    const { scan } = await seedScan(db.prisma, { account, status: 'Completed' });

    await notifyScanEvent(
      db.prisma,
      mailer,
      scan.id,
      'purchase_confirmed',
      'Your audit is paid for.',
      'https://fluxradar.example/',
    );

    const [message] = mailer.messages;
    const url = `https://fluxradar.example/scans/${scan.id}`;
    expect(message?.html).toContain(`<a href="${url}">Follow the scan</a>`);
    expect(message?.text).toContain(`Follow the scan: ${url}`);
  });
});

describe('notification delivery queue', () => {
  let db: TestDb;
  let account: SeededAccount;

  beforeEach(async () => {
    db = await createTestDb();
    account = await seedAccountWithProfile(db.prisma);
  });

  afterEach(async () => {
    await db.cleanup();
  });

  it('retries a transient delivery failure after its backoff instead of losing the event', async () => {
    const { scan } = await seedScan(db.prisma, { account, status: 'Completed' });
    const messages: EmailMessage[] = [];
    let attempts = 0;
    const mailer: Mailer = {
      configured: true,
      async send(message) {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary provider outage');
        messages.push(message);
        return { status: 'sent', id: 'recovered' };
      },
    };
    const now = new Date('2026-09-29T10:00:00.000Z');

    await notifyScanEvent(
      db.prisma,
      mailer,
      scan.id,
      'purchase_confirmed',
      'Paid.',
      undefined,
      now,
    );

    const queued = await db.prisma.emailNotification.findUniqueOrThrow({
      where: { eventKey: `purchase_confirmed:${scan.id}` },
    });
    expect(queued.status).toBe('queued');
    expect(queued.attemptCount).toBe(1);
    expect(queued.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());

    await deliverDueScanNotifications(db.prisma, mailer, new Date(queued.nextAttemptAt));

    expect(messages).toHaveLength(1);
    await expect(
      db.prisma.emailNotification.findUniqueOrThrow({ where: { id: queued.id } }),
    ).resolves.toMatchObject({ status: 'sent', attemptCount: 2, sentAt: expect.any(Date) });
  });

  it('does not reclaim an expired lease after the bounded final attempt', async () => {
    const { scan } = await seedScan(db.prisma, { account, status: 'Completed' });
    const now = new Date('2026-09-29T10:00:00.000Z');
    const notification = await db.prisma.emailNotification.create({
      data: {
        accountId: account.accountId,
        eventKey: `purchase_confirmed:${scan.id}`,
        kind: 'purchase_confirmed',
        detail: 'Paid.',
        status: 'sending',
        attemptCount: 5,
        nextAttemptAt: now,
        leaseUntil: new Date(now.getTime() - 1),
      },
    });
    let sends = 0;
    const mailer: Mailer = {
      configured: true,
      async send() {
        sends += 1;
        return { status: 'sent', id: 'should-not-send' };
      },
    };

    await expect(deliverDueScanNotifications(db.prisma, mailer, now)).resolves.toBe(0);
    expect(sends).toBe(0);
    await expect(
      db.prisma.emailNotification.findUniqueOrThrow({ where: { id: notification.id } }),
    ).resolves.toMatchObject({ status: 'failed', attemptCount: 5 });
  });

  it('cannot settle a later worker claim after its own lease was replaced', async () => {
    const { scan } = await seedScan(db.prisma, { account, status: 'Completed' });
    const now = new Date('2026-09-29T10:00:00.000Z');
    const notification = await db.prisma.emailNotification.create({
      data: {
        accountId: account.accountId,
        eventKey: `purchase_confirmed:${scan.id}`,
        kind: 'purchase_confirmed',
        detail: 'Paid.',
        status: 'queued',
        nextAttemptAt: now,
      },
    });
    let releaseSend: (() => void) | undefined;
    let enteredSend: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enteredSend = resolve;
    });
    const mailer: Mailer = {
      configured: true,
      async send() {
        enteredSend?.();
        await new Promise<void>((resolve) => {
          releaseSend = resolve;
        });
        return { status: 'sent', id: 'first-worker' };
      },
    };

    const firstWorker = deliverDueScanNotifications(db.prisma, mailer, now);
    await entered;
    const secondLease = new Date(now.getTime() + 20 * 60_000);
    await db.prisma.emailNotification.update({
      where: { id: notification.id },
      data: { status: 'sending', attemptCount: 2, leaseUntil: secondLease },
    });
    releaseSend?.();

    await expect(firstWorker).resolves.toBe(0);
    await expect(
      db.prisma.emailNotification.findUniqueOrThrow({ where: { id: notification.id } }),
    ).resolves.toMatchObject({ status: 'sending', attemptCount: 2, leaseUntil: secondLease });
  });
});
