import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RULESET_VERSION } from '@fluxradar/contracts';

import { PURCHASE_STATUSES } from '../billing/constants.ts';
import { FASTSPRING_PROVIDER } from '../billing/fastspring/config.ts';
import {
  createTestDb,
  seedAccountWithProfile,
  seedScan,
  type SeededAccount,
  type TestDb,
} from '../test-utils/test-db.ts';
import { MockMailer } from './mailer.ts';
import { notifyScanEvent, type ScanNotificationKind } from './notifications.ts';

// Regression: a FastSpring test-mode production E2E run mailed real
// "purchase confirmed", "scan started" and "scan completed" emails. Test-mode
// FastSpring purchases stay silent; every other scan keeps its notifications.

const PAID_FLOW_KINDS: readonly ScanNotificationKind[] = [
  'purchase_confirmed',
  'scan_started',
  'scan_completed',
];
const PAID_FLOW_SUBJECTS = [
  'FluxRadar: purchase confirmed',
  'FluxRadar: scan started',
  'FluxRadar: scan completed',
];
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

  /** A FastSpring-paid scan; `checkout: null` models a purchase whose session row is gone. */
  async function seedFastSpringScan(checkout: { liveMode: boolean } | null): Promise<string> {
    const purchase = await db.prisma.purchase.create({
      data: {
        accountId: account.accountId,
        siteProfileId: account.siteProfileId,
        plan: 'Basic',
        provider: FASTSPRING_PROVIDER,
        providerTransactionId: `ord_${randomUUID()}`,
        amountUsd: BASIC_PRICE,
        currency: 'USD',
        status: PURCHASE_STATUSES.paid,
      },
    });
    if (checkout !== null) {
      await db.prisma.checkoutSession.create({
        data: {
          provider: FASTSPRING_PROVIDER,
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

  it('sends nothing and claims no event for a FastSpring test-mode purchase', async () => {
    const scanId = await seedFastSpringScan({ liveMode: false });

    await notifyPaidFlow(scanId);

    expect(mailer.messages).toEqual([]);
    expect(await db.prisma.emailNotification.count()).toBe(0);
  });

  it('still mails every paid-flow event for a FastSpring live-mode purchase', async () => {
    const scanId = await seedFastSpringScan({ liveMode: true });

    await notifyPaidFlow(scanId);

    expect(mailer.messages.map((message) => message.subject)).toEqual(PAID_FLOW_SUBJECTS);
    expect(await db.prisma.emailNotification.count()).toBe(PAID_FLOW_KINDS.length);
  });

  it('still mails a FastSpring purchase whose checkout session no longer exists', async () => {
    const scanId = await seedFastSpringScan(null);

    await notifyPaidFlow(scanId);

    expect(mailer.messages.map((message) => message.subject)).toEqual(PAID_FLOW_SUBJECTS);
  });

  it('still mails a Free scan without a purchase', async () => {
    const { scan } = await seedScan(db.prisma, {
      account,
      status: 'Pending',
      plan: 'Free',
      withPurchase: false,
    });

    await notifyPaidFlow(scan.id);

    expect(mailer.messages.map((message) => message.subject)).toEqual(PAID_FLOW_SUBJECTS);
  });

  it('still mails a legacy Paddle purchase', async () => {
    const { scan, purchase } = await seedScan(db.prisma, { account, status: 'Pending' });
    expect(purchase?.provider).toBe('paddle');

    await notifyPaidFlow(scan.id);

    expect(mailer.messages.map((message) => message.subject)).toEqual(PAID_FLOW_SUBJECTS);
  });
});
