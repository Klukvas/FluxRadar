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
 * Kept until every release that reads it at startup has been retired: an older
 * release crash-loops without it, which would turn an automatic rollback into an
 * outage. A warning, not an error, because only the rollback probe knows which
 * release would actually come back.
 */
const ROLLBACK_ONLY_KEYS = ['PADDLE_WEBHOOK_SECRET'];

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
  const errors = [
    ...parsed.errors,
    ...checkRequiredKeys(parsed.entries),
    ...checkDatabaseConsistency(parsed.entries),
  ];
  const warnings = [...parsed.warnings, ...checkRollbackKeys(parsed.entries)];
  if (errors.length > 0) {
    const error = new Error(
      `The production env file cannot be passed identically to docker compose and docker run:\n` +
        errors.map((message) => `  - ${message}`).join('\n'),
    );
    error.warnings = warnings;
    throw error;
  }
  writeFileSync(path, render(parsed.entries), { mode: 0o600 });
  return { keys: [...parsed.entries.keys()], warnings };
}

module.exports = { normalizeEnvFile, parseEnvFile, COMPOSE_CONSUMED_KEYS, REQUIRED_KEYS };

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
