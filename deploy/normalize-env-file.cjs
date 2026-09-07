// Normalizes the assembled production env file so `docker compose --env-file`
// and `docker run --env-file` read EXACTLY the same values.
//
// The deploy uses both: compose starts PostgreSQL and Caddy, while the API and
// web containers are started with `docker run`. Their env-file parsers do not
// agree, and every disagreement is silent:
//
//   KEY="value"      compose strips the quotes; docker run keeps them.
//   KEY=a$b          compose interpolates $b; docker run passes it literally.
//   KEY=a # note     compose drops the comment; docker run keeps it.
//   KEY=value␠       compose trims the trailing space; docker run keeps it.
//   export KEY=v     compose accepts it; docker run makes a variable named
//                    "export KEY".
//
// POSTGRES_PASSWORD is read by compose and DATABASE_URL by `docker run`, so a
// single quoted password used to initialise the database with one value and
// point the API at another — a deploy that "succeeds" and then cannot connect.
//
// This script rewrites the file into the one form both parsers agree on
// (unquoted, no interpolation, no inline comment) and refuses to write anything
// it cannot represent identically in both. It also cross-checks DATABASE_URL
// against POSTGRES_USER/PASSWORD/DB so the two can no longer drift apart.
//
// Every message names variables and problems. No value is ever printed.

'use strict';

const { readFileSync, writeFileSync } = require('node:fs');

/** Variables docker compose itself consumes (see docker-compose.yml). */
const COMPOSE_CONSUMED_KEYS = [
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'DATABASE_URL',
  'FLUXRADAR_ENV_FILE',
  'FLUXRADAR_API_IMAGE',
  'FLUXRADAR_WEB_IMAGE',
  'FLUXRADAR_API_PORT',
  'FLUXRADAR_WEB_PORT',
  'FLUXRADAR_CADDYFILE',
  'FLUXRADAR_API_UPSTREAM',
  'FLUXRADAR_WEB_UPSTREAM',
];

/** Present or the deploy is not viable; see docs/DEPLOYMENT.md. */
const REQUIRED_KEYS = [
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'DATABASE_URL',
  'FLUXRADAR_ENV_FILE',
  'INTEGRATION_ENCRYPTION_KEY',
];

/**
 * Secrets that must not hold the same value.
 *
 * INTEGRATION_ENCRYPTION_KEY encrypts every stored Google/Bing token;
 * SESSION_SECRET is what a development checkout falls back to when the key is
 * absent, which makes copying it into the key the most natural way to fill in
 * the env file — and the one that quietly ties every stored token's lifetime to
 * a secret rotated for unrelated reasons. The API refuses to boot on it
 * (apps/api/src/integrations/encryption-key.ts); catching it here turns that
 * crash-loop into a failed deploy that never reaches the server.
 *
 * Compared by value, reported by name: no value is ever printed.
 */
const DISTINCT_SECRET_PAIRS = [['INTEGRATION_ENCRYPTION_KEY', 'SESSION_SECRET']];

/**
 * How short a key may be before the deploy says so. The key is stretched with a
 * single unsalted SHA-256, so its own entropy is all the protection a leaked
 * database has. 32 characters is what
 * `randomBytes(24).toString('base64')` produces; the documented generator emits
 * 44. A warning rather than an error: an existing deployment running a shorter
 * key must be able to redeploy and rotate, not be locked out by the check that
 * told it to.
 */
const MIN_ENCRYPTION_KEY_LENGTH = 32;

/**
 * Kept until every release that reads it at startup has been retired: an older
 * release crash-loops without it, which would turn an automatic rollback into an
 * outage. A warning, not an error, because only the rollback probe knows which
 * release would actually come back.
 */
const ROLLBACK_ONLY_KEYS = ['PADDLE_WEBHOOK_SECRET'];

/**
 * Everything deploy/backup/* needs before a snapshot can be taken.
 *
 * Absent, backups simply do not run — and nothing else in the deploy says so,
 * which is how a deployment ends up believing it has backups it has never taken.
 * The deploy is the only moment a human is watching this file, so it is where
 * the state of the backup configuration is reported.
 */
const BACKUP_KEYS = [
  'HETZNER_S3_ENDPOINT',
  'HETZNER_S3_REGION',
  'HETZNER_S3_BUCKET',
  'HETZNER_S3_ACCESS_KEY',
  'HETZNER_S3_SECRET_KEY',
  'FLUXRADAR_BACKUP_ENCRYPTION_KEY',
];

