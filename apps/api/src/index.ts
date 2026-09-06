import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { PrismaClient, Scan, SiteProfile } from '@prisma/client';

import { LoginRateLimiter, RequestRateLimiter } from './auth/rate-limit.ts';
import { authRouter } from './auth/routes.ts';
import { getInternalFreeEmails } from './billing/internal-access.ts';
import { resolvePaddleWebhookSecret } from './billing/paddle-signature.ts';
import { billingRouter, webhookHandler } from './billing-http/routes.ts';
import { fastSpringRouter, fastSpringWebhookHandler } from './billing-http/fastspring-routes.ts';
import {
  FASTSPRING_PROVIDER,
  PENDING_REFUND_SWEEP_INTERVAL_MS,
  readFastSpringConfig,
  sweepPendingRefunds,
} from './billing/fastspring/index.ts';
import type { FastSpringConfigResult, FetchLike } from './billing/fastspring/index.ts';
import { createPrismaClient } from './db.ts';
import { exportRouter } from './export/routes.ts';
import { errorHandler, notFoundHandler } from './http/error-handler.ts';
import { healthRouter } from './http/health.ts';
import { stdoutLogger } from './http/logger.ts';
import type { ApiLogger } from './http/logger.ts';
import { requestLogger } from './http/request-logger.ts';
import { issuesRouter } from './issues/routes.ts';
import { googleIntegrationRouter } from './integrations/google/routes.ts';
import { createGoogleDataRunner } from './integrations/google/runner.ts';
import { integrationsRouter } from './integrations/routes.ts';
import { validateRuntimeConfig } from './integrations/config.ts';
import { logIntegrationStatuses } from './integrations/diagnostics.ts';
import { createMailer, type Mailer } from './email/mailer.ts';
import { createDefaultPerformanceRunner } from './integrations/performance.ts';
import { createDefaultAiProvider } from './orchestrator/geo.ts';
import { sweepRetention } from './data-retention.ts';
import type { WorkerCrawlOptions, WorkerDeps } from './orchestrator/deps.ts';
import { recoverClaimedJobs } from './orchestrator/claim.ts';
import { processPendingJobs, processScan } from './orchestrator/worker.ts';
import { profilesRouter } from './profiles/routes.ts';
import { scansRouter } from './scans/routes.ts';
import type { PrivateObjectStore } from './integrations/s3.ts';

export const packageName = '@fluxradar/api';

const QUEUE_RECOVERY_INTERVAL_MS = 30_000;

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
  readonly createGoogleDataRunner?: WorkerDeps['createGoogleDataRunner'];
  /** Test seam; production reads FLUXRADAR_INTERNAL_FREE_EMAILS. */
  readonly internalFreeEmails?: ReadonlySet<string>;
  readonly mailer?: Mailer;
  readonly requestRateLimiter?: RequestRateLimiter;
  readonly objectStore?: PrivateObjectStore | null;
  /** Test seam; production reads the FASTSPRING_* environment. */
  readonly fastSpring?: FastSpringConfigResult;
  /** Test seam for the FastSpring Sessions API call. */
  readonly fastSpringFetch?: FetchLike;
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
  const requestRateLimiter = options.requestRateLimiter ?? new RequestRateLimiter();
  const mailer = options.mailer ?? createMailer();
  const fastSpring = options.fastSpring ?? readFastSpringConfig();
  logFastSpringState(logger, fastSpring);
  // Names and statuses only; see integrations/diagnostics.ts.
  logIntegrationStatuses(logger);
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
    createGoogleDataRunner:
      options.createGoogleDataRunner ??
      (() => createGoogleDataRunner({ prisma: options.prisma, now })),
    ...(options.crawl !== undefined ? { crawl: options.crawl } : {}),
    mailer,
  };
  void sweepRetention(options.prisma, now(), logger);
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

  app.use(healthRouter({ prisma: options.prisma }));

  // Providers sign the exact request bytes, so both webhook routes must take the
  // raw body and therefore precede express.json.
  app.post(
    '/webhooks/fastspring',
    express.raw({ type: 'application/json', limit: '1mb' }),
    fastSpringWebhookHandler({
      prisma: options.prisma,
      fastSpring,
      now,
      enqueueScan,
      mailer,
      requestRateLimiter,
    }),
  );
  // The MockPaddle webhook is a development affordance: mounting it in
  // production would leave a second, non-provider way to mint an entitlement.
  if (process.env.NODE_ENV !== 'production') {
    app.post(
      '/webhooks/paddle',
      express.raw({ type: 'application/json', limit: '1mb' }),
      webhookHandler({
        prisma: options.prisma,
        webhookSecret: options.webhookSecret,
        now,
        requestRateLimiter,
      }),
    );
  }
  app.use(express.json({ limit: '1mb' }));

  app.use(
    authRouter({
      prisma: options.prisma,
      loginRateLimiter: new LoginRateLimiter(),
      requestRateLimiter,
      mailer,
      frontendOrigin: options.corsOrigin ?? process.env.FRONTEND_ORIGIN,
      now,
      internalFreeEmails,
      objectStore: options.objectStore,
      logger,
    }),
  );
  app.use(profilesRouter({ prisma: options.prisma, now }));
  app.use(integrationsRouter({ prisma: options.prisma, now }));
  app.use(googleIntegrationRouter({ prisma: options.prisma, now }));
  app.use(
    fastSpringRouter({
      prisma: options.prisma,
      fastSpring,
      now,
      requestRateLimiter,
      ...(options.fastSpringFetch !== undefined ? { fetchImpl: options.fastSpringFetch } : {}),
    }),
  );
  app.use(
    billingRouter({
      prisma: options.prisma,
      webhookSecret: options.webhookSecret,
      now,
      enqueueScan,
      internalFreeEmails,
      requestRateLimiter,
      mailer,
    }),
  );
  app.use(scansRouter({ prisma: options.prisma, now, enqueueScan, requestRateLimiter }));
  app.use(issuesRouter({ prisma: options.prisma, now }));
  app.use(exportRouter({ prisma: options.prisma, now, logger, objectStore: options.objectStore }));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}

