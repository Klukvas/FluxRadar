import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { PrismaClient, Scan, SiteProfile } from '@prisma/client';

import { LoginRateLimiter } from './auth/rate-limit.ts';
import { authRouter } from './auth/routes.ts';
import { getInternalFreeEmails } from './billing/internal-access.ts';
import { getPaddleWebhookSecret } from './billing/paddle-signature.ts';
import { billingRouter, webhookHandler } from './billing-http/routes.ts';
import { createPrismaClient } from './db.ts';
import { exportRouter } from './export/routes.ts';
import { errorHandler, notFoundHandler } from './http/error-handler.ts';
import { stdoutLogger } from './http/logger.ts';
import type { ApiLogger } from './http/logger.ts';
import { requestLogger } from './http/request-logger.ts';
import { issuesRouter } from './issues/routes.ts';
import { integrationsRouter } from './integrations/routes.ts';
import { createDefaultPerformanceRunner } from './integrations/performance.ts';
import { createDefaultAiProvider } from './orchestrator/geo.ts';
import { purgeExpiredScans } from './data-retention.ts';
import type { WorkerCrawlOptions, WorkerDeps } from './orchestrator/deps.ts';
import { processPendingJobs, processScan } from './orchestrator/worker.ts';
import { profilesRouter } from './profiles/routes.ts';
import { scansRouter } from './scans/routes.ts';

export const packageName = '@fluxradar/api';

export interface CreateAppOptions {
  readonly prisma: PrismaClient;
  readonly webhookSecret: string;
  readonly logger?: ApiLogger;
  readonly now?: () => Date;
  readonly autoProcess?: boolean;
  readonly corsOrigin?: string;
  readonly crawl?: WorkerCrawlOptions;
  readonly createAiProvider?: WorkerDeps['createAiProvider'];
  readonly createPerformanceRunner?: WorkerDeps['createPerformanceRunner'];
  /** Test seam; production reads FLUXRADAR_INTERNAL_FREE_EMAILS. */
  readonly internalFreeEmails?: ReadonlySet<string>;
}

export interface StartedApi {
  readonly app: Express;
  readonly server: ReturnType<Express['listen']>;
  readonly close: () => Promise<void>;
}

/** Builds the API without opening a socket; supertest and integrations use this seam. */
export function createApp(options: CreateAppOptions): Express {
  const logger = options.logger ?? stdoutLogger;
  const now = options.now ?? (() => new Date());
  const internalFreeEmails = options.internalFreeEmails ?? getInternalFreeEmails();
  const workerDeps: WorkerDeps = {
    prisma: options.prisma,
    logger,
    now,
    createAiProvider:
      options.createAiProvider ??
      ((scan: Scan, profile: SiteProfile) =>
        createDefaultAiProvider(profile.name, new URL(scan.domain).hostname)),
    createPerformanceRunner:
      options.createPerformanceRunner ?? (() => createDefaultPerformanceRunner()),
    ...(options.crawl !== undefined ? { crawl: options.crawl } : {}),
  };
  void purgeExpiredScans(options.prisma, now()).catch((error: unknown) => {
    logger.error('retention sweep failed', {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  });
  const scheduled = new Set<string>();
  const enqueueScan = (scanId: string): void => {
    if (options.autoProcess === false || scheduled.has(scanId)) {
      return;
    }
    scheduled.add(scanId);
    void processScan(workerDeps, scanId)
      .catch((error: unknown) => {
        logger.error('background scan failed', {
          scanId,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        });
      })
      .finally(() => scheduled.delete(scanId));
  };

  const app = express();
  app.disable('x-powered-by');
  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }
  app.use(requestLogger(logger));
  app.use(
    corsMiddleware(options.corsOrigin ?? process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173'),
  );

  app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true, data: { service: 'api', status: 'ok' }, error: null });
  });

  // Paddle signs the exact request bytes. This route must precede express.json.
  app.post(
    '/webhooks/paddle',
    express.raw({ type: 'application/json', limit: '1mb' }),
    webhookHandler({ prisma: options.prisma, webhookSecret: options.webhookSecret, now }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.use(
    authRouter({
      prisma: options.prisma,
      loginRateLimiter: new LoginRateLimiter(),
      now,
      internalFreeEmails,
    }),
  );
  app.use(profilesRouter({ prisma: options.prisma, now }));
  app.use(integrationsRouter({ prisma: options.prisma, now }));
  app.use(
    billingRouter({
      prisma: options.prisma,
      webhookSecret: options.webhookSecret,
      now,
      enqueueScan,
      internalFreeEmails,
    }),
  );
  app.use(scansRouter({ prisma: options.prisma, now, enqueueScan }));
  app.use(issuesRouter({ prisma: options.prisma, now }));
  app.use(exportRouter({ prisma: options.prisma, now }));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}

/** Starts the local HTTP server and drains jobs left in the database. */
export async function startServer(port = Number(process.env.PORT ?? 3000)): Promise<StartedApi> {
  const prisma = createPrismaClient();
  const logger = stdoutLogger;
  const webhookSecret = getPaddleWebhookSecret();
  const app = createApp({ prisma, webhookSecret, logger });
  const server = app.listen(port);
  await new Promise<void>((resolveReady, reject) => {
    server.once('listening', resolveReady);
    server.once('error', reject);
  });
  const workerDeps: WorkerDeps = {
    prisma,
    logger,
    createAiProvider: (scan, profile) =>
      createDefaultAiProvider(profile.name, new URL(scan.domain).hostname),
    createPerformanceRunner: () => createDefaultPerformanceRunner(),
  };
  const retentionTimer = setInterval(
    () => {
      void purgeExpiredScans(prisma, new Date()).catch((error: unknown) => {
        logger.error('retention sweep failed', {
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        });
      });
    },
    60 * 60 * 1000,
  );
  retentionTimer.unref();
  void processPendingJobs(workerDeps).catch((error: unknown) => {
    logger.error('startup job drain failed', {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  });
  return {
    app,
    server,
    close: async () => {
      clearInterval(retentionTimer);
      await new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
      });
      await prisma.$disconnect();
    },
  };
}

function corsMiddleware(origin: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const requestOrigin = req.get('origin');
    if (requestOrigin === origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, paddle-signature');
      res.status(204).end();
      return;
    }
    next();
  };
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
  void startServer().catch((error: unknown) => {
    stdoutLogger.error('API failed to start', {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    process.exitCode = 1;
  });
}

export * from './db.ts';
export * from './billing/index.ts';
export * from './orchestrator/worker.ts';
