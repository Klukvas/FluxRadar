// Error monitoring (Sentry) configuration.
//
// One optional variable, SENTRY_DSN. Absent or empty is a supported state: the
// API reports errors nowhere but its own log, exactly as it did before Sentry.
// Present but unusable is not — a mistyped DSN reads as "monitoring is on"
// while every report goes nowhere, and one of another region would store
// reports where the privacy policy says they are not — so, like every other
// half-configured integration, it fails the production boot by NAME
// (integrations/config.ts). The DSN only lets its holder send events, but it
// is still never logged.
//
// SENTRY_RELEASE is the git SHA the image was built from (Dockerfile.api bakes
// it in), so a report names the deploy it came from. On its own it turns
// nothing on: every production image carries it, with or without a DSN.

export const SENTRY_ENV_VARS = {
  dsn: 'SENTRY_DSN',
  release: 'SENTRY_RELEASE',
} as const;

export interface SentryConfig {
  readonly dsn: string;
  /** NODE_ENV, so a report from a developer machine is never filed as production. */
  readonly environment: string;
  readonly release: string | null;
}

export type SentryConfigResult =
  | { readonly state: 'configured'; readonly config: SentryConfig }
  | { readonly state: 'not_configured' }
  | { readonly state: 'invalid'; readonly missing: readonly string[]; readonly reason: string };

/**
 * Plain http is accepted for these hosts outside production only: it is how a
 * developer points the SDK at a local fake ingest to see what would be sent.
 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Sentry's EU (Germany) ingest. The privacy policy says reports are stored
 * there and the web CSP admits nothing else, so a DSN of another region is a
 * configuration error, not a choice.
 */
export const EU_INGEST_HOST_SUFFIX = '.ingest.de.sentry.io';

/**
 * The DSN grammar the SDK itself parses (@sentry/core's dsn.js), narrowed to
 * what this API accepts. A DSN outside it is not an error the SDK raises: it
 * prints the whole DSN to stderr and then reports nothing, while this reader
 * would have called it configured. So it is refused here, before the SDK sees it.
 */
const SDK_DSN_GRAMMAR =
  /^https?:\/\/\w+(?::\w*)?@(?:\[[:.%\w]+\]|[\w.-]+)(?::\d+)?\/(?:[^?#\s]*\/)?\d+$/;

/** A commit SHA or a tag-like name; Sentry refuses whitespace and slashes in a release. */
const RELEASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+@-]{0,199}$/;

function trimmed(value: string | undefined): string | null {
  const result = value?.trim() ?? '';
  return result === '' ? null : result;
}

/** Why a DSN cannot be used, or null when it can. Never quotes the value. */
function dsnProblem(raw: string, isProduction: boolean): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'it is not a URL';
  }
  const isLocalIngest =
    !isProduction && url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !isLocalIngest) return 'it must be an https:// DSN';
  if (!isLocalIngest && !url.hostname.endsWith(EU_INGEST_HOST_SUFFIX)) {
    return `it must be a Sentry EU (Germany) DSN on *${EU_INGEST_HOST_SUFFIX}`;
  }
  if (url.username === '') return 'it carries no public key';
  if (!/^\w+$/.test(url.username) || !/^\w*$/.test(url.password)) {
    return 'its key may hold only letters, digits and underscores (a Sentry key is 32 hex characters)';
  }
  if (url.search !== '' || url.hash !== '') return 'it must not carry a query string or fragment';
  if (!/\/\d+$/.test(url.pathname)) return 'it does not end in a numeric project id';
  if (!SDK_DSN_GRAMMAR.test(raw)) {
    return 'it is not in the form https://<key>@<host>/<project id> the Sentry SDK reads';
  }
  return null;
}

function invalid(variable: string, problem: string): SentryConfigResult {
  return {
    state: 'invalid',
    missing: [variable],
    reason: `${variable} is set but unusable: ${problem}`,
  };
}

export function readSentryConfig(env: NodeJS.ProcessEnv = process.env): SentryConfigResult {
  const dsn = trimmed(env[SENTRY_ENV_VARS.dsn]);
  if (dsn === null) return { state: 'not_configured' };
  const problem = dsnProblem(dsn, env.NODE_ENV === 'production');
  if (problem !== null) return invalid(SENTRY_ENV_VARS.dsn, problem);
  const release = trimmed(env[SENTRY_ENV_VARS.release]);
  if (release !== null && !RELEASE_PATTERN.test(release)) {
    return invalid(SENTRY_ENV_VARS.release, 'it is not a usable release name');
  }
  return {
    state: 'configured',
    config: { dsn, environment: trimmed(env.NODE_ENV) ?? 'development', release },
  };
}
