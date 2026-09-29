import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { PrismaClient, Scan, SiteProfile } from '@prisma/client';
import type { AiProviderName } from '@fluxradar/ai';

import { actionPlanRouter } from './action-plan/routes.ts';
import type { ActionPlanRouterDeps } from './action-plan/routes.ts';
import { actionPlanPdfLoader } from './action-plan/pdf-loader.ts';
import { readAdminEmails } from './admin/admin-emails.ts';
import { adminStatsRouter } from './admin/routes.ts';
import { LoginRateLimiter, RequestRateLimiter } from './auth/rate-limit.ts';
import { accountRouter } from './auth/account-routes.ts';
import { authRouter } from './auth/routes.ts';
import {
  FREE_CHECK_ALLOWED_ORIGINS_ENV,
  readFreeCheckAllowlist,
} from './billing/free-check-allowlist.ts';
import { getInternalFreeEmails } from './billing/internal-access.ts';
import { dispatchPendingRefunds } from './billing/refunds/dispatcher.ts';
import { internalCheckoutRouter } from './billing-http/internal-checkout-routes.ts';
import { creemRouter, creemWebhookHandler } from './billing-http/creem-routes.ts';
import {
  CREEM_PROVIDER,
  readCreemConfig,
  sweepCreemPendingRefunds,
} from './billing/creem/index.ts';
import type { CreemConfigResult } from './billing/creem/index.ts';
import { PENDING_REFUND_SWEEP_INTERVAL_MS } from './billing/pending-refund-sweep.ts';
import type { FetchLike } from './billing/fetch-like.ts';
import { createPrismaClient } from './db.ts';
import { exportRouter } from './export/routes.ts';
import { reportPdfRouter } from './export/pdf-routes.ts';
import { BackgroundRuns } from './http/background-runs.ts';
import { errorHandler, notFoundHandler } from './http/error-handler.ts';
import { healthRouter } from './http/health.ts';
import { stdoutLogger } from './http/logger.ts';
import { resolveTrustProxy } from './http/trust-proxy.ts';
import type { ApiLogger } from './http/logger.ts';
import { requestLogger } from './http/request-logger.ts';
import { issuesRouter } from './issues/routes.ts';
import { bingIntegrationRouter } from './integrations/bing/routes.ts';
import { createBingDataRunner } from './integrations/bing/runner.ts';
import { googleIntegrationRouter } from './integrations/google/routes.ts';
import { createGoogleDataRunner } from './integrations/google/runner.ts';
import { integrationsRouter } from './integrations/routes.ts';
import { validateRuntimeConfig } from './integrations/config.ts';
import { logIntegrationStatuses, logPerformanceAuditMode } from './integrations/diagnostics.ts';
import { availableOptInAiProviders } from './integrations/opt-in-ai-config.ts';
import { readCrawlEgressLocations } from './integrations/crawl-egress-config.ts';
import { readEgressProbeOptions } from './integrations/crawl-egress-health.ts';
import {
  createEgressLocationMonitor,
  type EgressLocationMonitor,
} from './integrations/crawl-egress-monitor.ts';
import { logEgressUsage, readEgressUsage } from './integrations/crawl-egress-usage.ts';
import { createMailer, type Mailer } from './email/mailer.ts';
import {
  deliverDueScanNotifications,
  waitForScanNotificationDeliveries,
} from './email/notifications.ts';
import { createDefaultPerformanceRunner } from './integrations/performance/index.ts';
import { createDefaultAiProvider } from './orchestrator/geo.ts';
import { createRenderRuntime } from './orchestrator/render-config.ts';
import { sweepRetention } from './data-retention.ts';
import type { DomainVerificationDeps } from './profiles/domain-verification.ts';
import type { WorkerCrawlOptions, WorkerDeps } from './orchestrator/deps.ts';
import { recoverClaimedJobs } from './orchestrator/claim.ts';
import { processPendingJobs, processScan } from './orchestrator/worker.ts';
import { domainVerificationRouter } from './profiles/domain-verification-routes.ts';
import { reachabilityRouter } from './profiles/reachability-routes.ts';
import { profilesRouter } from './profiles/routes.ts';
import { scanComparisonRouter } from './scans/comparison-routes.ts';
import { scansRouter } from './scans/routes.ts';
import { supportRouter } from './support/routes.ts';
import { createSupportChannel, type SupportChannel } from './support/support-channel.ts';
import { createConfiguredObjectStore, type PrivateObjectStore } from './integrations/s3.ts';

export const packageName = '@fluxradar/api';

