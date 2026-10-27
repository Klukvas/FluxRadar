// The Sentry SDK itself, in a chunk of its own.
//
// Only error-monitoring.ts imports this file, and only dynamically, behind the
// build-time DSN check — so a build without VITE_SENTRY_DSN never requests it,
// and the first screen of one with a DSN never waits for it.
//
// Errors only. Integrations are listed instead of taken by default, which
// leaves out everything that is not an error: no session tracking (it sends a
// request on every page load), no tracing, no Session Replay, no console
// capture, no click/input breadcrumbs. Nothing here writes a cookie or browser
// storage; the Cookie Policy's inventory stays complete.

import type { ErrorInfo } from 'react';
import {
  breadcrumbsIntegration,
  dedupeIntegration,
  eventFiltersIntegration,
  functionToStringIntegration,
  globalHandlersIntegration,
  httpContextIntegration,
  init,
  linkedErrorsIntegration,
  reactErrorHandler,
  type BrowserOptions,
} from '@sentry/react';

import {
  MAX_SCANNED_TEXT_LENGTH,
  scrubBreadcrumb,
  scrubBrowserEvent,
} from './error-monitoring-scrub';
import type { ErrorMonitoringSettings, RootErrorReporter } from './error-monitoring';

/** Navigations and the app's own requests; never DOM clicks or the SDK's own events. */
export const BREADCRUMB_SOURCES = {
  dom: false,
  sentry: false,
  history: true,
  fetch: true,
  xhr: true,
} as const;

type RootHandler = (error: unknown, errorInfo: ErrorInfo) => void;

/** Errors whose last frame is not one of this site's own scripts — extensions, injected code — are dropped. */
function ownScripts(origin: string): RegExp {
  const literal = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${literal}/`);
}

/** The SDK options for a page served from `origin`: what this file promises above. */
export function sentryOptions(settings: ErrorMonitoringSettings, origin: string): BrowserOptions {
  return {
    dsn: settings.dsn,
    environment: settings.environment,
    ...(settings.release === null ? {} : { release: settings.release }),
    defaultIntegrations: false,
    integrations: [
      eventFiltersIntegration(),
      functionToStringIntegration(),
      breadcrumbsIntegration(BREADCRUMB_SOURCES),
      globalHandlersIntegration(),
      linkedErrorsIntegration(),
      dedupeIntegration(),
      httpContextIntegration(),
    ],
    allowUrls: [ownScripts(origin)],
    sendClientReports: false,
    // v11 sets no default; the scrubber reads no more than this either.
    maxValueLength: MAX_SCANNED_TEXT_LENGTH,
    // The app reads its own fetch errors; the SDK must not rewrite them.
    enhanceFetchErrorMessages: false,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ['User-Agent'] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: scrubBrowserEvent,
  };
}

/**
 * React does not rethrow what a root handler receives, so an uncaught error is
 * filed as unhandled and a caught or recoverable one as handled.
 */
export function createRootReporter(handlers: {
  readonly unhandled: RootHandler;
  readonly handled: RootHandler;
}): RootErrorReporter {
  return {
    reportRootError: (kind, error, errorInfo) =>
      (kind === 'uncaught' ? handlers.unhandled : handlers.handled)(error, errorInfo),
  };
}

export function startSentry(settings: ErrorMonitoringSettings): RootErrorReporter {
  init(sentryOptions(settings, window.location.origin));
  return createRootReporter({
    unhandled: reactErrorHandler(),
    handled: reactErrorHandler(() => undefined),
  });
}
