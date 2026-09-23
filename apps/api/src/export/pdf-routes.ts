// `GET /scans/:scanId/report.pdf` — the complete report as one downloadable file.
//
// WHY THIS EXISTS ALONGSIDE THE PRINTABLE PAGE. The browser report
// (apps/web/src/PrintReport.tsx) stops at 1 000 findings, because a single-page
// app cannot fetch and lay out more than that without taking minutes and then
// running out of memory. A scan of a large site regularly exceeds it, and the
// page then quietly described a smaller site than the customer has. This route
// renders on the server, streams the findings out of the database a page at a
// time, and writes every one of them. The printable page stays exactly where it
// was, as the fallback.
//
// THE SAME GUARDS AS EVERY OTHER REPORT READ. Session auth, ownership, and
// `assertPaidReportAccess` — a refunded or reversed purchase cannot download the
// report its money was returned for. The Free check is excluded: it is a single
// homepage check, and the printable page already covers it.
//
// Nothing in the rendering path fetches anything. There are no images, no
// stylesheets and no remote fonts (export/pdf/fonts.ts), so a report cannot be
// made to issue a request on the server's behalf.

import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { FINDING_LANGUAGES, type FindingLanguage } from '@fluxradar/rules';
import type { ScanExportStatus } from '@fluxradar/contracts';
import { z } from 'zod';

import { accountIdFrom, requireAuth } from '../auth/middleware.ts';
import {
  EXPORT_ACTION_IP_LIMIT,
  EXPORT_ACTION_LIMIT,
  EXPORT_ACTION_WINDOW_MS,
  RequestRateLimiter,
  accountAndIpRules,
} from '../auth/rate-limit.ts';
import { PAID_ACCESS_INCLUDE, assertPaidReportAccess } from '../billing/report-access.ts';
import { ApiError, conflict, forbidden, notFound } from '../http/errors.ts';
import type { ApiLogger } from '../http/logger.ts';
import { silentLogger } from '../http/logger.ts';
import { requiredParam } from '../http/params.ts';
import { parseInput } from '../http/validate.ts';
import {
  createConfiguredObjectStore,
  reportObjectKey,
  type PrivateObjectStore,
} from '../integrations/s3.ts';
import { renderReportPdf, type ActionPlanLoader } from './pdf/render.ts';

export interface PdfRouterDeps {
  readonly prisma: PrismaClient;
  readonly now: () => Date;
  readonly objectStore?: PrivateObjectStore | null;
  readonly logger?: ApiLogger;
  readonly requestRateLimiter?: RequestRateLimiter;
  /**
   * Optional projection of the scan's action plan. The AI features lane owns
   * what produces one; without it the section is simply absent.
   */
  readonly loadActionPlan?: ActionPlanLoader;
  /**
   * Called when the background archive has finished, whichever way it went.
   *
   * It exists because the archive deliberately outlives the response: without a
   * signal, a test could only assert on it by sleeping, and "did the download
   * wait for the store?" is exactly what has to be provable here.
   */
  readonly onArchived?: (outcome: ArchiveOutcome) => void;
}

export type ArchiveOutcome = 'stored' | 'no-store' | 'failed';

const querySchema = z.object({ language: z.enum(FINDING_LANGUAGES).default('en') });

/**
 * The most findings this route will lay out in one document.
 *
 * There has to be a number: the renderer holds one database page of findings at a
 * time, but the PDF it is building is in memory in full, and a scan with a
 * hundred thousand findings would take the process down with it. What matters is
 * which way the limit fails. It REFUSES, with a code and a sentence naming the
 * complete alternative, rather than producing a document that stops early and
 * looks finished — a report that silently described 20 000 of 90 000 problems is
 * worse than no report, because the reader has no way to tell.
 *
 * It is an order of magnitude above the printable page's 1 000, and above any
 * scan this product's own crawl budget can produce.
 */
export const PDF_FINDING_LIMIT = 20_000;

const EXPORTABLE_STATUSES = new Set<ScanExportStatus>([
  'Partial',
  'Completed',
  'Failed',
  'Cancelled',
]);

/** A filename a browser will accept, with the domain in it for the customer. */
function attachmentName(domain: string, scanId: string): string {
  const host = safeHost(domain);
  return `fluxradar-${host}-${scanId}.pdf`;
}

function safeHost(domain: string): string {
  let host = domain;
  try {
    host = new URL(domain).host;
  } catch {
    // Not a URL: fall through and sanitise whatever was stored.
  }
  const cleaned = host.replaceAll(/[^A-Za-z0-9.-]/g, '-');
  return cleaned === '' ? 'report' : cleaned;
}

