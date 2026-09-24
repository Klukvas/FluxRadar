// What the Website Audit package is, on the server that enforces it.
//
// The plan is defined by two absences — no SEO, no AI SEO / GEO — and by
// entitlements that used to be spelled `plan === 'Complete'`. Both are server
// facts: the scan form mirrors them, the API decides them. Everything here is
// about the decision, never about the mirror.

import express from 'express';
import request, { type Test } from 'supertest';
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { TARIFFS, planSupports } from '@fluxradar/contracts';
import { computeOverallScore } from '@fluxradar/scoring';
import { validateExportRecords } from '@fluxradar/export';

import { exportRouter } from './export/routes.ts';
import { buildExportRecords, type ExportScan } from './export/build-records.ts';
import { errorHandler } from './http/error-handler.ts';
import { silentLogger } from './http/logger.ts';
import { modulePlanFor } from './orchestrator/module-plan.ts';
import { planUrlLimit, planPriceUsd, isPaidPlan } from './billing/plans.ts';
import { readFastSpringConfig } from './billing/fastspring/config.ts';
import { createCheckoutSession } from './billing/fastspring/checkout-session.ts';
import { PlanNotPurchasableError } from './billing/errors.ts';

describe('Website Audit — what the plan runs', () => {
  const plan = modulePlanFor('WebsiteAudit');

  it('schedules no SEO rules and no GEO work at all', () => {
    expect(plan.runnable).not.toContain('SEO');
    expect(plan.runnable).not.toContain('AI SEO / GEO');
    expect(plan.external).not.toContain('AI SEO / GEO');
    // `geo: false` is the switch the attempt reads before generating discovery
    // questions, sending a provider request or writing the AI-crawler row — on a
    // first run, a retry and a resume alike.
    expect(plan.geo).toBe(false);
  });

  it('runs the eight modules the package sells, and the UX provider work', () => {
    expect(plan.runnable).toEqual([
      'Security',
      'Accessibility',
      'Reliability',
      'Content Quality',
      'Privacy',
    ]);
    expect(plan.external).toEqual(['Performance']);
    expect(plan.ux).toBe(true);
    expect(plan.stubs).toEqual([]);
  });

  it('is Complete minus exactly the two search modules', () => {
    const complete = modulePlanFor('Complete');
    expect(plan.runnable).toEqual(complete.runnable.filter((module) => module !== 'SEO'));
    expect(plan.external).toEqual(complete.external);
    expect(plan.ux).toBe(complete.ux);
  });

  it('leaves Basic and Complete exactly as they were', () => {
    expect(modulePlanFor('Basic')).toEqual({
      runnable: ['SEO'],
      external: [],
      geo: true,
      ux: false,
      stubs: [],
    });
    expect(modulePlanFor('Complete').geo).toBe(true);
    expect(modulePlanFor('Complete').runnable).toContain('SEO');
  });
});

describe('Website Audit — the score it produces', () => {
  const scored = (
    module:
      'Security' | 'Performance' | 'Accessibility' | 'Reliability' | 'Content Quality' | 'Privacy',
    score: number,
  ) => ({ module, moduleStatus: 'Completed' as const, coverage: 1, score, usableOutput: true });

  const everyModule = [
    scored('Security', 50),
    scored('Performance', 100),
    scored('Accessibility', 100),
    scored('Reliability', 100),
    scored('Content Quality', 100),
    scored('Privacy', 100),
  ];

  it('reaches full coverage without SEO or GEO, instead of a missing-module penalty', () => {
    const result = computeOverallScore('WebsiteAudit', everyModule);
    // The two modules the plan never runs send no row. If they still carried
    // weight, weighted coverage would be .65 — "provisional" — and every report
    // of the package would open with a warning about data it never promised.
    expect(result.weightedCoverage).toBeCloseTo(1, 10);
    expect(result.verdict).toBe('normal');
    expect(result.moduleWeights.map((entry) => entry.module)).not.toContain('SEO');
    expect(result.moduleWeights.map((entry) => entry.module)).not.toContain('AI SEO / GEO');
  });

  it('weighs Security as heavily as Complete does, relative to the rest', () => {
    // 0.2/0.65 of the plan rides on Security, so 50 there costs 100 − 50 × (0.2/0.65).
    const result = computeOverallScore('WebsiteAudit', everyModule);
    expect(result.score).toBeCloseTo(100 - 50 * (0.2 / 0.65), 2);
  });

  it('keeps UX/Conversion and Analytics out of the overall score', () => {
    const withSideScores = [
      ...everyModule,
      {
        module: 'UX/Conversion' as const,
        moduleStatus: 'Completed' as const,
        coverage: 1,
        score: 0,
        usableOutput: true,
      },
      {
        module: 'Analytics' as const,
        moduleStatus: 'Completed' as const,
        coverage: 1,
        score: 0,
        usableOutput: true,
      },
    ];
    expect(computeOverallScore('WebsiteAudit', withSideScores).score).toBe(
      computeOverallScore('WebsiteAudit', everyModule).score,
    );
  });

  it('refuses a module the plan does not sell rather than scoring it', () => {
    expect(() =>
      computeOverallScore('WebsiteAudit', [
        { module: 'SEO', moduleStatus: 'Completed', coverage: 1, score: 100, usableOutput: true },
      ]),
    ).toThrow(/SEO/);
  });
});

