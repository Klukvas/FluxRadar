// A stored row of a retired plan, pushed through every read path.
//
// Website Audit was removed as a tariff; internal and test rows of it remain in
// production with `plan = 'WebsiteAudit'`, and a row from another deployment
// could carry any string at all. Every reader maps the stored string through
// `readStoredPlan` (packages/contracts/src/stored-plan.ts): the report, the
// lists, the comparison, the admin count and the PDF must render such a row,
// and nothing may run, retry, export or plan it.

import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RULESET_VERSION } from '@fluxradar/contracts';

import { JOB_STATUSES, JOB_TYPES, PURCHASE_STATUSES } from '../billing/constants.ts';
import { CREEM_PROVIDER } from '../billing/creem/config.ts';
import { purgeExpiredScans } from '../data-retention.ts';
import { silentLogger } from '../http/logger.ts';
import { processScan } from '../orchestrator/worker.ts';
import {
  ADMINS,
  ADMIN_EMAIL,
  adminTestApp,
  at,
  seedAccount,
  type SeededOwner,
} from '../test-utils/admin-fixtures.ts';
import { extractPdfPages } from '../test-utils/pdf-text.ts';
import { createTestDb, type TestDb } from '../test-utils/test-db.ts';
import { findPreviousScan } from './previous-scan.ts';

interface LegacyScanOptions {
  readonly plan?: string;
  readonly status?: string;
  readonly createdAt?: string;
  readonly completedAt?: string | null;
  readonly jobStatus?: string;
}