export function reportPdfRouter(deps: PdfRouterDeps): Router {
  const router = Router();
  const auth = requireAuth(deps.prisma, deps.now);
  const requestRateLimiter = deps.requestRateLimiter ?? new RequestRateLimiter();
  const logger = deps.logger ?? silentLogger;

  router.get('/scans/:scanId/report.pdf', auth, async (req, res) => {
    const accountId = accountIdFrom(res);
    const scanId = requiredParam(req.params.scanId, 'scanId');
    // Rendering reads every finding of the scan and lays them out; it belongs
    // with the export in the heavy-read bucket rather than in the ordinary one.
    requestRateLimiter.assertAllowedAll(
      accountAndIpRules('scan-report-pdf', accountId, req.ip ?? 'unknown', {
        account: EXPORT_ACTION_LIMIT,
        ip: EXPORT_ACTION_IP_LIMIT,
        windowMs: EXPORT_ACTION_WINDOW_MS,
      }),
    );
    const scan = await deps.prisma.scan.findFirst({
      where: { id: scanId, accountId },
      include: { modules: true, ...PAID_ACCESS_INCLUDE },
    });
    if (scan === null) throw notFound('scan not found');
    assertPaidReportAccess(scan);
    if (scan.plan === 'Free') {
      throw forbidden(
        'PDF_PAID_PLAN_ONLY',
        'the downloadable PDF report is part of a paid scan; the Free check has the printable page',
      );
    }
    if (!EXPORTABLE_STATUSES.has(scan.status as ScanExportStatus)) {
      throw conflict(
        'EXPORT_NOT_READY',
        'the report is available after the scan reaches a terminal status',
      );
    }

    const findingCount = await deps.prisma.issue.count({ where: { scanId } });
    if (findingCount > PDF_FINDING_LIMIT) {
      throw new ApiError(
        413,
        'PDF_TOO_LARGE',
        `this scan has ${findingCount} findings, more than the ${PDF_FINDING_LIMIT} this document ` +
          'can hold; the JSON and CSV exports carry all of them',
      );
    }

    const language: FindingLanguage = parseInput(querySchema, req.query).language;
    const rendered = await renderReportPdf({
      prisma: deps.prisma,
      scan,
      language,
      now: deps.now(),
      ...(deps.loadActionPlan === undefined ? {} : { loadActionPlan: deps.loadActionPlan }),
    });
    res
      .status(200)
      .type('application/pdf')
      .setHeader(
        'Content-Disposition',
        `attachment; filename="${attachmentName(scan.domain, scan.id)}"`,
      )
      .setHeader('Content-Length', String(rendered.bytes.byteLength))
      .setHeader('X-Fluxradar-Findings', String(rendered.findingCount))
      .send(rendered.bytes);

    // Only now, and never awaited by the request: the customer already has the
    // whole report, and an object store having a slow minute must not turn into
    // a slow download — or, if it never answers at all, into a request that
    // hangs until the client gives up. `archivePdf` resolves rather than
    // rejects, and the trailing catch is there so that a future change to it
    // cannot become an unhandled rejection.
    void archivePdf(deps, logger, accountId, scanId, rendered.bytes)
      .then((outcome) => deps.onArchived?.(outcome))
      .catch((error: unknown) => {
        logger.error('report pdf archive failed', {
          scanId,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        });
      });
  });

  return router;
}

/**
 * Stores the rendered PDF beside the JSON and CSV artifacts, when this
 * deployment has a store that can take bytes.
 *
 * A storage failure is logged and swallowed, which is the opposite of what the
 * JSON export does — and deliberately so. There the stored object IS the
 * deliverable; here the response already carries the whole report, and failing
 * the download because an archive copy could not be written would take something
 * away from the customer to fix a problem that is ours.
 *
 * It never rejects, for the same reason: it runs after the response, where a
 * rejection has nobody to tell.
 */
async function archivePdf(
  deps: PdfRouterDeps,
  logger: ApiLogger,
  accountId: string,
  scanId: string,
  bytes: Buffer,
): Promise<ArchiveOutcome> {
  let objectKey = '';
  try {
    const store = deps.objectStore === undefined ? createConfiguredObjectStore() : deps.objectStore;
    if (store === null || store === undefined || store.putBytes === undefined) return 'no-store';
    objectKey = reportObjectKey(accountId, scanId, 'pdf');
    await store.putBytes(objectKey, bytes, 'application/pdf');
    await deps.prisma.exportArtifact.upsert({
      where: { scanId_format: { scanId, format: 'pdf' } },
      create: { accountId, scanId, format: 'pdf', objectKey, contentType: 'application/pdf' },
      update: { objectKey, contentType: 'application/pdf' },
    });
    return 'stored';
  } catch (error) {
    logger.error('report pdf archive failed', {
      scanId,
      objectKey,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    return 'failed';
  }
}
