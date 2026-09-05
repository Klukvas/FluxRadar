// Complete-only export HTTP API. Records are built through the canonical
// package builders and validated as a set before either JSON or CSV leaves the
// server; no user-controlled raw record is serialized directly.

import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { ScanExportStatus } from '@fluxradar/contracts';
import { validateExportRecords, writeExportCsv } from '@fluxradar/export';
import { z } from 'zod';

import { accountIdFrom, requireAuth } from '../auth/middleware.ts';
import { ApiError, conflict, forbidden, notFound } from '../http/errors.ts';
import { sendOk } from '../http/envelope.ts';
import type { ApiLogger } from '../http/logger.ts';
import { silentLogger } from '../http/logger.ts';
import { requiredParam } from '../http/params.ts';
import { parseInput } from '../http/validate.ts';
import {
  createConfiguredObjectStore,
  reportObjectKey,
  type PrivateObjectStore,
  type ReportFormat,
} from '../integrations/s3.ts';
import { buildExportRecords, type ExportScan } from './build-records.ts';

export interface ExportRouterDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
  /** Test seam; production uses the configured private Hetzner store. */
  readonly objectStore?: PrivateObjectStore | null;
  /**
   * Logger used to record the underlying storage error before it is converted
   * to a user-facing 503.  Omitting it in tests keeps output clean; production
   * inherits the app-level logger via createApp().
   */
  readonly logger?: ApiLogger;
}

const exportQuerySchema = z.object({ format: z.enum(['json', 'csv']).default('json') });
const EXPORTABLE_STATUSES = new Set<ScanExportStatus>([
  'Partial',
  'Completed',
  'Failed',
  'Cancelled',
]);

export function exportRouter(deps: ExportRouterDeps): Router {
  const router = Router();
  const auth = requireAuth(deps.prisma, deps.now);

  router.get('/scans/:scanId/export', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    const scanId = requiredParam(req.params.scanId, 'scanId');
    const scan = await deps.prisma.scan.findFirst({
      where: { id: scanId, accountId },
      include: { modules: true, issues: true, aiResponses: true },
    });
    if (scan === null) {
      throw notFound('scan not found');
    }
    if (scan.plan !== 'Complete') {
      throw forbidden(
        'EXPORT_COMPLETE_ONLY',
        'JSON and CSV export are available on Complete scans only',
      );
    }
    if (!EXPORTABLE_STATUSES.has(scan.status as ScanExportStatus)) {
      throw conflict(
        'EXPORT_NOT_READY',
        'export is available after the scan reaches a terminal status',
      );
    }
    const records = buildExportRecords(scan as ExportScan);
    const validation = validateExportRecords(records);
    if (!validation.ok) {
      throw conflict(
        'EXPORT_INVALID',
        `export validation failed at ${validation.stage}: ${validation.violations
          .slice(0, 3)
          .map((violation) => violation.message)
          .join('; ')}`,
      );
    }
    const query = parseInput(exportQuerySchema, req.query);
    if (query.format === 'csv') {
      const csv = writeExportCsv(validation.records);
      await archiveExport(deps, accountId, scan.id, 'csv', csv);
      res
        .status(200)
        .type('text/csv')
        .setHeader('Content-Disposition', `attachment; filename="fluxradar-${scan.id}.csv"`)
        .send(csv);
      return;
    }
    const json = JSON.stringify(validation.records);
    const artifact = await archiveExport(deps, accountId, scan.id, 'json', json);
    sendOk(res, {
      scanId: scan.id,
      records: validation.records,
      ...(artifact === null ? {} : { artifact }),
    });
  });

  return router;
}

async function archiveExport(
  deps: ExportRouterDeps,
  accountId: string,
  scanId: string,
  format: ReportFormat,
  body: string,
): Promise<{ readonly format: ReportFormat; readonly objectKey: string } | null> {
  const store = deps.objectStore === undefined ? createConfiguredObjectStore() : deps.objectStore;
  if (store === null || store === undefined) return null;
  const objectKey = reportObjectKey(accountId, scanId, format);
  const logger = deps.logger ?? silentLogger;
  try {
    await store.putText(
      objectKey,
      body,
      format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8',
    );
  } catch (err) {
    // Log the real SDK / network error so operators can diagnose
    // misconfiguration (wrong endpoint, bucket, credentials, unsupported
    // headers) without it leaking to the client response.
    logger.error('report storage putText failed', {
      scanId,
      format,
      objectKey,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    throw new ApiError(
      503,
      'EXPORT_STORAGE_UNAVAILABLE',
      'report storage is temporarily unavailable',
    );
  }
  await deps.prisma.exportArtifact.upsert({
    where: { scanId_format: { scanId, format } },
    create: {
      accountId,
      scanId,
      format,
      objectKey,
      contentType: format === 'json' ? 'application/json' : 'text/csv',
    },
    update: {
      objectKey,
      contentType: format === 'json' ? 'application/json' : 'text/csv',
    },
  });
  return { format, objectKey };
}