/**
 * Backup policy numbers, with the constraint each one is read under.
 * `positive: true` is the freshness alarm, which no snapshot can satisfy at 0;
 * see the same rule in deploy/backup/backup-cli.cjs, which this check exists to
 * report a day earlier — at deploy time, rather than in a nightly verification.
 */
const BACKUP_POLICY_NUMBERS = [
  { key: 'FLUXRADAR_BACKUP_RETENTION_DAYS', positive: false },
  { key: 'FLUXRADAR_BACKUP_MIN_KEEP', positive: true },
  { key: 'FLUXRADAR_BACKUP_MAX_DELETE', positive: false },
  { key: 'FLUXRADAR_BACKUP_STALE_HOURS', positive: false },
  { key: 'FLUXRADAR_BACKUP_MAX_AGE_HOURS', positive: true },
];

/** The API container is started with this env file, so compose must agree. */
const EXPECTED_ENV_FILE_NAME = '.env.production';

/** The compose service name PostgreSQL is reachable under. */
const POSTGRES_SERVICE_HOST = 'postgres';

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The literal value of one assignment, or the reason it cannot be passed
 * identically to both parsers. `line` is the raw text after `KEY=`.
 */
function readValue(key, rawValue) {
  const value = rawValue;
  const isDoubleQuoted = value.length >= 2 && value.startsWith('"') && value.endsWith('"');
  const isSingleQuoted = value.length >= 2 && value.startsWith("'") && value.endsWith("'");
  if (isDoubleQuoted && value.includes('\\')) {
    return {
      error:
        `${key}: a double-quoted value containing a backslash is unescaped by docker compose ` +
        'and kept verbatim by docker run. Remove the backslash or use a value that needs no escape.',
    };
  }
  const literal = isDoubleQuoted || isSingleQuoted ? value.slice(1, -1) : value;
  if (!isDoubleQuoted && !isSingleQuoted && /\s#/.test(value)) {
    return {
      error:
        `${key}: an inline "#" comment is dropped by docker compose and kept by docker run. ` +
        'Remove the comment from the value line.',
    };
  }
  if (literal !== literal.trim()) {
    return {
      error:
        `${key}: leading or trailing whitespace is trimmed by docker compose and kept by ` +
        'docker run, so the two would receive different values. Rotate the value without it.',
    };
  }
  if (literal.startsWith('#')) {
    return { error: `${key}: a value starting with "#" cannot be expressed in both parsers.` };
  }
  if (/\s#/.test(literal)) {
    return {
      error: `${key}: a value containing " #" cannot be expressed unquoted; rotate the value.`,
    };
  }
  if (literal.startsWith('"') || literal.startsWith("'")) {
    return { error: `${key}: a value starting with a quote cannot be expressed in both parsers.` };
  }
  return { value: literal };
}

/**
 * Parses the file into ordered entries. Returns errors and warnings by NAME.
 * Later assignments of the same key replace earlier ones, which is what both
 * parsers do; the duplicate is reported so the env file can be cleaned up.
 */
function parseEnvFile(content) {
  const entries = new Map();
  const errors = [];
  const warnings = [];
  const lines = content.split('\n');

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.replace(/\r$/, '');
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      return;
    }
    if (/^\s*export\s/.test(line)) {
      errors.push(
        `line ${lineNumber}: "export " prefix is accepted by docker compose and makes docker run ` +
          'create a variable whose name contains a space. Remove the prefix.',
      );
      return;
    }
    const separator = line.indexOf('=');
    if (separator === -1) {
      errors.push(`line ${lineNumber}: not a KEY=value assignment.`);
      return;
    }
    const key = line.slice(0, separator);
    if (!KEY_PATTERN.test(key)) {
      errors.push(
        `line ${lineNumber}: "${KEY_PATTERN.test(key.trim()) ? key.trim() : 'key'}" is not a ` +
          'usable variable name (letters, digits and underscore, not starting with a digit, ' +
          'and no space around "=").',
      );
      return;
    }
    const result = readValue(key, line.slice(separator + 1));
    if (result.error !== undefined) {
      errors.push(result.error);
      return;
    }
    if (result.value.includes('$')) {
      const message = `${key}: "$" is interpolated by docker compose and passed literally by docker run`;
      if (COMPOSE_CONSUMED_KEYS.includes(key)) {
        errors.push(`${message}. This variable is read by docker compose; rotate the value.`);
        return;
      }
      warnings.push(`${message}; docker compose is not the reader of this variable.`);
    }
    if (entries.has(key)) {
      warnings.push(`${key}: assigned more than once; the last assignment is kept.`);
    }
    entries.set(key, result.value);
  });

  return { entries, errors, warnings };
}

