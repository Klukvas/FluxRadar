// Error reports to Sentry: errors only, and only from a running server.
//
// `@sentry/node` is initialised WITHOUT its default integrations, so nothing
// is instrumented: no tracing, no profiling, no OpenTelemetry provider, no
// module-load hooks, no http/fetch/console wrappers — and therefore no
// breadcrumbs, which would otherwise carry outgoing request URLs (PageSpeed
// puts its API key in the query string) and whatever reached the console.
// What remains is the error path itself: uncaught exceptions (an unhandled
// rejection still crashes the process the way Node always made it, through
// the same handler), linked causes, source lines around each frame and the
// runtime's own context. Every `logger.error` reaches it through
// `withErrorReporting` (reporting-logger.ts), and every event is scrubbed on
// the way out (report-scrub.ts).
//
// Never under a test runner. The API test command loads the repository `.env`,
// which on a developer machine can hold live credentials — a DSN among them —
// and a test run must not file a single report, whatever that file says.

import * as Sentry from '@sentry/node';

import { scrubEvent } from './report-scrub.ts';
import { readSentryConfig, type SentryConfig } from './sentry-config.ts';

/** How long a shutdown waits for reports still in flight before it gives up on them. */
export const SHUTDOWN_FLUSH_TIMEOUT_MS = 2_000;

export interface ErrorReporter {
  /**
   * Files one event for one logged error, grouped by `message`. With an Error
   * as `cause` the event carries that error's own stack; without one it is a
   * message event. Never throws.
   */
  report(
    message: string,
    context: Readonly<Record<string, unknown>> | undefined,
    cause: unknown,
  ): void;
  /** Resolves true once everything queued has been sent, false on timeout. */
  flush(timeoutMs: number): Promise<boolean>;
}

/** The rule `createDefaultAiProvider` and the object store follow, read strictly: any VITEST value counts. */
export function isTestRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'test' || (env.VITEST ?? '') !== '';
}

/** The SDK options: what this file promises above, in one reviewable object. */
export function sentryOptions(config: SentryConfig): Sentry.NodeOptions {
  return {
    dsn: config.dsn,
    environment: config.environment,
    ...(config.release === null ? {} : { release: config.release }),
    integrations: [
      Sentry.eventFiltersIntegration(),
      Sentry.functionToStringIntegration(),
      Sentry.linkedErrorsIntegration(),
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.contextLinesIntegration(),
      Sentry.nodeContextIntegration(),
    ],
    enableOpenTelemetrySetup: false,
    enableRuntimeChannelInjection: false,
    // Without tracing there are no spans; "static" also keeps the client from
    // installing the span-streaming buffer it otherwise adds on its own.
    traceLifecycle: 'static',
    // os.hostname() otherwise: a container id in production, but the owner's
    // machine name on a developer run, and the privacy policy lists no hostname.
    includeServerName: false,
    // Each of these would otherwise be switched on by an environment variable.
    debug: false,
    spotlight: false,
    // Outcome counts sent on a timer: not errors, so not sent.
    sendClientReports: false,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    // v11's replacement for `sendDefaultPii: false`, spelled out field by field
    // because each default is "collect".
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    includeLocalVariables: false,
    shutdownTimeout: SHUTDOWN_FLUSH_TIMEOUT_MS,
    beforeSend: (event) => scrubEvent(event),
  };
}

/** The three SDK calls a reporter makes; a test hands in its own. */
export type SentryCapture = Pick<typeof Sentry, 'captureException' | 'captureMessage' | 'flush'>;

export function createSentryReporter(sdk: SentryCapture): ErrorReporter {
  return {
    report(message, context, cause) {
      const captureContext = {
        level: 'error' as const,
        // One issue per log line, however many different errors arrive under it.
        fingerprint: [message],
        contexts: { api_log: { message, ...context } },
      };
      if (cause instanceof Error) {
        sdk.captureException(cause, captureContext);
      } else {
        sdk.captureMessage(message, captureContext);
      }
    },
    flush: (timeoutMs) => sdk.flush(timeoutMs),
  };
}

/**
 * Initialises Sentry once, for the process that serves traffic, and returns
 * the reporter the logger feeds — or null when there is nothing to report to:
 * no SENTRY_DSN, an unusable one (the production boot refuses it by name, and
 * the startup diagnostics say so everywhere else), or a test runner.
 */
export function startErrorReporting(env: NodeJS.ProcessEnv = process.env): ErrorReporter | null {
  if (isTestRuntime(env)) return null;
  const result = readSentryConfig(env);
  if (result.state !== 'configured') return null;
  Sentry.initWithoutDefaultIntegrations(sentryOptions(result.config));
  return createSentryReporter(Sentry);
}
