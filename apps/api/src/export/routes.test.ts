// Regression tests for the report-storage failure path in the export router.
//
// Root cause: HetznerObjectStore.putText sent ServerSideEncryption: 'AES256',
// which Hetzner/Ceph returns NotImplemented (HTTP 501) for.  The catch block
// then converted the error into a user-visible 503 without any operator
// logging.  These tests assert:
//   1. A store that throws propagates as EXPORT_STORAGE_UNAVAILABLE (503).
//   2. A null / unconfigured store still serves the export (200, no artifact).
//   3. A working store stores the artifact and returns it in the response.
//
// The tests are deliberately self-contained: prisma is mocked inline so no
// database is needed.

import { describe, it, expect, vi, type Mock } from 'vitest';
import request, { type Test } from 'supertest';
import express from 'express';
import type { PrismaClient } from '@prisma/client';

import { exportRouter } from './routes.ts';
import { errorHandler } from '../http/error-handler.ts';
import { silentLogger } from '../http/logger.ts';

// ---------------------------------------------------------------------------
// Minimal scan fixture that passes the Complete + Completed gate and has
// enough shape that buildExportRecords will succeed.
// ---------------------------------------------------------------------------
function makeScan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'scan_abc123',
    accountId: 'account_xyz',
    siteProfileId: 'profile_1',
    plan: 'Complete',
    domain: 'https://example.com',
    status: 'Completed',
    statusReason: null,
    scopeJson: '{"includeSubdomains":false}',
    rulesetVersion: '1',
    platformRetryCount: 0,
    moduleRetryCount: 0,
    purchaseId: 'purchase_1',
    startedAt: new Date('2026-09-05T01:00:00Z'),
    completedAt: new Date('2026-09-05T01:05:00Z'),
    createdAt: new Date('2026-09-05T00:59:00Z'),
    modules: [],
    issues: [],
    aiResponses: [],
    ...overrides,
  };
}

const FAKE_ACCOUNT_ID = 'account_xyz';
// An arbitrary token value – the session mock just needs findUnique to return
// a valid row regardless of the actual hash.
const FAKE_SESSION_COOKIE = 'fluxradar_session=test-token-00000000000000000000000000000000';

function makePrisma(scan: Record<string, unknown> | null): PrismaClient {
  return {
    scan: {
      findFirst: vi.fn().mockResolvedValue(scan),
    },
    exportArtifact: {
      upsert: vi.fn().mockResolvedValue({}),
    },
    // requireAuth looks up the session token via prisma.session.findUnique.
    session: {
      findUnique: vi.fn().mockResolvedValue({
        accountId: FAKE_ACCOUNT_ID,
        expiresAt: new Date('2099-01-01'),
      }),
    },
  } as unknown as PrismaClient;
}

// Build an express app with the real auth middleware backed by a mocked prisma.
function makeApp(
  prisma: PrismaClient,
  objectStore?: { putText: Mock; deleteObject?: Mock } | null,
) {
  const app = express();
  app.use(express.json());

  app.use(
    exportRouter({
      prisma,
      now: () => new Date('2026-09-05T01:10:00Z'),
      objectStore: objectStore as import('../integrations/s3.ts').PrivateObjectStore | null,
      logger: silentLogger,
    }),
  );

  app.use(errorHandler(silentLogger));
  return app;
}

// Convenience: attach the fake session cookie to a supertest request.
function authed(req: Test): Test {
  return req.set('Cookie', FAKE_SESSION_COOKIE);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('export route – storage failure regression', () => {
  it('returns 503 EXPORT_STORAGE_UNAVAILABLE when the object store throws', async () => {
    // This is the exact symptom the user reported.  Previously the underlying
    // SDK error (e.g. NotImplemented from SSE-AES256) was silently swallowed.
    const throwingStore = {
      putText: vi.fn().mockRejectedValue(
        Object.assign(new Error('NotImplemented: Server side encryption is not implemented'), {
          name: 'NotImplementedError',
          $metadata: { httpStatusCode: 501 },
        }),
      ),
      deleteObject: vi.fn(),
    };
    const prisma = makePrisma(makeScan());
    const app = makeApp(prisma, throwingStore);

    const res = await authed(request(app).get('/scans/scan_abc123/export?format=json'));

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('EXPORT_STORAGE_UNAVAILABLE');
    // Must not leak SDK internals (error name, stack, endpoint, etc.)
    expect(res.body.error.message).toBe('report storage is temporarily unavailable');
    expect(JSON.stringify(res.body)).not.toContain('NotImplemented');
    expect(JSON.stringify(res.body)).not.toContain('AES256');
  });

  it('returns 200 with records and no artifact when objectStore is null', async () => {
    // Local dev / unconfigured storage must still serve the export.
    const prisma = makePrisma(makeScan());
    const app = makeApp(prisma, null);

    const res = await authed(request(app).get('/scans/scan_abc123/export?format=json'));

    expect(res.status).toBe(200);
    expect(res.body.data.records).toBeDefined();
    expect(res.body.data.artifact).toBeUndefined();
  });

  it('returns 200 and records the artifact when storage succeeds', async () => {
    const workingStore = {
      putText: vi.fn().mockResolvedValue(undefined),
      deleteObject: vi.fn(),
    };
    const prisma = makePrisma(makeScan());
    const app = makeApp(prisma, workingStore);

    const res = await authed(request(app).get('/scans/scan_abc123/export?format=json'));

    expect(res.status).toBe(200);
    expect(workingStore.putText).toHaveBeenCalledOnce();
    expect(res.body.data.artifact).toMatchObject({
      format: 'json',
      objectKey: expect.stringContaining('accounts/account_xyz/scans/scan_abc123'),
    });
    // Upsert must be called to persist the artifact metadata.
    expect((prisma.exportArtifact.upsert as Mock)).toHaveBeenCalledOnce();
  });

  it('returns 403 for non-Complete scans', async () => {
    const prisma = makePrisma(makeScan({ plan: 'Basic' }));
    const app = makeApp(prisma, null);

    const res = await authed(request(app).get('/scans/scan_abc123/export?format=json'));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('EXPORT_COMPLETE_ONLY');
  });

  it('returns 409 for scans that are not yet terminal', async () => {
    const prisma = makePrisma(makeScan({ status: 'Running' }));
    const app = makeApp(prisma, null);

    const res = await authed(request(app).get('/scans/scan_abc123/export?format=json'));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EXPORT_NOT_READY');
  });
});
