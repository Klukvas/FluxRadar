// Which database, if any, the API test suites are allowed to migrate, seed and
// truncate.
//
// These suites do not read a row and put it back: they TRUNCATE every table they
// know about before each database-backed file. That is correct for a disposable
// database created for one test run, and destructive for anything else — so the
// address is never inherited from the surrounding shell or from a repository
// `.env`, and it is accepted only when every one of these holds:
//
//   1. it is a PostgreSQL URL;
//   2. its host is a LITERAL loopback address. A hostname is refused, including
//      `localhost`: what that resolves to is the machine's business, and a name
//      that resolves off-box is indistinguishable from one that does not;
//   3. its database name follows the convention for a disposable test database,
//      `fluxradar_test_<token>`, so a URL aimed at `fluxradar`, `postgres` or
//      any application database cannot be truncated by accident;
//   4. it carries no connection parameter beyond the small whitelist below —
//      libpq and Prisma both accept parameters that silently redirect the
//      connection (`host`, `hostaddr`, `dbname`, `service`, `options`), and a
//      URL that reads as loopback in its authority can point anywhere through
//      one of them;
//   5. the operator acknowledged the destruction explicitly, by repeating the
//      full database name in TEST_DATABASE_ACK_ENV.
//
// A URL that fails any of those is REFUSED, not ignored: a configured-but-wrong
// address is a mistake an operator has to see, and skipping the suites would
// hide it behind a green run. Absent configuration is the ordinary case: the
// database-backed files are skipped and say so.
//
// Nothing here is specific to one task. A new run picks its own token, creates
// its own database, and points the two variables at it.

/**
 * The naming convention for a database these suites may erase.
 *
 * The token is what makes it one run's own: two tasks, two tokens, two
 * databases, and neither can truncate the other's. It is deliberately not a
 * date or a branch name — those repeat.
 */
export const TEST_DATABASE_NAME_PATTERN = /^fluxradar_test_[a-z0-9]{4,40}$/;

/** A human-readable form of the pattern, for refusal messages. */
export const TEST_DATABASE_NAME_CONVENTION = 'fluxradar_test_<token>';

/** Where the test database address is read from. Nothing else is consulted. */
export const TEST_DATABASE_URL_ENV = 'FLUXRADAR_TEST_DATABASE_URL';

/** Must equal the URL's full database name before anything is written. */
export const TEST_DATABASE_ACK_ENV = 'FLUXRADAR_TEST_DATABASE_ACK';

/**
 * Variables an earlier harness read and this one deliberately does not. They are
 * named in the skip reason so a developer who exported one is told why their DB
 * suites did not run, instead of assuming the harness is broken.
 */
export const IGNORED_DATABASE_ENV_VARS = ['TEST_DATABASE_URL', 'DATABASE_URL'] as const;

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

/**
 * The only hosts accepted, as literal addresses. `localhost` is NOT among them:
 * it is a name, resolved by whatever the machine's resolver says, and a guard
 * whose safety depends on a resolver is not a guard.
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]']);

/**
 * Connection parameters a test URL may carry. One entry, because one is all a
 * Prisma connection needs; everything else is refused rather than passed
 * through, including the parameters that redirect a connection elsewhere.
 */
const ALLOWED_QUERY_PARAMETERS = new Set(['schema']);

/** A PostgreSQL identifier safe to use unquoted as a schema name. */
const SCHEMA_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export type TestDatabaseResolution =
  | { readonly state: 'ready'; readonly url: string; readonly databaseName: string }
  /** Nothing was configured. DB-backed suites skip and say so. */
  | { readonly state: 'absent'; readonly reason: string }
  /** Something was configured and is not safe to touch. Fail closed, loudly. */
  | { readonly state: 'refused'; readonly reason: string };

function trimmed(value: string | undefined): string | null {
  const result = value?.trim() ?? '';
  return result === '' ? null : result;
}

/**
 * The database name a PostgreSQL URL addresses, or null when it addresses none.
 * `new URL` keeps the leading slash and percent-encodes the rest, so the name is
 * decoded before it is compared — `fluxradar%5Ftest…` is the same database.
 */
