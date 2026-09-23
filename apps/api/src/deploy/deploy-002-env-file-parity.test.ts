import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { OPENAI_ENV_VARS } from '../integrations/openai-config.ts';
import { GEMINI_ENV_VARS, PERPLEXITY_ENV_VARS } from '../integrations/opt-in-ai-config.ts';
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
const { normalizeEnvFile, BACKUP_KEYS, BACKUP_POLICY_NUMBERS } = require_(SCRIPT_PATH) as {
  normalizeEnvFile: (path: string) => { readonly keys: string[]; readonly warnings: string[] };
  BACKUP_KEYS: readonly string[];
  BACKUP_POLICY_NUMBERS: readonly { key: string; positive: boolean }[];
};

/** Every backup variable set to something usable, for the "configured" cases. */
const BACKUP_ENV: Readonly<Record<string, string>> = {
  HETZNER_S3_ENDPOINT: 'https://nbg1.your-objectstorage.com',
  HETZNER_S3_REGION: 'nbg1',
  HETZNER_S3_BUCKET: 'fluxradar-backups',
  HETZNER_S3_ACCESS_KEY: 'access-key-id',
  HETZNER_S3_SECRET_KEY: 'secret-access-key',
  FLUXRADAR_BACKUP_ENCRYPTION_KEY: 'BASE64LOOKINGBACKUPKEYOF32RANDOMBYTESHERE==',
};

