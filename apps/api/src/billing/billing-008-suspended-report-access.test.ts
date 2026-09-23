import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { computeFingerprint } from '@fluxradar/fingerprint';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../index.ts';
import { silentLogger } from '../http/logger.ts';
import { processScan } from '../orchestrator/worker.ts';
import { purchaseScan } from '../test-utils/purchase-scan.ts';
import { createTestDb, type TestDb } from '../test-utils/test-db.ts';
import { PURCHASE_STATUSES } from './constants.ts';

// BILLING-008: a refund takes the report back.
//
// A full return and a chargeback both suspend the entitlement, and the reason is
// written next to the code that does it: "a buyer whose money was returned must
// not keep the report the money paid for". Only the worker and the module retry
// ever asked. Every READ still served the report in full — the scan, its
// dashboard, its issues, their evidence, and the export that packages all of it
// into one downloadable file — so the suspension revoked nothing a customer
// could see, and a refunded buyer kept everything they had paid for.
//
// These tests drive the real HTTP surface end to end for each way access can be
// revoked, and they pin the two decisions that go the other way on purpose: a
// Free scan never had a purchase to return, and an entitlement that merely
// EXPIRED still reads (ENTITLEMENT_DAYS bounds what may still be bought — see
// billing/report-access.ts).

type TestAgent = ReturnType<typeof request.agent>;

const NOW = new Date('2026-09-07T12:00:00.000Z');