describe('a stored scan of a retired plan', () => {
  let db: TestDb;
  let owner: SeededOwner;
  let app: ReturnType<typeof adminTestApp>;

  beforeEach(async () => {
    db = await createTestDb();
    owner = await seedAccount(db.prisma, {
      email: ADMIN_EMAIL,
      verified: true,
      createdAt: at('2026-09-01T08:00:00Z'),
    });
    app = adminTestApp(db.prisma, ADMINS);
  });

  afterEach(async () => {
    await db.cleanup();
  });

  /** A paid scan of `plan` written straight to the tables, as old rows were. */
  async function seedStoredScan(options: LegacyScanOptions = {}): Promise<string> {
    const plan = options.plan ?? 'WebsiteAudit';
    const status = options.status ?? 'Completed';
    const createdAt = at(options.createdAt ?? '2026-09-10T10:00:00Z');
    const completedAt =
      options.completedAt === null ? null : at(options.completedAt ?? '2026-09-10T10:30:00Z');
    const purchase = await db.prisma.purchase.create({
      data: {
        accountId: owner.accountId,
        siteProfileId: owner.siteProfileId,
        plan,
        provider: CREEM_PROVIDER,
        providerTransactionId: `ord_${randomUUID()}`,
        amountUsd: 79,
        currency: 'USD',
        status: PURCHASE_STATUSES.paid,
      },
    });
    await db.prisma.entitlement.create({
      data: { purchaseId: purchase.id, expiresAt: at('2099-01-01T00:00:00Z') },
    });
    const scan = await db.prisma.scan.create({
      data: {
        purchaseId: purchase.id,
        accountId: owner.accountId,
        siteProfileId: owner.siteProfileId,
        plan,
        domain: 'https://example.com',
        status,
        scopeJson: JSON.stringify({ includeSubdomains: false }),
        rulesetVersion: RULESET_VERSION,
        createdAt,
        startedAt: createdAt,
        completedAt,
      },
    });
    for (const [module, score] of [
      ['Security', 80],
      ['Performance', 100],
      ['UX/Conversion', 40],
    ] as const) {
      await db.prisma.scanModule.create({
        data: {
          scanId: scan.id,
          module,
          runtimeStatus: 'Completed',
          coverage: 1,
          score,
          applicableChecks: 4,
          completedApplicableChecks: 4,
          usableOutput: true,
        },
      });
    }
    await db.prisma.job.create({
      data: {
        scanId: scan.id,
        type: JOB_TYPES.scan,
        status: options.jobStatus ?? JOB_STATUSES.done,
      },
    });
    return scan.id;
  }

  const get = (path: string) => request(app).get(path).set('Cookie', owner.cookie);
  const post = (path: string) => request(app).post(path).set('Cookie', owner.cookie).send({});

  it('renders the scan detail, scored over the modules it stored', async () => {
    const scanId = await seedStoredScan();

    const detail = await get(`/scans/${scanId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.plan).toBe('WebsiteAudit');

    const response = await get(`/scans/${scanId}/dashboard`);
    expect(response.status).toBe(200);
    expect(response.body.data.scan.plan).toBe('WebsiteAudit');
    // Complete's weights over Security (.20) and Performance (.15) alone:
    // (80·.20 + 100·.15) / .35 = 88.57. UX/Conversion stays a side score.
    expect(response.body.data.overall).toMatchObject({ verdict: 'normal', score: 88.57 });
  });

  it('reads an unknown plan string as the archived catch-all', async () => {
    const scanId = await seedStoredScan({ plan: 'Enterprise' });

    const response = await get(`/scans/${scanId}/dashboard`);

    expect(response.status).toBe(200);
    expect(response.body.data.scan.plan).toBe('Legacy');
    expect(response.body.data.overall.verdict).toBe('normal');
  });

  it('lists the scan in the reports list', async () => {
    const scanId = await seedStoredScan();

    const response = await get('/scans');

    expect(response.status).toBe(200);
    const listed = (response.body.data as { id: string; plan: string }[]).find(
      (scan) => scan.id === scanId,
    );
    expect(listed?.plan).toBe('WebsiteAudit');
  });

  // Legacy plans are in neither history set (scan-history.ts): they neither
  // unlock nor gate the history, so an account with only legacy scans sees
  // all of its own reports, and a Basic scan beside them still gates it.
  it('lists every legacy report on the history request, and lets Basic still gate it', async () => {
    const first = await seedStoredScan({ createdAt: '2026-09-01T10:00:00Z' });
    const second = await seedStoredScan({ plan: 'Enterprise' });

    const history = await get('/scans?history=true');
    expect(history.status).toBe(200);
    expect((history.body.data as { id: string }[]).map((scan) => scan.id).sort()).toEqual(
      [first, second].sort(),
    );

    await seedStoredScan({ plan: 'Basic', createdAt: '2026-09-12T10:00:00Z' });
    const gated = await get('/scans?history=true');
    expect(gated.status).toBe(403);
    expect(gated.body.error.code).toBe('HISTORY_REQUIRES_COMPLETE');
  });

  it('serves the issue summary and compares with the previous scan of the same plan', async () => {
    const earlier = await seedStoredScan({
      createdAt: '2026-09-01T10:00:00Z',
      completedAt: '2026-09-01T10:30:00Z',
    });
    const current = await seedStoredScan();

    expect((await get(`/scans/${current}/issues/summary`)).status).toBe(200);
    const changes = await get(`/scans/${current}/changes`);
    expect(changes.status).toBe(200);
    expect(changes.body.data.previous).toMatchObject({ id: earlier, plan: 'WebsiteAudit' });
  });

  it('is never the previous scan of a Complete report', async () => {
    await seedStoredScan({
      createdAt: '2026-09-01T10:00:00Z',
      completedAt: '2026-09-01T10:30:00Z',
    });
    const completeId = await seedStoredScan({ plan: 'Complete' });
    const complete = await db.prisma.scan.findUniqueOrThrow({ where: { id: completeId } });

    expect(await findPreviousScan(db.prisma, complete)).toBeNull();
  });

  it('refuses the comparison and the export cleanly', async () => {
    const scanId = await seedStoredScan();

    const comparison = await get(`/scans/${scanId}/comparison`);
    expect(comparison.status).toBe(403);

    const exported = await get(`/scans/${scanId}/export?format=json`);
    expect(exported.status).toBe(403);
    expect(exported.body.error.code).toBe('EXPORT_COMPLETE_ONLY');
  });

  it('prints the PDF report, naming the plan as archived', async () => {
    const scanId = await seedStoredScan();

    const english = await get(`/scans/${scanId}/report.pdf`).buffer(true);
    expect(english.status).toBe(200);
    expect(extractPdfPages(english.body as Buffer).join('\n')).toContain(
      'Website Audit (archived)',
    );

    const ukrainian = await get(`/scans/${scanId}/report.pdf?language=uk`).buffer(true);
    expect(ukrainian.status).toBe(200);
    expect(extractPdfPages(ukrainian.body as Buffer).join('\n')).toContain('Website Audit (архів)');
  });

  it('lists the purchase on the account page', async () => {
    await seedStoredScan();

    const response = await get('/account/purchases');

    expect(response.status).toBe(200);
    expect(response.body.data.map((purchase: { plan: string }) => purchase.plan)).toEqual([
      'WebsiteAudit',
    ]);
  });

  it('is counted in the admin stats under its stored plan', async () => {
    await seedStoredScan({ createdAt: '2026-09-20T10:00:00Z' });

    const response = await get('/admin/stats?days=7');

    expect(response.status).toBe(200);
    expect(response.body.data.allTime.scans.byPlan).toContainEqual({
      plan: 'WebsiteAudit',
      count: 1,
    });
  });

  it('can neither be processed nor retried over HTTP', async () => {
    const pending = await seedStoredScan({
      status: 'Pending',
      completedAt: null,
      jobStatus: JOB_STATUSES.pending,
    });
    const processed = await post(`/scans/${pending}/process`);
    expect(processed.status).toBe(409);
    expect(processed.body.error.code).toBe('PLAN_RETIRED');

    const partial = await seedStoredScan({ status: 'Partial' });
    const retried = await post(`/scans/${partial}/retry`);
    expect(retried.status).toBe(409);
    expect(retried.body.error.code).toBe('PLAN_RETIRED');
  });

  it('is never run by the worker: the job is closed and the scan left as it was', async () => {
    const scanId = await seedStoredScan({
      status: 'Pending',
      completedAt: null,
      jobStatus: JOB_STATUSES.pending,
    });

    const result = await processScan(
      {
        prisma: db.prisma,
        logger: silentLogger,
        createAiProvider: () => {
          throw new Error('a scan of a retired plan must never reach an AI provider');
        },
      },
      scanId,
    );

    expect(result.outcome).toBe('Queued');
    const scan = await db.prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
    expect(scan.status).toBe('Pending');
    const job = await db.prisma.job.findUniqueOrThrow({ where: { scanId } });
    expect(job.status).toBe(JOB_STATUSES.done);
  });

  it('is purged after the longest retention any report is kept for, and not before', async () => {
    const old = await seedStoredScan({ createdAt: '2025-09-01T10:00:00Z' });
    const recent = await seedStoredScan({ createdAt: '2026-09-01T10:00:00Z' });

    const result = await purgeExpiredScans(db.prisma, at('2026-10-19T00:00:00Z'), null);

    expect(result.deletedScanCount).toBe(1);
    expect(await db.prisma.scan.findUnique({ where: { id: old } })).toBeNull();
    expect(await db.prisma.scan.findUnique({ where: { id: recent } })).not.toBeNull();
  });

  it('opens a site saved on the retired plan on Complete, keeping its saved scope', async () => {
    await db.prisma.siteProfile.update({
      where: { id: owner.siteProfileId },
      data: {
        scanConfigJson: JSON.stringify({
          plan: 'WebsiteAudit',
          scope: { includeSubdomains: false, maxPages: 40 },
        }),
      },
    });

    const response = await get(`/profiles/${owner.siteProfileId}`);

    expect(response.status).toBe(200);
    expect(response.body.data.scanConfig.plan).toBe('Complete');
    expect(response.body.data.scanConfig.scope.maxPages).toBe(40);
  });
});
