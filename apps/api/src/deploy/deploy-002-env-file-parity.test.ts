import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';

// DEPLOY-002: one production env file, two parsers.
//
// The deploy starts PostgreSQL and Caddy with `docker compose --env-file` and
// the API and web containers with `docker run --env-file`. The two parsers do
// not agree — compose strips quotes, interpolates "$", drops inline comments and
// trims trailing whitespace; `docker run` does none of that. POSTGRES_PASSWORD
// is read by the first and DATABASE_URL by the second, so a quoted password
// initialises the database with one value and points the API at another.
//
// deploy/normalize-env-file.cjs is the single writer of that file: it rewrites
// it into the form both parsers read identically and refuses anything it cannot.
// This suite runs the shipped script, and asserts the workflow still calls it.

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'deploy.yml');
const SCRIPT_PATH = join(REPO_ROOT, 'deploy', 'normalize-env-file.cjs');

const require_ = createRequire(import.meta.url);
const { normalizeEnvFile } = require_(SCRIPT_PATH) as {
  normalizeEnvFile: (path: string) => { readonly keys: string[]; readonly warnings: string[] };
};

const PASSWORD = 'p4ssw0rd-value';
const BASE_ENV: Readonly<Record<string, string>> = {
  POSTGRES_DB: 'fluxradar',
  POSTGRES_USER: 'fluxradar',
  POSTGRES_PASSWORD: PASSWORD,
  DATABASE_URL: `postgresql://fluxradar:${PASSWORD}@postgres:5432/fluxradar`,
  FLUXRADAR_ENV_FILE: '.env.production',
  INTEGRATION_ENCRYPTION_KEY: 'integration-key',
  PADDLE_WEBHOOK_SECRET: 'legacy-secret',
};

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

function writeEnvFile(lines: readonly string[]): string {
  const workspace = mkdtempSync(join(tmpdir(), 'fluxradar-env-'));
  workspaces.push(workspace);
  const path = join(workspace, 'production.env');
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
}

function baseLines(overrides: Readonly<Record<string, string>> = {}): readonly string[] {
  return Object.entries({ ...BASE_ENV, ...overrides }).map(([key, value]) => `${key}=${value}`);
}

/** How `docker run --env-file` reads a line: everything after "=" is the value. */
function readAsDockerRun(path: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const separator = line.indexOf('=');
    values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return values;
}

/**
 * How `docker compose --env-file` reads the same line: quotes are stripped,
 * "$" is interpolated, an inline " #" comment is dropped and the remainder is
 * trimmed.
 */
function readAsDockerCompose(path: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const separator = line.indexOf('=');
    const key = line.slice(0, separator).replace(/^export\s+/, '');
    let value = line.slice(separator + 1);
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\n/g, '\n');
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    value = value.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_match, name: string) =>
      values.get(name) === undefined ? '' : (values.get(name) as string),
    );
    values.set(key, value);
  }
  return values;
}