describe('BILLING-008 suspended entitlement and paid report access', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(async () => {
    await db.cleanup();
  });

  function makeApp() {
    return createApp({
      prisma: db.prisma,
      autoProcess: false,
      logger: silentLogger,
      now: () => NOW,
    });
  }

  async function register(agent: TestAgent, email: string): Promise<string> {
    const response = await agent
      .post('/auth/register')
      .send({ email, password: 'correct-horse-1' });
    expect(response.status).toBe(201);
    const cookie = response.headers['set-cookie']?.[0]?.split(';', 1)[0];
    if (cookie === undefined) throw new Error('registration did not set a session cookie');
    return cookie;
  }

  async function createProfile(agent: TestAgent, cookie: string, domain: string): Promise<string> {
    const response = await agent
      .post('/profiles')
      .set('Cookie', cookie)
      .send({ name: 'Fixture Site', domain });
    expect(response.status).toBe(201);
    return response.body.data.id as string;
  }

  /** One issue and one scored module, so every read path has something to leak. */
  async function seedReport(prisma: PrismaClient, scanId: string): Promise<string> {
    const scan = await prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
    const target = {
      ruleId: 'seo.title.missing',
      targetKind: 'page' as const,
      normalizedUrl: `${scan.domain}/`,
      normalizedResource: '',
      normalizedSelector: '',
      normalizedParameter: '',
      ruleVariant: 'default',
    };
    await prisma.scanModule.create({
      data: {
        scanId,
        module: 'SEO',
        runtimeStatus: 'Completed',
        coverage: 1,
        score: 74,
        applicableChecks: 10,
        completedApplicableChecks: 10,
        usableOutput: true,
      },
    });
    const issue = await prisma.issue.create({
      data: {
        scanId,
        module: 'SEO',
        // The export recomputes it and refuses the whole record set on a
        // mismatch, so the fixture stores what the product would have stored.
        fingerprint: computeFingerprint({ domain: scan.domain, ...target }),
        severity: 'High',
        category: 'SEO',
        status: 'New',
        ...target,
        targetUrl: `${scan.domain}/`,
        evidenceType: 'dom',
        evidenceExcerpt: '<title></title>',
        recommendation: 'Write a title',
        confidence: 1,
        applicableTargets: 1,
        affectedTargets: 1,
        // §15 recomputes both from severity and coverage; a fixture that
        // disagrees is rejected by the export's semantic pass, so these are the
        // values weight(High) x 1/1 actually produces.
        rulePenalty: 10,
        scoreDelta: -10,
        observedAt: NOW,
      },
    });
    await prisma.scan.update({
      where: { id: scanId },
      // The export refuses a scan with incomplete timestamps, so both are set:
      // this fixture has to be exportable for "the export is refused" to mean
      // the entitlement and not the fixture.
      data: {
        status: 'Completed',
        startedAt: new Date(NOW.getTime() - 60_000),
        completedAt: NOW,
      },
    });
    return issue.id;
  }

  interface PaidScan {
    readonly agent: TestAgent;
    readonly cookie: string;
    readonly scanId: string;
    readonly purchaseId: string;
    readonly issueId: string;
  }

  /** A Complete scan somebody paid for, finished, with a report to read. */
  async function paidScan(app: ReturnType<typeof makeApp>, email: string): Promise<PaidScan> {
    const agent = request.agent(app);
    const cookie = await register(agent, email);
    const profileId = await createProfile(agent, cookie, `https://${email.split('@')[0]}.example.com`);
    const { scanId, purchaseId } = await purchaseScan(db.prisma, {
      siteProfileId: profileId,
      plan: 'Complete',
      scope: { maxPages: 15 },
    });
    const issueId = await seedReport(db.prisma, scanId);
    return { agent, cookie, scanId, purchaseId, issueId };
  }

  /** Every read of the paid report, as the customer's browser would ask for it. */
  async function readReport(paid: PaidScan): Promise<Record<string, number>> {
    const get = async (path: string): Promise<number> =>
      (await paid.agent.get(path).set('Cookie', paid.cookie)).status;
    return {
      scan: await get(`/scans/${paid.scanId}`),
      dashboard: await get(`/scans/${paid.scanId}/dashboard`),
      issues: await get(`/scans/${paid.scanId}/issues`),
      issue: await get(`/scans/${paid.scanId}/issues/${paid.issueId}`),
      evidence: await get(`/scans/${paid.scanId}/issues/${paid.issueId}/evidence`),
      export: await get(`/scans/${paid.scanId}/export?format=json`),
      exportCsv: await get(`/scans/${paid.scanId}/export?format=csv`),
    };
  }

  const revocations: readonly {
    readonly name: string;
    readonly purchaseStatus: string;
    readonly suspended: boolean;
  }[] = [
    { name: 'a full refund', purchaseStatus: PURCHASE_STATUSES.refunded, suspended: true },
    { name: 'a chargeback', purchaseStatus: PURCHASE_STATUSES.disputed, suspended: true },
    // The two halves are written by different code paths and can be observed
    // apart (a chargeback with no entitlement row yet, an operator suspending by
    // hand), so either one alone has to be enough.
    { name: 'a suspension alone', purchaseStatus: PURCHASE_STATUSES.paid, suspended: true },
    {
      name: 'a refunded purchase whose entitlement was not suspended',
      purchaseStatus: PURCHASE_STATUSES.refunded,
      suspended: false,
    },
  ];

  for (const revocation of revocations) {
    it(`refuses every read of the report after ${revocation.name}`, async () => {
      const app = makeApp();
      const paid = await paidScan(
        app,
        `revoked-${revocation.purchaseStatus}-${revocation.suspended}@example.com`,
      );

      // Before: the report reads, everywhere.
      expect(Object.values(await readReport(paid)).every((status) => status === 200)).toBe(true);

      await db.prisma.purchase.update({
        where: { id: paid.purchaseId },
        data: { status: revocation.purchaseStatus },
      });
      await db.prisma.entitlement.update({
        where: { purchaseId: paid.purchaseId },
        data: { suspended: revocation.suspended },
      });

      const after = await readReport(paid);
      expect(after).toEqual({
        scan: 403,
        dashboard: 403,
        issues: 403,
        issue: 403,
        evidence: 403,
        export: 403,
        exportCsv: 403,
      });
      const detail = await paid.agent.get(`/scans/${paid.scanId}`).set('Cookie', paid.cookie);
      expect(detail.body.error.code).toBe('ENTITLEMENT_SUSPENDED');
      expect(detail.body.data).toBeNull();
    });
  }

  it('does not let a triage write in through the issue PATCH either', async () => {
    const app = makeApp();
    const paid = await paidScan(app, 'revoked-patch@example.com');
    await db.prisma.entitlement.update({
      where: { purchaseId: paid.purchaseId },
      data: { suspended: true },
    });

    const patched = await paid.agent
      .patch(`/scans/${paid.scanId}/issues/${paid.issueId}`)
      .set('Cookie', paid.cookie)
      .send({ status: 'Ignored' });

    expect(patched.status).toBe(403);
    expect(patched.body.error.code).toBe('ENTITLEMENT_SUSPENDED');
    expect((await db.prisma.issue.findUniqueOrThrow({ where: { id: paid.issueId } })).status).toBe(
      'New',
    );
  });

  it('lists the scan without its report payload instead of hiding or leaking it', async () => {
    const app = makeApp();
    const paid = await paidScan(app, 'revoked-list@example.com');
    const before = await paid.agent.get('/scans').set('Cookie', paid.cookie);
    expect(before.body.data[0].modules).toHaveLength(1);

    await db.prisma.entitlement.update({
      where: { purchaseId: paid.purchaseId },
      data: { suspended: true },
    });

    const listed = await paid.agent.get('/scans').set('Cookie', paid.cookie);
    expect(listed.status).toBe(200);
    // The row stays: a customer whose refund went through must still see that
    // the scan happened. What goes is the report — the module scores are the
    // same paid data the detail endpoint now refuses.
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].id).toBe(paid.scanId);
    expect(listed.body.data[0].status).toBe('Completed');
    expect(listed.body.data[0].modules).toEqual([]);
    // URL counters are progress, not report content: they say how far the run
    // got, never what it found, so a suspended entitlement still sees them.
    expect(listed.body.data[0].progress).toEqual({
      completedModules: 0,
      totalModules: 0,
      scannedUrls: 0,
      discoveredUrls: 0,
    });
    expect(JSON.stringify(listed.body)).not.toContain('"score":74');
  });

  it('strips the report payload from the in-flight scan endpoint as well', async () => {
    const app = makeApp();
    const paid = await paidScan(app, 'revoked-active@example.com');
    await db.prisma.scan.update({ where: { id: paid.scanId }, data: { status: 'Running' } });
    await db.prisma.entitlement.update({
      where: { purchaseId: paid.purchaseId },
      data: { suspended: true },
    });

    const active = await paid.agent.get('/scans/active').set('Cookie', paid.cookie);
    expect(active.status).toBe(200);
    expect(active.body.data.id).toBe(paid.scanId);
    expect(active.body.data.modules).toEqual([]);
  });

  it('refuses to run any more paid work on the purchase', async () => {
    const app = makeApp();
    const paid = await paidScan(app, 'revoked-work@example.com');
    await db.prisma.scan.update({ where: { id: paid.scanId }, data: { status: 'Partial' } });
    await db.prisma.entitlement.update({
      where: { purchaseId: paid.purchaseId },
      data: { suspended: true },
    });

    const retry = await paid.agent
      .post(`/scans/${paid.scanId}/retry`)
      .set('Cookie', paid.cookie)
      .send({});
    expect(retry.status).toBe(403);
    expect(retry.body.error.code).toBe('ENTITLEMENT_INACTIVE');

    const process = await paid.agent
      .post(`/scans/${paid.scanId}/process`)
      .set('Cookie', paid.cookie)
      .send({});
    expect(process.status).toBe(403);
    expect(process.body.error.code).toBe('ENTITLEMENT_INACTIVE');
  });

  it('leaves the worker refusing the job, whatever the HTTP layer allowed', async () => {
    const app = makeApp();
    const paid = await paidScan(app, 'revoked-worker@example.com');
    await db.prisma.scan.update({ where: { id: paid.scanId }, data: { status: 'Pending' } });
    // The purchase created its job already (one row per scan); put it back in
    // the queue rather than adding a second one.
    await db.prisma.job.update({
      where: { scanId: paid.scanId },
      data: { type: 'scan', status: 'Pending', claimedAt: null },
    });
    await db.prisma.entitlement.update({
      where: { purchaseId: paid.purchaseId },
      data: { suspended: true },
    });

    const result = await processScan(
      {
        prisma: db.prisma,
        logger: silentLogger,
        now: () => NOW,
        // Never reached: the billing gate refuses the job before anything runs,
        // and a provider that throws proves it.
        createAiProvider: () => {
          throw new Error('a suspended entitlement must not reach the AI provider');
        },
      },
      paid.scanId,
    );

    // The scan is left exactly where it was, for the billing reconciliation to
    // pick up: never queued, never run.
    expect(result.status).toBe('Pending');
    const stored = await db.prisma.scan.findUniqueOrThrow({ where: { id: paid.scanId } });
    expect(stored.status).toBe('Pending');
    // The job is released rather than consumed by a run that must not happen.
    const job = await db.prisma.job.findUniqueOrThrow({ where: { scanId: paid.scanId } });
    expect(job.status).not.toBe('Claimed');
  });

  // Cancelling returns no report data and is how a customer stops work that is
  // still running. It stays open on purpose, and that decision is pinned here so
  // it cannot change by accident.
  it('still lets the customer cancel a scan whose payment came back', async () => {
    const app = makeApp();
    const paid = await paidScan(app, 'revoked-cancel@example.com');
    await db.prisma.scan.update({ where: { id: paid.scanId }, data: { status: 'Running' } });
    await db.prisma.entitlement.update({
      where: { purchaseId: paid.purchaseId },
      data: { suspended: true },
    });

    const cancelled = await paid.agent
      .post(`/scans/${paid.scanId}/cancel`)
      .set('Cookie', paid.cookie)
      .send({});
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('Cancelled');
  });

  it('leaves the Free check alone: there is no purchase to return', async () => {
    const app = makeApp();
    const agent = request.agent(app);
    const cookie = await register(agent, 'free-untouched@example.com');
    const profileId = await createProfile(agent, cookie, 'https://free.example.com');
    const created = await agent
      .post(`/profiles/${profileId}/free-check`)
      .set('Cookie', cookie)
      .send({});
    expect(created.status).toBe(201);
    const scanId = created.body.data.id as string;
    const issueId = await seedReport(db.prisma, scanId);

    // A refunded purchase on ANOTHER account must not colour this one either.
    const other = await paidScan(app, 'free-neighbour@example.com');
    await db.prisma.entitlement.update({
      where: { purchaseId: other.purchaseId },
      data: { suspended: true },
    });

    const free = { agent, cookie, scanId, purchaseId: '', issueId };
    expect(await readReport(free)).toEqual({
      scan: 200,
      dashboard: 200,
      issues: 200,
      issue: 200,
      evidence: 200,
      // Export is Complete-only; a Free scan is refused for the plan, never for
      // an entitlement it never had.
      export: 403,
      exportCsv: 403,
    });
    const refused = await agent.get(`/scans/${scanId}/export`).set('Cookie', cookie);
    expect(refused.body.error.code).toBe('EXPORT_COMPLETE_ONLY');
  });

  // ENTITLEMENT_DAYS bounds what may still be bought with the purchase, not how
  // long a delivered report stays readable: "after expiry no new scans/retries
  // are queued, a Running scan may finish" (packages/contracts/src/tariffs.ts).
  it('keeps the report readable after the entitlement window closes, but sells no more work', async () => {
    const app = makeApp();
    const paid = await paidScan(app, 'expired-report@example.com');
    await db.prisma.entitlement.update({
      where: { purchaseId: paid.purchaseId },
      data: { expiresAt: new Date(NOW.getTime() - 1) },
    });

    expect(await readReport(paid)).toEqual({
      scan: 200,
      dashboard: 200,
      issues: 200,
      issue: 200,
      evidence: 200,
      export: 200,
      exportCsv: 200,
    });

    await db.prisma.scan.update({ where: { id: paid.scanId }, data: { status: 'Partial' } });
    const retry = await paid.agent
      .post(`/scans/${paid.scanId}/retry`)
      .set('Cookie', paid.cookie)
      .send({});
    expect(retry.status).toBe(403);
    expect(retry.body.error.code).toBe('ENTITLEMENT_INACTIVE');
  });
});
