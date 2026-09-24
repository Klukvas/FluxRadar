// Buying a Website Audit, end to end, through the paths that decide money.
//
// The plan is new; the machinery is not. What is worth proving is that the new
// plan goes through the SAME signed-order, exactly-once, amount-checked path as
// the two that existed — and that nothing about adding it loosened that path for
// an order naming the wrong product or the wrong amount.

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TARIFFS } from '@fluxradar/contracts';

import { createApp } from '../index.ts';
import { silentLogger } from '../http/logger.ts';
import { PURCHASE_STATUSES } from './constants.ts';
import { createTestDb, type TestDb } from '../test-utils/test-db.ts';
import {
  deliverOrder,
  openCheckout,
  productPathFor,
  purchaseScan,
} from '../test-utils/purchase-scan.ts';

const WEBSITE_AUDIT_PRODUCT = productPathFor('WebsiteAudit');

describe('buying a Website Audit', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  function makeApp() {
    return createApp({ prisma: db.prisma, autoProcess: false, logger: silentLogger });
  }

  async function buyer(app: ReturnType<typeof makeApp>, email: string) {
    const agent = request.agent(app);
    const registered = await agent
      .post('/auth/register')
      .send({ email, password: 'correct-horse-1' });
    expect(registered.status).toBe(201);
    const cookie = registered.headers['set-cookie']?.[0]?.split(';', 1)[0] ?? '';
    const profile = await agent
      .post('/profiles')
      .set('Cookie', cookie)
      .send({ name: 'Fixture Site', domain: `https://${email.split('@')[0]}.example.com` });
    expect(profile.status).toBe(201);
    return { agent, cookie, profileId: profile.body.data.id as string };
  }

  it('creates one paid scan of the plan that was bought, at the catalogue price', async () => {
    const app = makeApp();
    const { profileId } = await buyer(app, 'wa-buyer@example.com');
    const { scanId, purchaseId } = await purchaseScan(db.prisma, {
      siteProfileId: profileId,
      plan: 'WebsiteAudit',
      scope: { maxPages: 200 },
    });

    const scan = await db.prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
    const purchase = await db.prisma.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
    expect(scan.plan).toBe('WebsiteAudit');
    expect(purchase.plan).toBe('WebsiteAudit');
    expect(purchase.amountUsd).toBe(TARIFFS.WebsiteAudit.priceUsd);
    expect(purchase.amountUsd).toBe(79);
    expect(purchase.status).toBe(PURCHASE_STATUSES.paid);
  });

  it('opens a checkout for the plan and settles it exactly once', async () => {
    const app = makeApp();
    const { profileId } = await buyer(app, 'wa-once@example.com');
    const opened = await openCheckout(db.prisma, {
      siteProfileId: profileId,
      plan: 'WebsiteAudit',
      scope: { maxPages: 15 },
    });

    const first = await deliverOrder(db.prisma, {
      reference: opened.reference,
      productPath: WEBSITE_AUDIT_PRODUCT,
      amount: 79,
    });
    expect(first.createdScanIds).toHaveLength(1);

    // The same signed delivery again: a provider retry, not a second sale.
    const replayed = await deliverOrder(db.prisma, {
      reference: opened.reference,
      productPath: WEBSITE_AUDIT_PRODUCT,
      amount: 79,
      orderId: first.orderId,
      eventId: first.eventId,
    });
    expect(replayed.createdScanIds).toHaveLength(0);
    expect(await db.prisma.scan.count({ where: { plan: 'WebsiteAudit' } })).toBe(1);
    expect(await db.prisma.purchase.count()).toBe(1);
  });

  it('refuses an order that names another product for this session', async () => {
    const app = makeApp();
    const { profileId } = await buyer(app, 'wa-product@example.com');
    const opened = await openCheckout(db.prisma, {
      siteProfileId: profileId,
      plan: 'WebsiteAudit',
      scope: { maxPages: 15 },
    });

    const delivered = await deliverOrder(db.prisma, {
      reference: opened.reference,
      productPath: 'fluxradar-complete-scan',
      amount: 79,
    });
    expect(delivered.createdScanIds).toHaveLength(0);
    expect(await db.prisma.scan.count()).toBe(0);
    expect(await db.prisma.purchase.count()).toBe(0);
  });

  it('refuses an order that underpays the plan', async () => {
    const app = makeApp();
    const { profileId } = await buyer(app, 'wa-amount@example.com');
    const opened = await openCheckout(db.prisma, {
      siteProfileId: profileId,
      plan: 'WebsiteAudit',
      scope: { maxPages: 15 },
    });

    const delivered = await deliverOrder(db.prisma, {
      reference: opened.reference,
      productPath: WEBSITE_AUDIT_PRODUCT,
      // The Basic price against the Website Audit product: the amount is real
      // money somebody paid, and it is not this plan's money.
      amount: 55,
    });
    expect(delivered.createdScanIds).toHaveLength(0);
    expect(await db.prisma.scan.count()).toBe(0);
  });

  it('revokes the report when the payment comes back, like any other plan', async () => {
    const app = makeApp();
    const { agent, cookie, profileId } = await buyer(app, 'wa-refund@example.com');
    const { scanId, purchaseId } = await purchaseScan(db.prisma, {
      siteProfileId: profileId,
      plan: 'WebsiteAudit',
      scope: { maxPages: 15 },
    });
    await db.prisma.scan.update({
      where: { id: scanId },
      data: { status: 'Completed', completedAt: new Date(), startedAt: new Date() },
    });

    const before = await agent.get(`/scans/${scanId}`).set('Cookie', cookie);
    expect(before.status).toBe(200);

    await db.prisma.purchase.update({
      where: { id: purchaseId },
      data: { status: PURCHASE_STATUSES.refunded },
    });
    await db.prisma.entitlement.updateMany({
      where: { purchaseId },
      data: { suspended: true },
    });

    for (const path of [
      `/scans/${scanId}`,
      `/scans/${scanId}/dashboard`,
      `/scans/${scanId}/export?format=json`,
    ]) {
      const response = await agent.get(path).set('Cookie', cookie);
      expect(response.status).toBe(403);
    }
  });

  it('unlocks the full scan history, the way Complete does', async () => {
    const app = makeApp();
    const { agent, cookie, profileId } = await buyer(app, 'wa-history@example.com');
    await purchaseScan(db.prisma, {
      siteProfileId: profileId,
      plan: 'WebsiteAudit',
      scope: { maxPages: 15 },
    });

    const history = await agent.get('/scans?history=true').set('Cookie', cookie);
    expect(history.status).toBe(200);
  });

  it('still shows a Basic-only account its current result alone', async () => {
    const app = makeApp();
    const { agent, cookie, profileId } = await buyer(app, 'wa-basic-history@example.com');
    await purchaseScan(db.prisma, {
      siteProfileId: profileId,
      plan: 'Basic',
      scope: { maxPages: 15 },
    });

    const history = await agent.get('/scans?history=true').set('Cookie', cookie);
    expect(history.status).toBe(403);
    expect(history.body.error.code).toBe('HISTORY_REQUIRES_COMPLETE');
  });
});
