// Which browser DSNs this site accepts — the same rules as the API's
// apps/api/src/observability/sentry-config.ts.
//
// Read twice: by vite.config.ts, which refuses to build a site with a DSN that
// is set but unusable, and by error-monitoring.ts at runtime, which turns
// monitoring off with a warning when a dev server is given one. A DSN the SDK
// cannot parse is not refused by the SDK: it prints the whole DSN in every
// visitor's console and then reports nothing. One of another region is blocked
// by the production CSP without a word, and the privacy policy promises the EU.

export const EU_INGEST_HOST_SUFFIX = '.ingest.de.sentry.io';

/** Plain http to these hosts is allowed outside production builds: a local fake ingest. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** The grammar @sentry/core's dsn.js parses, narrowed to what this site accepts. */
const SDK_DSN_GRAMMAR =
  /^https?:\/\/\w+(?::\w*)?@(?:\[[:.%\w]+\]|[\w.-]+)(?::\d+)?\/(?:[^?#\s]*\/)?\d+$/;

/** Why `dsn` cannot be used by a build in `mode`, or null when it can. Never quotes the value. */
export function sentryDsnProblem(dsn: string, mode: string): string | null {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return 'it is not a URL';
  }
  const isLocalIngest =
    mode !== 'production' && url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
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
  if (!SDK_DSN_GRAMMAR.test(dsn)) {
    return 'it is not in the form https://<key>@<host>/<project id> the Sentry SDK reads';
  }
  return null;
}