const QUEUE_RECOVERY_INTERVAL_MS = 30_000;
/**
 * How often every egress location's proxy is re-checked.
 *
 * Five minutes: long enough not to be traffic of its own, short enough that an
 * outage is found by us rather than by the customer whose scan it broke.
 */
const EGRESS_HEALTH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * How often the refund outbox is swept.
 *
 * Far slower than the inbound pending-refund sweep: this one is about money
 * leaving, the queue is an exception path, and in every configuration that has
 * not explicitly enabled outbound refunds the pass only reports the queue.
 */
const REFUND_DISPATCH_SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const EMAIL_NOTIFICATION_SWEEP_INTERVAL_MS = 60 * 1000;

export interface CreateAppOptions {
  readonly prisma: PrismaClient;
  readonly logger?: ApiLogger;
  readonly now?: () => Date;
  readonly autoProcess?: boolean;
  readonly corsOrigin?: string;
  readonly crawl?: WorkerCrawlOptions;
  readonly createAiProvider?: WorkerDeps['createAiProvider'];
  /**
   * Test seam for the Action Plan. It needs its own: `createDefaultAiProvider`
   * answers GEO visibility fixtures under Vitest, which are not a plan.
   */
  readonly createActionPlanProvider?: ActionPlanRouterDeps['createActionPlanProvider'];
  /**
   * Where detached Action Plan generations live. `startServer` passes the one it
   * stops on shutdown; a test passes its own and awaits it.
   */
  readonly actionPlanRuns?: BackgroundRuns;
  readonly createPerformanceRunner?: WorkerDeps['createPerformanceRunner'];
  readonly createGoogleDataRunner?: WorkerDeps['createGoogleDataRunner'];
  /** Test seam for the DNS/HTTP reads the optional ownership proof performs. */
  readonly domainVerification?: DomainVerificationDeps;
  /** Test seam; production reads FLUXRADAR_RENDER_* (orchestrator/render-config.ts). */
  readonly createRenderRuntime?: WorkerDeps['createRenderRuntime'];
  readonly createBingDataRunner?: WorkerDeps['createBingDataRunner'];
  /** Test seam; production reads FLUXRADAR_INTERNAL_FREE_EMAILS. */
  readonly internalFreeEmails?: ReadonlySet<string>;
  /** Test seam; production reads FLUXRADAR_FREE_CHECK_ALLOWED_ORIGINS. */
  readonly freeCheckAllowedOrigins?: ReadonlySet<string>;
  /** Test seam; production reads FLUXRADAR_ADMIN_EMAILS. */
  readonly adminEmails?: ReadonlySet<string>;
  /** Test seam; production uses READINESS_TIMEOUT_MS. */
  readonly readinessTimeoutMs?: number;
  readonly mailer?: Mailer;
  readonly requestRateLimiter?: RequestRateLimiter;
  readonly objectStore?: PrivateObjectStore | null;
  /**
   * The optional AI recipients this deployment can serve, offered to the
   * new-scan form and refused at both checkout routes when a request names one
   * of the others. Test seam; production reads the opt-in provider keys.
   */
  readonly optInAiProviders?: readonly AiProviderName[];
  /** Test seam; production reads the CREEM_* environment. */
  readonly creem?: CreemConfigResult;
  /** Test seam for the Creem Checkout API call. */
  readonly creemFetch?: FetchLike;
  /**
   * Test seam; production reads TELEGRAM_*. An explicit null is a deployment
   * with no support channel, which is not the same as leaving it out.
   */
  readonly supportChannel?: SupportChannel | null;
  /**
   * The egress locations and their health. Test seam; production builds one
   * from the CRAWL_EGRESS_PROXY_URL* environment and re-checks it on a timer.
   */
  readonly egress?: EgressLocationMonitor;
}

