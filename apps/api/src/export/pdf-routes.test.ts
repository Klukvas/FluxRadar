// Who may download the report, and what happens when it is too large to build.
//
// The route renders every finding of a scan, which makes it both the heaviest
// read in the API and the one that hands a customer a file. So the gates are the
// same as every other paid report read — session, ownership, paid access, a
// terminal status — and the size limit is a REFUSAL rather than a truncation: a
// document that stopped at a round number and looked finished would tell its
// reader the site has fewer problems than it has.
//
// Prisma is mocked inline: none of this needs a database, and the finding
// streaming itself is covered against a fake store in pdf/render.test.ts.

import express from 'express';
import request, { type Test } from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

import { errorHandler } from '../http/error-handler.ts';
import { silentLogger } from '../http/logger.ts';
import type { PrivateObjectStore } from '../integrations/s3.ts';
import {
  PDF_FINDING_LIMIT,
  reportPdfRouter,
  type ArchiveOutcome,
  type PdfRouterDeps,
} from './pdf-routes.ts';

const ACCOUNT_ID = 'account_xyz';
const SESSION_COOKIE = 'fluxradar_session=test-token-00000000000000000000000000000000';

function makeScan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'scan_abc123',
    accountId: ACCOUNT_ID,
    siteProfileId: 'profile_1',
    plan: 'Complete',
    domain: 'https://example.com',
    status: 'Completed',
    statusReason: null,
    rulesetVersion: '1',
    purchaseId: 'purchase_1',
    purchase: {
      status: 'paid',
      entitlement: { suspended: false, expiresAt: new Date('2099-01-01T00:00:00Z') },
    },
    startedAt: new Date('2026-09-05T01:00:00Z'),
    completedAt: new Date('2026-09-05T01:05:00Z'),
    createdAt: new Date('2026-09-05T00:59:00Z'),
    modules: [],
    ...overrides,
  };
}

function makePrisma(scan: Record<string, unknown> | null, findingCount = 0): PrismaClient {
  return {
    scan: { findFirst: vi.fn().mockResolvedValue(scan) },
    issue: {
      count: vi.fn().mockResolvedValue(findingCount),
      groupBy: vi.fn().mockResolvedValue([]),
      findMany: vi.fn().mockResolvedValue([]),
    },
    exportArtifact: { upsert: vi.fn().mockResolvedValue({}) },
    session: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ accountId: ACCOUNT_ID, expiresAt: new Date('2099-01-01') }),
    },
  } as unknown as PrismaClient;
}

function makeApp(prisma: PrismaClient, overrides: Partial<PdfRouterDeps> = {}) {
  const app = express();
  app.use(
    reportPdfRouter({
      prisma,
      now: () => new Date('2026-09-22T12:00:00.000Z'),
      // No store: the download must work on a deployment with no archive bucket.
      objectStore: null,
      logger: silentLogger,
      ...overrides,
    }),
  );
  app.use(errorHandler(silentLogger));
  return app;
}

/** A store whose write is still in flight when the test ends. */
function stallingStore(): PrivateObjectStore {
  return {
    putBytes: () => new Promise<void>(() => undefined),
  } as unknown as PrivateObjectStore;
}

function authed(req: Test): Test {
  return req.set('Cookie', SESSION_COOKIE);
}