/** Starts the local HTTP server and drains jobs left in the database. */
export async function startServer(port = Number(process.env.PORT ?? 3000)): Promise<StartedApi> {
  validateRuntimeConfig();
  const prisma = createPrismaClient();
  const logger = stdoutLogger;
  const webhookSecret = resolvePaddleWebhookSecret();
  const mailer = createMailer();
  const app = createApp({ prisma, webhookSecret, logger, mailer });
  // Recover before listen so a newly submitted scan cannot be claimed by the
  // HTTP path while startup is requeueing jobs left by the previous process.
  const recovered = await recoverClaimedJobs(prisma);
  if (recovered > 0) logger.info('recovered claimed scan jobs', { recoveredCount: recovered });
  const server = app.listen(port);
  await new Promise<void>((resolveReady, reject) => {
    server.once('listening', resolveReady);
    server.once('error', reject);
  });
  const workerDeps: WorkerDeps = {
    prisma,
    logger,
    mailer,
    createAiProvider: (scan, profile) =>
      createDefaultAiProvider(profile.name, new URL(scan.domain).hostname),
    createPerformanceRunner: () => createDefaultPerformanceRunner(),
    createGoogleDataRunner: () => createGoogleDataRunner({ prisma }),
  };
  let queueDrainRunning = false;
  const drainQueue = async (): Promise<void> => {
    if (queueDrainRunning) return;
    queueDrainRunning = true;
    try {
      await processPendingJobs(workerDeps);
    } catch (error: unknown) {
      logger.error('queue drain failed', {
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    } finally {
      queueDrainRunning = false;
    }
  };
  const retentionTimer = setInterval(
    () => {
      void sweepRetention(prisma, new Date(), logger);
    },
    60 * 60 * 1000,
  );
  retentionTimer.unref();
  // A refund stored while its order was being granted is invisible to that
  // transaction's replay, so it stays pending until something looks for it again.
  // This is that something; it runs far more often than retention because what it
  // is waiting to fix is a refunded buyer still reading their report.
  let pendingRefundSweepRunning = false;
  const sweepPending = async (): Promise<void> => {
    if (pendingRefundSweepRunning) return;
    pendingRefundSweepRunning = true;
    try {
      await sweepPendingRefunds(prisma, new Date(), logger);
    } finally {
      pendingRefundSweepRunning = false;
    }
  };
  const pendingRefundTimer = setInterval(() => {
    void sweepPending();
  }, PENDING_REFUND_SWEEP_INTERVAL_MS);
  pendingRefundTimer.unref();
  void sweepPending();
  const queueRecoveryTimer = setInterval(() => {
    void recoverClaimedJobs(prisma)
      .then((recoveredCount) => {
        if (recoveredCount > 0) logger.info('recovered expired scan jobs', { recoveredCount });
        return drainQueue();
      })
      .catch((error: unknown) => {
        logger.error('queue recovery failed', {
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        });
      });
  }, QUEUE_RECOVERY_INTERVAL_MS);
  queueRecoveryTimer.unref();
  void drainQueue();
  return {
    app,
    server,
    close: async () => {
      clearInterval(retentionTimer);
      clearInterval(pendingRefundTimer);
      clearInterval(queueRecoveryTimer);
      await new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
      });
      await prisma.$disconnect();
    },
  };
}

/**
 * States, once, whether this deployment sells scans.
 *
 * The HTTP surface answers a browser with a closed code and no operational
 * detail (see billing-http/fastspring-routes.ts), so this line is where an
 * operator finds out that paid checkout is off — and, for a half-configured
 * provider that refuses to boot, exactly which variables are absent. Names
 * only: no value of any FASTSPRING_* variable is ever read here.
 */
function logFastSpringState(logger: ApiLogger, result: FastSpringConfigResult): void {
  if (result.state === 'configured') {
    logger.info('paid checkout enabled', {
      provider: FASTSPRING_PROVIDER,
      mode: result.config.mode,
      sessionApi: result.config.sessionApi,
      currencyPolicy: result.config.currencyPolicy,
    });
    return;
  }
  if (result.state === 'invalid') {
    logger.error('paid checkout disabled: provider is only partially configured', {
      provider: FASTSPRING_PROVIDER,
      missing: result.missing,
    });
    return;
  }
  logger.info('paid checkout disabled: provider is not configured', {
    provider: FASTSPRING_PROVIDER,
  });
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
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, paddle-signature, x-fs-signature',
      );
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