/** The monitor of every egress location this environment configures. */
export function createConfiguredEgressMonitor(
  logger: ApiLogger,
  now: () => Date = () => new Date(),
): EgressLocationMonitor {
  return createEgressLocationMonitor({
    locations: readCrawlEgressLocations(),
    logger,
    now,
    probeOptions: readEgressProbeOptions(),
  });
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
  const freeCheckAllowedOrigins =
    options.freeCheckAllowedOrigins ?? resolveFreeCheckAllowedOrigins(logger);
  const requestRateLimiter = options.requestRateLimiter ?? new RequestRateLimiter();
  const mailer = options.mailer ?? createMailer();
  const creem = options.creem ?? readCreemConfig();
  const optInAiProviders = options.optInAiProviders ?? availableOptInAiProviders();
  const supportChannel =
    options.supportChannel !== undefined ? options.supportChannel : createSupportChannel(logger);
  // Undefined means "this deployment did not say", which is the production path:
  // sweepRetention then builds the configured store itself. An explicit null is a
  // caller that wants no storage at all, and must stay null.
  const objectStore = options.objectStore;
  const egress = options.egress ?? createConfiguredEgressMonitor(logger, now);
  logCheckoutState(logger, creem);
  // Names and statuses only; see integrations/diagnostics.ts.
  logIntegrationStatuses(logger);
  logPerformanceAuditMode(logger);
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
      (() => createGoogleDataRunner({ prisma: options.prisma, now, requestOptions: { logger } })),
    createRenderRuntime: options.createRenderRuntime ?? (() => createRenderRuntime()),
    createBingDataRunner:
      options.createBingDataRunner ??
      (() => createBingDataRunner({ prisma: options.prisma, now, requestOptions: { logger } })),
    ...(options.crawl !== undefined ? { crawl: options.crawl } : {}),
    // The same locations the launch was checked against, so a scan cannot be
    // accepted for a location its worker does not know.
    egressLocations: egress.configured,
    mailer,
  };
  void sweepRetention(options.prisma, now(), logger, objectStore);
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
  // Decides what req.ip is, and therefore what every IP-scoped rate limit
  // actually limits. See http/trust-proxy.ts.
  app.set('trust proxy', resolveTrustProxy());
  app.use(requestLogger(logger));
  app.use(
    corsMiddleware(options.corsOrigin ?? process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173'),
  );

  app.use(
    healthRouter({
      prisma: options.prisma,
      ...(options.readinessTimeoutMs !== undefined
        ? { timeoutMs: options.readinessTimeoutMs }
        : {}),
    }),
  );

  // Creem signs the raw bytes (creem-signature, HMAC-SHA256 hex), so its webhook
  // takes the raw body and therefore precedes express.json. Mounted whenever the
  // process runs: an unconfigured provider answers 503 and stores nothing.
  app.post(
    '/webhooks/creem',
    express.raw({ type: 'application/json', limit: '1mb' }),
    creemWebhookHandler({
      prisma: options.prisma,
      creem,
      now,
      enqueueScan,
      mailer,
      requestRateLimiter,
    }),
  );
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
      objectStore,
      logger,
    }),
  );
  app.use(accountRouter({ prisma: options.prisma, now, requestRateLimiter }));
  app.use(
    supportRouter({
      prisma: options.prisma,
      now,
      channel: supportChannel,
      requestRateLimiter,
      logger,
    }),
  );
  app.use(profilesRouter({ prisma: options.prisma, now, requestRateLimiter, objectStore, logger }));
  app.use(
    domainVerificationRouter({
      prisma: options.prisma,
      now,
      requestRateLimiter,
      ...(options.domainVerification !== undefined
        ? { verification: options.domainVerification }
        : {}),
    }),
  );
  // Before the router that sells a scan: a buyer has to be able to find out
  // whether the site will let the crawler in before they are charged for it.
  app.use(
    reachabilityRouter({
      prisma: options.prisma,
      now,
      requestRateLimiter,
      logger,
      egress,
      // The probe leaves from the network the crawl will, including the test
      // seams a fixture site needs, so the two cannot answer differently.
      ...(options.crawl === undefined
        ? {}
        : {
            probe: {
              ...(options.crawl.egressProxy === undefined
                ? {}
                : { egressProxy: options.crawl.egressProxy }),
              ...(options.crawl.dangerouslyAllowLoopback === true
                ? { dangerouslyAllowLoopback: true }
                : {}),
              // A test that stubs the crawl's transport stubs the probe's too:
              // one seam, so the two cannot be given different sites to read.
              ...(options.crawl.fetcher === undefined ? {} : { fetcher: options.crawl.fetcher }),
            },
          }),
    }),
  );
  app.use(integrationsRouter({ prisma: options.prisma, now }));
  app.use(googleIntegrationRouter({ prisma: options.prisma, now, logger }));
  app.use(bingIntegrationRouter({ prisma: options.prisma, now, logger }));
  // The one checkout surface (/billing/checkout-config, /billing/checkout-session),
  // served by Creem: an unconfigured deployment still boots, with paid checkout
  // reported as off (see readCreemConfig / logCheckoutState).
  app.use(
    creemRouter({
      prisma: options.prisma,
      creem,
      now,
      requestRateLimiter,
      optInAiProviders,
      egress,
      ...(options.creemFetch !== undefined ? { fetchImpl: options.creemFetch } : {}),
    }),
  );
  app.use(
    internalCheckoutRouter({
      prisma: options.prisma,
      now,
      enqueueScan,
      internalFreeEmails,
      requestRateLimiter,
      mailer,
      optInAiProviders,
      egress,
    }),
  );
  app.use(
    scansRouter({
      prisma: options.prisma,
      now,
      enqueueScan,
      requestRateLimiter,
      freeCheckAllowedOrigins,
      egress,
    }),
  );
  app.use(issuesRouter({ prisma: options.prisma, now }));
  app.use(scanComparisonRouter({ prisma: options.prisma, now, logger, requestRateLimiter }));
  app.use(
    actionPlanRouter({
      prisma: options.prisma,
      now,
      logger,
      requestRateLimiter,
      ...(options.createActionPlanProvider !== undefined
        ? { createActionPlanProvider: options.createActionPlanProvider }
        : {}),
      ...(options.actionPlanRuns !== undefined ? { backgroundRuns: options.actionPlanRuns } : {}),
    }),
  );
  app.use(
    exportRouter({
      prisma: options.prisma,
      now,
      logger,
      objectStore,
      requestRateLimiter,
    }),
  );
  app.use(
    reportPdfRouter({
      prisma: options.prisma,
      now,
      logger,
      objectStore,
      requestRateLimiter,
      // The slot the PDF renderer left for the AI lane's plan, filled here and
      // nowhere else. `readOwnActionPlan` re-checks that this account owns the
      // scan before it returns anything, and it reads the plan stored for the
      // language the document is being written in — never another one. Only a
      // READY plan exists in that table, so a generation in flight or a failed
      // one yields null and the document simply has no plan chapter.
      loadActionPlan: actionPlanPdfLoader(options.prisma),
    }),
  );
  // Last before the 404: a request it refuses falls through to notFoundHandler,
  // which is what makes a refusal indistinguishable from an unknown route.
  app.use(
    adminStatsRouter({
      prisma: options.prisma,
      now,
      adminEmails: options.adminEmails ?? readAdminEmails(),
      logger,
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}

/** Starts the local HTTP server and drains jobs left in the database. */
export async function startServer(port = Number(process.env.PORT ?? 3000)): Promise<StartedApi> {
  validateRuntimeConfig();
  const prisma = createPrismaClient();
  const logger = stdoutLogger;
  const mailer = createMailer();
  // One store for the whole process: the export route, account deletion and the
  // retention sweep all address the same bucket.
  const objectStore = createConfiguredObjectStore();
  const actionPlanRuns = new BackgroundRuns();
  // One monitor for the process: the timer below refreshes the same answers
  // the launch routes read.
  const egress = createConfiguredEgressMonitor(logger);
  const app = createApp({ prisma, logger, mailer, objectStore, actionPlanRuns, egress });
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
    createGoogleDataRunner: () => createGoogleDataRunner({ prisma, requestOptions: { logger } }),
    createRenderRuntime: () => createRenderRuntime(),
    createBingDataRunner: () => createBingDataRunner({ prisma, requestOptions: { logger } }),
    egressLocations: egress.configured,
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
      void sweepRetention(prisma, new Date(), logger, objectStore);
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
      // An unconfigured provider simply has no rows to sweep.
      await sweepCreemPendingRefunds(prisma, new Date(), logger);
    } finally {
      pendingRefundSweepRunning = false;
    }
  };
  const pendingRefundTimer = setInterval(() => {
    void sweepPending();
  }, PENDING_REFUND_SWEEP_INTERVAL_MS);
  pendingRefundTimer.unref();
  void sweepPending();
  // The outbound half of the same story: refunds this API decided on and has not
  // sent. The pass reports the queue on every deployment; it never submits
  // because no provider has an outbound adapter (Creem refunds are issued by
  // hand from its dashboard), and production boot refuses
  // FLUXRADAR_REFUND_DISPATCH=auto outright (integrations/config.ts).
  let refundDispatchRunning = false;
  const sweepRefundDispatch = async (): Promise<void> => {
    if (refundDispatchRunning) return;
    refundDispatchRunning = true;
    try {
      await dispatchPendingRefunds({
        prisma,
        logger,
        now: () => new Date(),
        // No provider has an outbound adapter yet; Creem refunds are issued by
        // hand from its dashboard (billing/refunds/config.ts, integrations/config.ts).
        adapters: [],
      });
    } catch (error: unknown) {
      logger.error('refund dispatch sweep failed', {
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    } finally {
      refundDispatchRunning = false;
    }
  };
  const refundDispatchTimer = setInterval(() => {
    void sweepRefundDispatch();
  }, REFUND_DISPATCH_SWEEP_INTERVAL_MS);
  refundDispatchTimer.unref();
  void sweepRefundDispatch();
  // Purchase/refund mail is an outbox, not a best-effort side effect. A send
  // that failed or a process that stopped mid-send becomes due again here.
  let emailSweep: Promise<void> | null = null;
  const sweepEmailNotifications = async (): Promise<void> => {
    if (emailSweep !== null) return emailSweep;
    emailSweep = (async () => {
      try {
        await deliverDueScanNotifications(prisma, mailer);
      } catch (error: unknown) {
        logger.error('email notification sweep failed', {
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        });
      } finally {
        emailSweep = null;
      }
    })();
    return emailSweep;
  };
  const emailNotificationTimer = setInterval(() => {
    void sweepEmailNotifications();
  }, EMAIL_NOTIFICATION_SWEEP_INTERVAL_MS);
  emailNotificationTimer.unref();
  void sweepEmailNotifications();
  // Each egress location is one VPS, and every scan from it depends on it.
  // Checked at boot and then periodically, so an outage is a log line here
  // rather than a customer telling us their scans stopped working — and a
  // location that is down stops being offered on the launch screen. Each
  // location's traffic against its own plan's allowance is watched before it
  // runs out rather than after.
  const checkEgress = async (): Promise<void> => {
    await egress.checkAll();
    for (const configured of egress.configured) {
      logEgressUsage(logger, await readEgressUsage(prisma, configured.location, new Date()));
    }
  };
  const egressHealthTimer = setInterval(() => {
    void checkEgress().catch((error: unknown) => {
      logger.error('crawl egress health check failed', {
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    });
  }, EGRESS_HEALTH_INTERVAL_MS);
  egressHealthTimer.unref();
  void checkEgress().catch(() => undefined);
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
      clearInterval(refundDispatchTimer);
      clearInterval(emailNotificationTimer);
      clearInterval(queueRecoveryTimer);
      clearInterval(egressHealthTimer);
      await new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
      });
      // Before the client closes: a plan still talking to Anthropic is cancelled
      // and its attempt released, rather than left holding the scan's slot.
      await actionPlanRuns.stop();
      // No request can enqueue another lifecycle email after server.close().
      // Finish both the timer's pass and any fire-and-forget event send before
      // disconnecting Prisma, so their fenced terminal update is not lost.
      await emailSweep;
      await waitForScanNotificationDeliveries(prisma);
      await prisma.$disconnect();
    },
  };
}