function databaseNameOf(url: URL): string | null {
  const path = url.pathname.replace(/^\//, '');
  if (path === '' || path.includes('/')) return null;
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
}

/** Why this URL's query string is not acceptable, or null when it is. */
function queryRejection(url: URL): string | null {
  const keys = [...url.searchParams.keys()];
  const unknown = [...new Set(keys.filter((key) => !ALLOWED_QUERY_PARAMETERS.has(key)))];
  if (unknown.length > 0) {
    return (
      `${TEST_DATABASE_URL_ENV} carries connection parameters this harness will not accept ` +
      `(${unknown.join(', ')}); only ${[...ALLOWED_QUERY_PARAMETERS].join(', ')} is allowed, ` +
      'because a parameter can redirect the connection to a database other than the one the ' +
      'URL appears to name'
    );
  }
  const duplicated = [...new Set(keys.filter((key) => url.searchParams.getAll(key).length > 1))];
  if (duplicated.length > 0) {
    return (
      `${TEST_DATABASE_URL_ENV} repeats the connection parameter ${duplicated.join(', ')}; ` +
      'which occurrence wins is not something this harness will guess at'
    );
  }
  const schema = url.searchParams.get('schema');
  if (schema !== null && !SCHEMA_NAME_PATTERN.test(schema)) {
    return `${TEST_DATABASE_URL_ENV} has a ?schema= value that is not a plain identifier`;
  }
  return null;
}

/** Why this URL may not be truncated, or null when it may. */
function rejection(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `${TEST_DATABASE_URL_ENV} is not a URL`;
  }
  if (!POSTGRES_PROTOCOLS.has(url.protocol)) {
    return `${TEST_DATABASE_URL_ENV} must be a postgresql:// URL`;
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    return (
      `${TEST_DATABASE_URL_ENV} must point at a literal loopback address ` +
      `(${[...LOOPBACK_HOSTS].join(' or ')}); the suites truncate every table, and a host name ` +
      'is resolved by the machine rather than by this guard'
    );
  }
  const queryProblem = queryRejection(url);
  if (queryProblem !== null) return queryProblem;
  const databaseName = databaseNameOf(url);
  if (databaseName === null || !TEST_DATABASE_NAME_PATTERN.test(databaseName)) {
    return (
      `${TEST_DATABASE_URL_ENV} must name a disposable test database following ` +
      `${TEST_DATABASE_NAME_CONVENTION}; it names ${databaseName ?? 'no database'}`
    );
  }
  return null;
}

/**
 * Resolves the test database from the environment, without ever falling back to
 * an inherited variable. Pure: it reads `env` and touches nothing.
 */
export function resolveTestDatabase(env: NodeJS.ProcessEnv = process.env): TestDatabaseResolution {
  const raw = trimmed(env[TEST_DATABASE_URL_ENV]);
  if (raw === null) {
    const inherited = IGNORED_DATABASE_ENV_VARS.filter((name) => trimmed(env[name]) !== null);
    const ignoring =
      inherited.length === 0
        ? ''
        : ` (${inherited.join(' and ')} ${inherited.length === 1 ? 'is' : 'are'} set and ` +
          'deliberately ignored: an inherited address is not a database this suite may erase)';
    return {
      state: 'absent',
      reason: `${TEST_DATABASE_URL_ENV} is not set, so database-backed tests are skipped${ignoring}`,
    };
  }
  const refusal = rejection(raw);
  if (refusal !== null) {
    return { state: 'refused', reason: refusal };
  }
  // Safe: `rejection` returned null, so the URL parses and names a database.
  const databaseName = databaseNameOf(new URL(raw)) ?? '';
  const acknowledgement = trimmed(env[TEST_DATABASE_ACK_ENV]);
  if (acknowledgement !== databaseName) {
    return {
      state: 'refused',
      reason:
        `${TEST_DATABASE_ACK_ENV} must be set to ${databaseName} — the full database name the ` +
        'URL addresses — to confirm that it may be migrated, seeded and truncated',
    };
  }
  return { state: 'ready', url: raw, databaseName };
}

/**
 * The URL, or a thrown error naming why there is none. Every destructive step —
 * `prisma migrate deploy`, the TRUNCATE in createTestDb, any teardown that
 * deletes — goes through this and therefore cannot run against an address the
 * rules above did not accept.
 */
export function requireTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const resolution = resolveTestDatabase(env);
  if (resolution.state === 'ready') {
    return resolution.url;
  }
  throw new Error(`Refusing to use a database for API tests: ${resolution.reason}`);
}

/** True when DB-backed suites may run. Used by `describeDb` to skip, not to fail. */
export function isTestDatabaseReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveTestDatabase(env).state === 'ready';
}

/** One sentence naming why the DB-backed suites are not running. */
export function testDatabaseSkipReason(env: NodeJS.ProcessEnv = process.env): string {
  const resolution = resolveTestDatabase(env);
  return resolution.state === 'ready' ? '' : resolution.reason;
}

/**
 * Throws when a database WAS configured and refused.
 *
 * Every entry point that is about to write — the Vitest config that decides
 * which files run, the global setup that migrates — calls this first, so a URL
 * pointing at a real server fails the run at its start instead of being quietly
 * excluded from it.
 */
export function assertNoRefusedTestDatabase(env: NodeJS.ProcessEnv = process.env): void {
  const resolution = resolveTestDatabase(env);
  if (resolution.state === 'refused') {
    throw new Error(
      `Refusing to run API tests against the configured database: ${resolution.reason}`,
    );
  }
}