describe('Website Audit — what the buyer may ask for', () => {
  it('is a paid plan the checkout vocabulary knows', () => {
    expect(isPaidPlan('WebsiteAudit')).toBe(true);
    expect(planPriceUsd('WebsiteAudit')).toBe(79);
    expect(planUrlLimit('WebsiteAudit')).toBe(50_000);
  });

  it('refuses a checkout before any row is written when the product is unmapped', async () => {
    const configured = readFastSpringConfig({
      FASTSPRING_MODE: 'test',
      FASTSPRING_API_USERNAME: 'api-user',
      FASTSPRING_API_PASSWORD: 'api-password-value',
      FASTSPRING_WEBHOOK_SECRET: 'webhook-secret-value',
      FASTSPRING_STOREFRONT_URL: 'https://fluxradar.test.onfastspring.com',
      FASTSPRING_PRODUCT_PATH_BASIC: 'fluxradar-basic-scan',
      FASTSPRING_PRODUCT_PATH_COMPLETE: 'fluxradar-complete-scan',
    });
    if (configured.state !== 'configured') throw new Error('expected a configured environment');
    const prisma = {
      siteProfile: { findFirst: vi.fn() },
      checkoutSession: { create: vi.fn() },
      $transaction: vi.fn(),
    } as unknown as PrismaClient;
    const fetchImpl = vi.fn();

    await expect(
      createCheckoutSession(
        { prisma, config: configured.config, now: () => new Date(), fetchImpl },
        {
          accountId: 'account_1',
          siteProfileId: 'profile_1',
          plan: 'WebsiteAudit',
          scope: { includeSubdomains: false },
          egress: { location: null, monitored: false },
        } as unknown as Parameters<typeof createCheckoutSession>[1],
      ),
    ).rejects.toBeInstanceOf(PlanNotPurchasableError);

    // Nothing was read, nothing was written, and the provider was never called.
    expect(prisma.siteProfile.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('Website Audit — the report entitlements', () => {
  it('includes export, history, the Issue Center lifecycle and the Action Plan', () => {
    for (const capability of ['export', 'scanHistory', 'issueHistory', 'actionPlan'] as const) {
      expect(planSupports('WebsiteAudit', capability)).toBe(true);
    }
  });

  it('opens none of them to Basic or Free', () => {
    for (const capability of ['export', 'scanHistory', 'issueHistory', 'actionPlan'] as const) {
      expect(planSupports('Basic', capability)).toBe(false);
      expect(planSupports('Free', capability)).toBe(false);
    }
  });
});

// The export is the one artefact that leaves the product, so what it calls
// itself is a contract with whoever reads it afterwards.
describe('Website Audit — the export it produces', () => {
  function scanFixture(plan: string): ExportScan {
    return {
      id: 'scan_wa1',
      accountId: 'account_1',
      siteProfileId: 'profile_1',
      plan,
      domain: 'https://example.com',
      status: 'Completed',
      statusReason: null,
      rulesetVersion: '1',
      startedAt: new Date('2026-09-05T01:00:00Z'),
      completedAt: new Date('2026-09-05T01:05:00Z'),
      createdAt: new Date('2026-09-05T00:59:00Z'),
      modules: [],
      issues: [],
      aiResponses: [],
    } as unknown as ExportScan;
  }

  it('labels the records with the plan that was bought, not with Complete', () => {
    const records = buildExportRecords(scanFixture('WebsiteAudit'));
    expect(records.every((record) => record.plan === 'Website Audit Scan')).toBe(true);
    expect(TARIFFS.WebsiteAudit.label).toBe('Website Audit Scan');
  });

  it('writes a Website Audit export under the version that admits its plan', () => {
    const records = buildExportRecords(scanFixture('WebsiteAudit'));
    expect(records.every((record) => record.schema_version === '1.1')).toBe(true);
    const validation = validateExportRecords(records);
    expect(validation.ok).toBe(true);
  });

  // The compatibility half: 1.0 was defined as Complete-only, so a Complete
  // export must still be byte-for-byte the file it was before this plan existed.
  it('leaves a Complete export on schema 1.0, and still validates it', () => {
    const records = buildExportRecords(scanFixture('Complete'));
    expect(records.every((record) => record.schema_version === '1.0')).toBe(true);
    expect(records.every((record) => record.plan === 'Complete Scan')).toBe(true);
    expect(validateExportRecords(records).ok).toBe(true);
  });
});

describe('Website Audit — the export endpoint', () => {
  const SESSION_COOKIE = 'fluxradar_session=test-token-00000000000000000000000000000000';

  function exportScanRow(plan: string): Record<string, unknown> {
    return {
      id: 'scan_wa1',
      accountId: 'account_xyz',
      siteProfileId: 'profile_1',
      plan,
      domain: 'https://example.com',
      status: 'Completed',
      statusReason: null,
      scopeJson: '{"includeSubdomains":false}',
      rulesetVersion: '1',
      platformRetryCount: 0,
      moduleRetryCount: 0,
      purchaseId: 'purchase_1',
      purchase: {
        status: 'paid',
        entitlement: { suspended: false, expiresAt: new Date('2099-01-01T00:00:00Z') },
      },
      startedAt: new Date('2026-09-05T01:00:00Z'),
      completedAt: new Date('2026-09-05T01:05:00Z'),
      createdAt: new Date('2026-09-05T00:59:00Z'),
      modules: [],
      issues: [],
      aiResponses: [],
    };
  }

  function appFor(scan: Record<string, unknown>) {
    const prisma = {
      scan: { findFirst: vi.fn().mockResolvedValue(scan) as Mock },
      exportArtifact: { upsert: vi.fn().mockResolvedValue({}) },
      session: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ accountId: 'account_xyz', expiresAt: new Date('2099-01-01') }),
      },
    } as unknown as PrismaClient;
    const app = express();
    app.use(express.json());
    app.use(
      exportRouter({
        prisma,
        now: () => new Date('2026-09-05T01:10:00Z'),
        objectStore: null,
        logger: silentLogger,
      }),
    );
    app.use(errorHandler(silentLogger));
    return app;
  }

  const authed = (req: Test): Test => req.set('Cookie', SESSION_COOKIE);

  it('serves a Website Audit export, labelled as one', async () => {
    const res = await authed(
      request(appFor(exportScanRow('WebsiteAudit'))).get('/scans/scan_wa1/export?format=json'),
    );
    expect(res.status).toBe(200);
    expect(res.body.data.records[0].plan).toBe('Website Audit Scan');
  });

  it('still refuses a Basic scan, with the code clients already match on', async () => {
    const res = await authed(
      request(appFor(exportScanRow('Basic'))).get('/scans/scan_wa1/export?format=json'),
    );
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EXPORT_COMPLETE_ONLY');
  });

  it('refuses a refunded Website Audit report before it ever reaches the plan gate', async () => {
    const refunded = {
      ...exportScanRow('WebsiteAudit'),
      purchase: { status: 'refunded', entitlement: { suspended: true, expiresAt: null } },
    };
    const res = await authed(request(appFor(refunded)).get('/scans/scan_wa1/export?format=json'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).not.toBe('EXPORT_COMPLETE_ONLY');
  });
});