describe('GET /scans/:scanId/report.pdf', () => {
  it('returns the PDF as an attachment for a paid, terminal scan', async () => {
    const response = await authed(
      request(makeApp(makePrisma(makeScan()))).get('/scans/scan_abc123/report.pdf'),
    ).buffer(true);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain(
      'attachment; filename="fluxradar-example.com-scan_abc123.pdf"',
    );
    expect(response.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('refuses an unauthenticated request', async () => {
    const response = await request(makeApp(makePrisma(makeScan()))).get(
      '/scans/scan_abc123/report.pdf',
    );
    expect(response.status).toBe(401);
  });

  it('answers 404 for a scan the account does not own', async () => {
    // The query is scoped by accountId, so another account's scan simply is not
    // found — the route never has to decide whether to admit it exists.
    const response = await authed(
      request(makeApp(makePrisma(null))).get('/scans/scan_abc123/report.pdf'),
    );
    expect(response.status).toBe(404);
  });

  it('refuses a scan whose money was returned', async () => {
    const refunded = makeScan({
      purchase: {
        status: 'Refunded',
        entitlement: { suspended: true, expiresAt: new Date('2099-01-01T00:00:00Z') },
      },
    });
    const response = await authed(
      request(makeApp(makePrisma(refunded))).get('/scans/scan_abc123/report.pdf'),
    );
    expect(response.status).toBe(403);
  });

  it('refuses the Free check, which has the printable page instead', async () => {
    const response = await authed(
      request(
        makeApp(makePrisma(makeScan({ plan: 'Free', purchaseId: null, purchase: null }))),
      ).get('/scans/scan_abc123/report.pdf'),
    );
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('PDF_PAID_PLAN_ONLY');
  });

  it('refuses a scan that has not reached a terminal status', async () => {
    const response = await authed(
      request(makeApp(makePrisma(makeScan({ status: 'Running', completedAt: null })))).get(
        '/scans/scan_abc123/report.pdf',
      ),
    );
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EXPORT_NOT_READY');
  });

  it('refuses, rather than truncating, a scan with more findings than one document holds', async () => {
    const prisma = makePrisma(makeScan(), PDF_FINDING_LIMIT + 1);
    const response = await authed(request(makeApp(prisma)).get('/scans/scan_abc123/report.pdf'));

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PDF_TOO_LARGE');
    // The alternative that does carry everything is named in the refusal.
    expect(response.body.error.message).toContain('JSON and CSV exports');
    // And nothing was rendered: no finding page was ever read.
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
  });

  it('builds the document for a scan right at the limit', async () => {
    const response = await authed(
      request(makeApp(makePrisma(makeScan(), PDF_FINDING_LIMIT))).get(
        '/scans/scan_abc123/report.pdf',
      ),
    ).buffer(true);
    expect(response.status).toBe(200);
  });

  it('keeps the limit far above the printable page’s thousand', () => {
    // The point of the download is the findings the page cannot show. A limit
    // near 1 000 would make it the same document with extra steps.
    expect(PDF_FINDING_LIMIT).toBeGreaterThanOrEqual(10_000);
  });

  it('renders the Ukrainian document when asked for it', async () => {
    const response = await authed(
      request(makeApp(makePrisma(makeScan()))).get('/scans/scan_abc123/report.pdf?language=uk'),
    ).buffer(true);
    expect(response.status).toBe(200);
    expect(response.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('rejects a language it does not have a document in', async () => {
    const response = await authed(
      request(makeApp(makePrisma(makeScan()))).get('/scans/scan_abc123/report.pdf?language=de'),
    );
    expect(response.status).toBe(400);
  });

  describe('the archive copy', () => {
    it('does not make the customer wait for a store that never answers', async () => {
      const prisma = makePrisma(makeScan());
      const app = makeApp(prisma, { objectStore: stallingStore() });

      const response = await authed(request(app).get('/scans/scan_abc123/report.pdf')).buffer(true);

      // The archive write is still in flight, and the report is already here.
      expect(response.status).toBe(200);
      expect(response.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(prisma.exportArtifact.upsert).not.toHaveBeenCalled();
    });

    it('stores the copy after the response and records the artifact', async () => {
      const prisma = makePrisma(makeScan());
      const putBytes = vi.fn().mockResolvedValue(undefined);
      let finished: (outcome: ArchiveOutcome) => void = () => undefined;
      const archived = new Promise<ArchiveOutcome>((resolve) => {
        finished = resolve;
      });
      const app = makeApp(prisma, {
        objectStore: { putBytes } as unknown as PrivateObjectStore,
        onArchived: (outcome) => finished(outcome),
      });

      const response = await authed(request(app).get('/scans/scan_abc123/report.pdf')).buffer(true);
      expect(response.status).toBe(200);

      expect(await archived).toBe('stored');
      expect(putBytes).toHaveBeenCalledWith(
        expect.stringContaining('scan_abc123'),
        expect.any(Buffer),
        'application/pdf',
      );
      expect(prisma.exportArtifact.upsert).toHaveBeenCalled();
    });

    it('still delivers the report when the store refuses the copy', async () => {
      const prisma = makePrisma(makeScan());
      let finished: (outcome: ArchiveOutcome) => void = () => undefined;
      const archived = new Promise<ArchiveOutcome>((resolve) => {
        finished = resolve;
      });
      const app = makeApp(prisma, {
        objectStore: {
          putBytes: vi.fn().mockRejectedValue(new Error('bucket is on fire')),
        } as unknown as PrivateObjectStore,
        onArchived: (outcome) => finished(outcome),
      });

      const response = await authed(request(app).get('/scans/scan_abc123/report.pdf')).buffer(true);

      expect(response.status).toBe(200);
      expect(response.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(await archived).toBe('failed');
      expect(prisma.exportArtifact.upsert).not.toHaveBeenCalled();
    });
  });
});