/**
 * The Free-check allowlist this process will honour, reported at boot.
 *
 * An entry that is not an https origin is dropped rather than guessed at, and it
 * is logged by value — the values are public site addresses, and an operator who
 * mistyped one would otherwise believe a domain is exempt while every check
 * still refuses it. An empty or absent variable is the normal state and says
 * nothing.
 */
function resolveFreeCheckAllowedOrigins(logger: ApiLogger): ReadonlySet<string> {
  const allowlist = readFreeCheckAllowlist();
  if (allowlist.rejected.length > 0) {
    logger.error('free-check allowlist entries ignored: not an https origin', {
      variable: FREE_CHECK_ALLOWED_ORIGINS_ENV,
      ignored: allowlist.rejected,
    });
  }
  if (allowlist.origins.size > 0) {
    logger.info('free-check allowlist active', {
      variable: FREE_CHECK_ALLOWED_ORIGINS_ENV,
      origins: [...allowlist.origins],
    });
  }
  return allowlist.origins;
}

/**
 * States, once, whether this deployment sells scans through Creem.
 *
 * The HTTP surface answers a browser with a closed code and no operational
 * detail (see billing-http/creem-routes.ts), so this line is where an operator
 * finds out that paid checkout is off — and, for a half-configured deployment
 * (which never reaches here in production; validateRuntimeConfig fails the boot
 * first), exactly which variables are absent. Names only: no value of any
 * CREEM_* variable is ever read here.
 */
function logCheckoutState(logger: ApiLogger, creem: CreemConfigResult): void {
  if (creem.state === 'invalid') {
    logger.error('paid checkout disabled: Creem is only partially configured', {
      missing: creem.missing,
    });
    return;
  }
  if (creem.state === 'not_configured') {
    logger.info('paid checkout disabled: Creem is not configured');
    return;
  }
  logger.info('paid checkout enabled', { provider: CREEM_PROVIDER, mode: creem.config.mode });
}

function corsMiddleware(origin: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const requestOrigin = req.get('origin');
    if (requestOrigin === origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      // The PDF download reads the filename the server chose. Without this the
      // browser hides Content-Disposition from the fetch and the app has to
      // invent a name for a file the server already named.
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