const PASSWORD = 'p4ssw0rd-value';
/** 44 characters, as `randomBytes(32).toString('base64')` produces. */
const ENCRYPTION_KEY = 'BASE64LOOKINGKEYOF32RANDOMBYTESFORTHISTEST==';
const BASE_ENV: Readonly<Record<string, string>> = {
  POSTGRES_DB: 'fluxradar',
  POSTGRES_USER: 'fluxradar',
  POSTGRES_PASSWORD: PASSWORD,
  DATABASE_URL: `postgresql://fluxradar:${PASSWORD}@postgres:5432/fluxradar`,
  FLUXRADAR_ENV_FILE: '.env.production',
  INTEGRATION_ENCRYPTION_KEY: ENCRYPTION_KEY,
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
    ['an inline comment', { INTEGRATION_ENCRYPTION_KEY: `${ENCRYPTION_KEY} # rotated` }],
    ['a trailing space', { INTEGRATION_ENCRYPTION_KEY: `${ENCRYPTION_KEY} ` }],
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

  // INTEGRATION_ENCRYPTION_KEY encrypts every stored Google/Bing token, and
  // SESSION_SECRET is what a development checkout falls back to when the key is
  // absent — which makes copying it across the most natural way to fill in the
  // env file, and the one that ties every stored token to a secret rotated for
  // unrelated reasons. The API refuses to boot on it, so shipping the file at
  // all would only turn a bad env file into a crash loop on the server.
  it('refuses an integration key that is a copy of SESSION_SECRET', () => {
    const message = expectFailure(
      baseLines({ INTEGRATION_ENCRYPTION_KEY: PASSWORD, SESSION_SECRET: PASSWORD }),
    );

    expect(message).toContain('INTEGRATION_ENCRYPTION_KEY');
    expect(message).toContain('SESSION_SECRET');
    expect(message).not.toContain(PASSWORD);
  });

  it('accepts the two secrets side by side when they differ', () => {
    const path = writeEnvFile(baseLines({ SESSION_SECRET: 'a-different-session-secret' }));

    expect(() => normalizeEnvFile(path)).not.toThrow();
  });

  // A warning, not a refusal: a deployment already running a short key has to be
  // able to redeploy in order to rotate it.
  it('warns about an integration key short enough to attack offline', () => {
    const path = writeEnvFile(baseLines({ INTEGRATION_ENCRYPTION_KEY: 'short-key' }));

    const { warnings } = normalizeEnvFile(path);

    expect(warnings.join('\n')).toContain('INTEGRATION_ENCRYPTION_KEY');
    expect(warnings.join('\n')).not.toContain('short-key');
  });

  it('stays quiet about a properly generated key', () => {
    const path = writeEnvFile(baseLines());

    const { warnings } = normalizeEnvFile(path);

    expect(warnings.join('\n')).not.toContain('INTEGRATION_ENCRYPTION_KEY');
  });

  // The workflow must not pin a value of its own: PRODUCTION_ENV_FILE is the
  // base and the optional secrets are the only overrides (docs/DEPLOYMENT.md).
  // Backups are the one part of this deployment that is configured entirely
  // outside the code, taken by a cron job nobody watches, and only ever needed
  // on the worst day. The deploy is the single moment a human reads this file,
  // so it is where the state of the backup configuration gets said out loud.
  describe('the backup configuration', () => {
    it('warns when this deployment ships with no backup at all', () => {
      const { warnings } = normalizeEnvFile(writeEnvFile(baseLines()));
      expect(warnings.join('\n')).toContain('No database backup is configured');
      for (const key of BACKUP_KEYS) expect(warnings.join('\n')).toContain(key);
    });

    it('warns when only some of the backup variables are set', () => {
      const { warnings } = normalizeEnvFile(
        writeEnvFile(
          baseLines({
            HETZNER_S3_ENDPOINT: BACKUP_ENV.HETZNER_S3_ENDPOINT as string,
            HETZNER_S3_BUCKET: BACKUP_ENV.HETZNER_S3_BUCKET as string,
          }),
        ),
      );
      const message = warnings.join('\n');
      expect(message).toContain('half-configured');
      expect(message).toContain('FLUXRADAR_BACKUP_ENCRYPTION_KEY');
      // A deploy is never blocked by this: docs/DEPLOYMENT.md's own backup
      // setup requires deploying once BEFORE the key exists on the server.
      expect(message).not.toContain('ERROR');
    });

    it('says nothing once every backup variable is set', () => {
      const { warnings } = normalizeEnvFile(writeEnvFile(baseLines(BACKUP_ENV)));
      expect(warnings.join('\n')).not.toContain('backup');
    });

    // The value below is read by nothing until a backup or a restore runs, and
    // both of those run unattended. A deploy is the last chance to reject it.
    it('refuses a policy number that is not a number', () => {
      const message = expectFailure(
        baseLines({ ...BACKUP_ENV, FLUXRADAR_BACKUP_RETENTION_DAYS: 'thirty' }),
      );
      expect(message).toContain('FLUXRADAR_BACKUP_RETENTION_DAYS');
      expect(message).toContain('non-negative number');
    });

    it('refuses the two policy numbers that must not be zero', () => {
      for (const { key } of BACKUP_POLICY_NUMBERS.filter((entry) => entry.positive)) {
        const message = expectFailure(baseLines({ ...BACKUP_ENV, [key]: '0' }));
        expect(message).toContain(key);
        expect(message).toContain('is 0');
      }
    });

    it('accepts the numbers a real deployment sets', () => {
      const { keys } = normalizeEnvFile(
        writeEnvFile(
          baseLines({
            ...BACKUP_ENV,
            FLUXRADAR_BACKUP_RETENTION_DAYS: '30',
            FLUXRADAR_BACKUP_MIN_KEEP: '7',
            FLUXRADAR_BACKUP_MAX_DELETE: '50',
            FLUXRADAR_BACKUP_STALE_HOURS: '48',
            FLUXRADAR_BACKUP_MAX_AGE_HOURS: '26',
          }),
        ),
      );
      expect(keys).toContain('FLUXRADAR_BACKUP_MAX_AGE_HOURS');
    });

    // A backup variable that the tools read but the workflow never writes into
    // the release env file is a setting that silently does not exist in
    // production. The list is taken from the shipped normalizer, so adding a
    // backup variable to the code fails here until the deploy ships it too.
    it('ships every backup variable the backup tools read', () => {
      const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
      const wired = new Map(
        [...workflow.matchAll(/^\s*upsert_env (\S+) (\S+)\s*$/gm)].map((match) => [
          match[1] as string,
          match[2] as string,
        ]),
      );
      const shipped = [
        ...BACKUP_KEYS,
        'FLUXRADAR_BACKUP_PREFIX',
        ...BACKUP_POLICY_NUMBERS.map((entry) => entry.key),
      ];
      for (const key of shipped) {
        const source = wired.get(key);
        expect(source, `${key} is never written into the release env file`).toBeDefined();
        // ...and the secret/variable it copies from is declared on the step.
        expect(workflow).toContain(`${source as string}: `);
      }
    });
  });

  it('keeps the workflow free of a hardcoded ANTHROPIC_MODEL', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

    expect(workflow).not.toMatch(/^\s*ANTHROPIC_MODEL:\s*claude/m);
    expect(workflow).toContain('upsert_env ANTHROPIC_MODEL PRODUCTION_ANTHROPIC_MODEL');
  });

  // An AI variable the API reads but the deploy never writes is a provider that
  // is unconfigured in production and says so nowhere: the code fails closed,
  // so every OpenAI request becomes an unavailable provider and every paid
  // scan's GEO module reports Partial — correct, and completely silent. The
  // names come from the config readers themselves, so adding a variable to the
  // code fails here until the workflow ships it.
  it('ships every AI provider variable the API reads', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
    const wired = new Map(
      [...workflow.matchAll(/^\s*upsert_env (\S+) (\S+)\s*$/gm)].map((match) => [
        match[1] as string,
        match[2] as string,
      ]),
    );

    for (const key of [
      ...Object.values(OPENAI_ENV_VARS),
      ...Object.values(GEMINI_ENV_VARS),
      ...Object.values(PERPLEXITY_ENV_VARS),
    ]) {
      const source = wired.get(key);
      expect(source, `${key} is never written into the release env file`).toBeDefined();
      // ...and the secret/variable it copies from is declared on the step.
      expect(workflow).toContain(`${source as string}: `);
    }
  });

  it('never pins an AI model or endpoint in the workflow itself', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

    // Same rule as ANTHROPIC_MODEL: PRODUCTION_ENV_FILE is the authoritative
    // base and everything here is an optional override, so a literal in the
    // workflow would outrank it and contradict docs/DEPLOYMENT.md.
    for (const key of [
      OPENAI_ENV_VARS.model,
      GEMINI_ENV_VARS.model,
      GEMINI_ENV_VARS.apiVersion,
      PERPLEXITY_ENV_VARS.model,
      PERPLEXITY_ENV_VARS.endpointUrl,
    ]) {
      expect(workflow).not.toMatch(new RegExp(`^\\s*${key}:\\s*[^$\\s]`, 'm'));
    }
  });
});
