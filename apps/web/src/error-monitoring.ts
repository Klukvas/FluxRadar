// Error monitoring for the site (Sentry): whether it runs, and the React root
// handlers that feed it.
//
// Off unless the build was given a usable EU-region VITE_SENTRY_DSN
// (sentry-dsn.ts), and never under Vitest. Off means off: the SDK chunk is never requested, the roots keep
// React's own error handling, and the page makes no request it did not make
// before. On, the chunk (error-monitoring-sentry.ts) is fetched once from this
// origin after startup, and Sentry itself is contacted only when an error is
// reported.

import type { ErrorInfo } from 'react';
import type { RootOptions } from 'react-dom/client';

import { sentryDsnProblem } from './sentry-dsn';

export type RootErrorKind = 'uncaught' | 'caught' | 'recoverable';

/** What the SDK side offers the roots; error-monitoring-sentry.ts builds the real one. */
export interface RootErrorReporter {
  reportRootError(kind: RootErrorKind, error: unknown, errorInfo: ErrorInfo): void;
}

export interface ErrorMonitoringSettings {
  readonly dsn: string;
  readonly release: string | null;
  /** The Vite mode, so a staging build is never filed as production. */
  readonly environment: string;
}

export interface BuildValues {
  readonly dsn: string | undefined;
  readonly release: string | undefined;
  readonly mode: string;
  readonly isVitest: boolean;
}

export type RootErrorHandlers = Pick<
  RootOptions,
  'onUncaughtError' | 'onCaughtError' | 'onRecoverableError'
>;

/** What this build reports with, or null when it reports nothing. */
export function errorMonitoringSettings(values: BuildValues): ErrorMonitoringSettings | null {
  const dsn = values.dsn?.trim() ?? '';
  if (dsn === '' || values.isVitest || values.mode === 'test') return null;
  // A production build never gets here with a bad DSN: vite.config.ts refuses
  // to build it. A dev server does, and says so once instead of failing.
  const problem = sentryDsnProblem(dsn, values.mode);
  if (problem !== null) {
    console.warn(
      `FluxRadar: error monitoring is off: VITE_SENTRY_DSN is set but unusable: ${problem}`,
    );
    return null;
  }
  const release = values.release?.trim() ?? '';
  return { dsn, release: release === '' ? null : release, environment: values.mode };
}

// The bare build-time checks are what let a build without a DSN drop this
// module's code and the dynamic import below, and with it the whole SDK chunk.
// Evaluated once per page load, so a refused DSN is warned about once.
const SETTINGS = import.meta.env.VITE_SENTRY_DSN
  ? errorMonitoringSettings({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      release: import.meta.env.VITE_SENTRY_RELEASE,
      mode: import.meta.env.MODE,
      isVitest: Boolean(import.meta.env.VITEST),
    })
  : null;

let reporter: Promise<RootErrorReporter | null> = Promise.resolve(null);
let started = false;

function loadSentry(settings: ErrorMonitoringSettings): Promise<RootErrorReporter | null> {
  if (!import.meta.env.VITE_SENTRY_DSN) return Promise.resolve(null);
  return import('./error-monitoring-sentry')
    .then(({ startSentry }) => startSentry(settings))
    .catch((error: unknown) => {
      console.warn('FluxRadar: error monitoring could not start', error);
      return null;
    });
}

/** Called once from main.tsx, before the first render. */
export function startErrorMonitoring(): void {
  if (started || SETTINGS === null) return;
  started = true;
  reporter = loadSentry(SETTINGS);
}

/** React's own default prints the component stack beside the error; so does this. */
function writeLikeReact(error: unknown, componentStack?: string | null): void {
  if (componentStack === undefined || componentStack === null) console.error(error);
  else console.error(error, componentStack);
}

/**
 * The root handlers, given where the reporter will come from. Each error is
 * written to the console as React would have, and is reported once the SDK has
 * loaded — the promise holds anything that happens before that, such as a
 * hydration error. With no reporter it is only written to the console.
 */
export function createRootErrorHandlers(
  currentReporter: () => Promise<RootErrorReporter | null>,
  writeToConsole: (error: unknown, componentStack?: string | null) => void = writeLikeReact,
): RootErrorHandlers {
  const forward =
    (kind: RootErrorKind) =>
    (error: unknown, errorInfo: ErrorInfo): void => {
      writeToConsole(error, errorInfo.componentStack);
      void currentReporter().then((sentry) => sentry?.reportRootError(kind, error, errorInfo));
    };
  return {
    onUncaughtError: forward('uncaught'),
    onCaughtError: forward('caught'),
    onRecoverableError: forward('recoverable'),
  };
}

/** For `createRoot` / `hydrateRoot`: empty without monitoring, so React keeps its defaults. */
export function rootErrorHandlers(): RootErrorHandlers {
  return SETTINGS === null ? {} : createRootErrorHandlers(() => reporter);
}