function expectFailure(lines: readonly string[]): string {
  const path = writeEnvFile(lines);
  const before = readFileSync(path, 'utf8');
  let message = '';
  expect(() => {
    try {
      normalizeEnvFile(path);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }).toThrow();
  // A refused file is left untouched; nothing half-written reaches the server.
  expect(readFileSync(path, 'utf8')).toBe(before);
  return message;
}

describe('DEPLOY-002 production env file parity', () => {
  it('makes both parsers read identical values', () => {
    const path = writeEnvFile([
      '# base file, as an operator may well write it',
      'POSTGRES_DB=fluxradar',
      "POSTGRES_USER='fluxradar'",
      `POSTGRES_PASSWORD="${PASSWORD}"`,
      `DATABASE_URL="postgresql://fluxradar:${PASSWORD}@postgres:5432/fluxradar"`,
      'FLUXRADAR_ENV_FILE=.env.production',
      'INTEGRATION_ENCRYPTION_KEY=integration-key',
      'PADDLE_WEBHOOK_SECRET=legacy-secret',
    ]);

    normalizeEnvFile(path);

    const composeValues = readAsDockerCompose(path);
    const runValues = readAsDockerRun(path);
    expect([...runValues.entries()]).toEqual([...composeValues.entries()]);
    expect(runValues.get('POSTGRES_PASSWORD')).toBe(PASSWORD);
    expect(runValues.get('DATABASE_URL')).toContain(`:${PASSWORD}@postgres:5432/`);
  });

  // The exact divergence the audit found: compose initialises PostgreSQL from
  // the unquoted password while `docker run` hands the API one with quotes.
  it('removes the quoting that split POSTGRES_PASSWORD from DATABASE_URL', () => {
    const quoted = writeEnvFile(baseLines({ POSTGRES_PASSWORD: `"${PASSWORD}"` }));
    expect(readAsDockerRun(quoted).get('POSTGRES_PASSWORD')).not.toBe(
      readAsDockerCompose(quoted).get('POSTGRES_PASSWORD'),
    );

    normalizeEnvFile(quoted);

    expect(readAsDockerRun(quoted).get('POSTGRES_PASSWORD')).toBe(
      readAsDockerCompose(quoted).get('POSTGRES_PASSWORD'),
    );
  });

  it('refuses a DATABASE_URL that disagrees with POSTGRES_*', () => {
    const message = expectFailure(
      baseLines({
        DATABASE_URL: 'postgresql://fluxradar:mismatched-secret@postgres:5432/fluxradar',
      }),
    );

    expect(message).toContain('DATABASE_URL password does not match POSTGRES_PASSWORD');
    expect(message).not.toContain(PASSWORD);
    expect(message).not.toContain('mismatched-secret');
  });

  it('refuses a DATABASE_URL pointing away from the compose database', () => {
    const message = expectFailure(
      baseLines({
        DATABASE_URL: `postgresql://fluxradar:${PASSWORD}@db.example.com:5432/fluxradar`,
      }),
    );

    expect(message).toContain('DATABASE_URL host');
  });

  it.each([
    ['an interpolated "$" in a compose-consumed value', { POSTGRES_PASSWORD: 'a$bc' }],
    ['an inline comment', { INTEGRATION_ENCRYPTION_KEY: 'key # rotated 2026-01-01' }],
    ['a trailing space', { INTEGRATION_ENCRYPTION_KEY: 'key ' }],
    ['a backslash escape in a quoted value', { INTEGRATION_ENCRYPTION_KEY: '"a\\nb"' }],
  ])('refuses %s', (_case, overrides) => {
    expect(expectFailure(baseLines(overrides))).not.toBe('');
  });

  it('refuses an "export " prefix docker run would turn into a broken name', () => {
    expect(expectFailure([...baseLines(), 'export EXTRA=value'])).toContain('export');
  });

  it('refuses a file missing a variable the deploy requires', () => {
    const lines = baseLines().filter((line) => !line.startsWith('INTEGRATION_ENCRYPTION_KEY='));

    expect(expectFailure(lines)).toContain('INTEGRATION_ENCRYPTION_KEY');
  });

  // PADDLE_WEBHOOK_SECRET is unused by this release but still required at
  // startup by older ones, so its absence is a warning, not a refusal: only the
  // rollback probe knows which release would actually come back.
  it('warns, but does not fail, when PADDLE_WEBHOOK_SECRET is absent', () => {
    const path = writeEnvFile(baseLines().filter((line) => !line.startsWith('PADDLE_')));

    const { warnings } = normalizeEnvFile(path);

    expect(warnings.join('\n')).toContain('PADDLE_WEBHOOK_SECRET');
  });

  it('reports variable names only, never values', () => {
    const path = writeEnvFile(baseLines());

    const { keys, warnings } = normalizeEnvFile(path);

    expect(keys).toContain('POSTGRES_PASSWORD');
    expect(JSON.stringify([keys, warnings])).not.toContain(PASSWORD);
  });

  it('keeps the deploy workflow calling the normalizer before the env file ships', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

    expect(workflow).toContain('node deploy/normalize-env-file.cjs "$RUNNER_TEMP/production.env"');
    const normalizeAt = workflow.indexOf('node deploy/normalize-env-file.cjs');
    const uploadAt = workflow.indexOf('scp "$RUNNER_TEMP/production.env"');
    expect(normalizeAt).toBeGreaterThan(-1);
    expect(uploadAt).toBeGreaterThan(normalizeAt);
  });

  // The workflow must not pin a value of its own: PRODUCTION_ENV_FILE is the
  // base and the optional secrets are the only overrides (docs/DEPLOYMENT.md).
  it('keeps the workflow free of a hardcoded ANTHROPIC_MODEL', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

    expect(workflow).not.toMatch(/^\s*ANTHROPIC_MODEL:\s*claude/m);
    expect(workflow).toContain('upsert_env ANTHROPIC_MODEL PRODUCTION_ANTHROPIC_MODEL');
  });
});