/** Percent-decoding as a URL parser applies it, without throwing on stray "%". */
function decodeComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * DATABASE_URL and the POSTGRES_* variables describe the same database from two
 * sides: compose initialises the server from POSTGRES_*, the API connects with
 * DATABASE_URL. A mismatch is reported by field name only.
 */
function checkDatabaseConsistency(entries) {
  const errors = [];
  const databaseUrl = entries.get('DATABASE_URL');
  if (databaseUrl === undefined) {
    return errors;
  }
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    errors.push('DATABASE_URL is not a parsable URL.');
    return errors;
  }
  if (url.hostname !== POSTGRES_SERVICE_HOST) {
    errors.push(
      `DATABASE_URL host must be the compose service "${POSTGRES_SERVICE_HOST}" so the API ` +
        'reaches the database this deploy starts.',
    );
  }
  const expectations = [
    ['POSTGRES_USER', decodeComponent(url.username), 'user'],
    ['POSTGRES_PASSWORD', decodeComponent(url.password), 'password'],
    ['POSTGRES_DB', decodeComponent(url.pathname.replace(/^\//, '')), 'database name'],
  ];
  for (const [key, actual, label] of expectations) {
    const expected = entries.get(key);
    if (expected !== undefined && expected !== actual) {
      errors.push(
        `DATABASE_URL ${label} does not match ${key}. PostgreSQL would be initialised with one ` +
          'value and the API would connect with another.',
      );
    }
  }
  return errors;
}

function checkRequiredKeys(entries) {
  const missing = REQUIRED_KEYS.filter((key) => !entries.has(key));
  const errors =
    missing.length === 0
      ? []
      : [
          `The assembled production env file is missing required variables: ${missing.join(', ')}. ` +
            'Set them in PRODUCTION_ENV_FILE or in the matching optional deploy secret.',
        ];
  const envFileName = entries.get('FLUXRADAR_ENV_FILE');
  if (envFileName !== undefined && envFileName !== EXPECTED_ENV_FILE_NAME) {
    errors.push(
      `FLUXRADAR_ENV_FILE must be "${EXPECTED_ENV_FILE_NAME}" for the production deploy.`,
    );
  }
  return errors;
}

/** Secrets the deploy refuses to ship as copies of one another. */
function checkDistinctSecrets(entries) {
  return DISTINCT_SECRET_PAIRS.flatMap(([first, second]) => {
    const firstValue = entries.get(first);
    const secondValue = entries.get(second);
    if (firstValue === undefined || secondValue === undefined || firstValue !== secondValue) {
      return [];
    }
    return [
      `${first} holds the same value as ${second}. They protect different things and must ` +
        'rotate independently; the API refuses to boot on this, so the deploy stops here.',
    ];
  });
}

/** Reports a key short enough to be worth attacking offline, by name only. */
function checkEncryptionKeyStrength(entries) {
  const key = entries.get('INTEGRATION_ENCRYPTION_KEY');
  if (key === undefined || key.length >= MIN_ENCRYPTION_KEY_LENGTH) {
    return [];
  }
  return [
    `INTEGRATION_ENCRYPTION_KEY is shorter than ${MIN_ENCRYPTION_KEY_LENGTH} characters. It is ` +
      'stretched with a single SHA-256, so a short key is the whole protection a leaked ' +
      "database has. Rotate it to `node -e \"console.log(require('node:crypto')" +
      ".randomBytes(32).toString('base64'))\"` (docs/DEPLOYMENT.md).",
  ];
}

/**
 * Says out loud whether this deploy ships a working backup configuration.
 *
 * Presence is a WARNING in both directions: a host that has not been through
 * docs/DEPLOYMENT.md's one-time backup setup deploys fine and must keep
 * deploying fine, and the S3 credentials are also the application's own, so a
 * bucket without a backup key is a real intermediate state rather than a typo.
 *
 * A policy number that is present and unusable is an ERROR: nothing else reads
 * it until a backup or a restore does, and both of those run unattended.
 */
function checkBackupConfiguration(entries) {
  const errors = [];
  const warnings = [];
  const configured = BACKUP_KEYS.filter((key) => (entries.get(key) ?? '').trim() !== '');
  const missing = BACKUP_KEYS.filter((key) => !configured.includes(key));
  if (configured.length === 0) {
    warnings.push(
      'No database backup is configured: none of ' +
        `${BACKUP_KEYS.join(', ')} is set, so deploy/backup/pg-backup.sh cannot run and this ` +
        'deployment has no snapshot to restore from (docs/DEPLOYMENT.md, "Manual setup").',
    );
  } else if (missing.length > 0) {
    warnings.push(
      `Database backups are half-configured: ${missing.join(', ')} ` +
        `${missing.length === 1 ? 'is' : 'are'} absent. Until every one of ` +
        `${BACKUP_KEYS.join(', ')} is set, no snapshot is taken (docs/DEPLOYMENT.md).`,
    );
  }
  for (const { key, positive } of BACKUP_POLICY_NUMBERS) {
    const raw = entries.get(key);
    if (raw === undefined || raw.trim() === '') continue;
    const value = Number(raw.trim());
    if (!Number.isFinite(value) || value < 0) {
      errors.push(`${key} must be a non-negative number; the backup tools refuse to run on it.`);
      continue;
    }
    if (positive && value === 0) {
      errors.push(
        `${key} is 0. The backup tools reject it — a freshness limit of 0 accepts no snapshot ` +
          'and a minimum of 0 kept snapshots is not a retention policy.',
      );
    }
  }
  return { errors, warnings };
}

function checkRollbackKeys(entries) {
  return ROLLBACK_ONLY_KEYS.filter((key) => !entries.has(key)).map(
    (key) =>
      `${key} is absent. It is unused by this release but required at startup by older ones, ` +
      'so a rollback to such a release would crash-loop (docs/DEPLOYMENT.md).',
  );
}

/** The normalized file content: one `KEY=value` per line, insertion order. */
function render(entries) {
  return `${[...entries].map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
}

/**
 * Validates and rewrites the file at `path`. Returns the variable NAMES it
 * wrote plus any warnings; throws with a name-only message when the file cannot
 * be represented identically to both parsers.
 */
function normalizeEnvFile(path) {
  const parsed = parseEnvFile(readFileSync(path, 'utf8'));
  const backups = checkBackupConfiguration(parsed.entries);
  const errors = [
    ...parsed.errors,
    ...checkRequiredKeys(parsed.entries),
    ...checkDatabaseConsistency(parsed.entries),
    ...checkDistinctSecrets(parsed.entries),
    ...backups.errors,
  ];
  const warnings = [
    ...parsed.warnings,
    ...checkRollbackKeys(parsed.entries),
    ...checkEncryptionKeyStrength(parsed.entries),
    ...backups.warnings,
  ];
  if (errors.length > 0) {
    const error = new Error(
      'The production env file cannot be passed identically to docker compose and docker run, ' +
        'or carries a value the deploy refuses to ship:\n' +
        errors.map((message) => `  - ${message}`).join('\n'),
    );
    error.warnings = warnings;
    throw error;
  }
  writeFileSync(path, render(parsed.entries), { mode: 0o600 });
  return { keys: [...parsed.entries.keys()], warnings };
}

module.exports = {
  normalizeEnvFile,
  parseEnvFile,
  BACKUP_KEYS,
  BACKUP_POLICY_NUMBERS,
  COMPOSE_CONSUMED_KEYS,
  REQUIRED_KEYS,
  DISTINCT_SECRET_PAIRS,
  MIN_ENCRYPTION_KEY_LENGTH,
};

if (require.main === module) {
  const path = process.argv[2];
  if (path === undefined) {
    console.error('usage: node deploy/normalize-env-file.cjs <env-file>');
    process.exit(2);
  }
  try {
    const { keys, warnings } = normalizeEnvFile(path);
    for (const warning of warnings) {
      console.error(`WARNING: ${warning}`);
    }
    console.log(`Normalized ${keys.length} production variables: ${keys.join(', ')}`);
  } catch (error) {
    for (const warning of error.warnings ?? []) {
      console.error(`WARNING: ${warning}`);
    }
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}
