// DEPLOY-013: transactional email, overridden as a pair or not at all.
//
// `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are useless apart, and the state
// between them is the one this codebase refuses to let happen quietly: the
// registration succeeds, the browser is told a verification email is on its
// way, and nothing arrives. `readResendConfig` reports that as `invalid` at
// boot by variable name — but only after a deploy has already shipped it.
//
// Both are therefore optional deploy overrides, and both inherit the rule every
// other override here follows: non-empty replaces what `PRODUCTION_ENV_FILE`
// defines, empty keeps it. Three ways that can silently fail, none of them
// visible in a green deploy:
//
//   1. An override declared on the step but never written into the release env
//      file, or written after the file has already shipped. The deploy is green;
//      production keeps the old value.
//   2. An unset secret resolves to the EMPTY STRING, and a blanket upsert writes
//      `RESEND_API_KEY=` over a working base value. Email stops, and the
//      integration is reported half-configured by a deploy that changed nothing.
//   3. The display-name form — `FluxRadar <no-reply@fluxradar.net>`, with spaces
//      and angle brackets — mangled in transit, producing a sender Resend
//      rejects on the first send and nowhere before it.
//
// This suite runs the shell function the workflow actually ships, so the shape
// of the value is tested rather than assumed.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { RESEND_ENV_VARS, readResendConfig } from '../email/resend-config.ts';
import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const WORKFLOW = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');

const API_KEY = 're_test_api_key_value';
const SENDER = 'FluxRadar <no-reply@fluxradar.net>';
const BASE_KEY = 're_base_file_api_key';
const BASE_SENDER = 'FluxRadar <old-sender@fluxradar.net>';

/** The env-var name each override reads, as the workflow declares the pair. */
const SOURCES = {
  [RESEND_ENV_VARS.apiKey]: 'PRODUCTION_RESEND_API_KEY',
  [RESEND_ENV_VARS.from]: 'PRODUCTION_RESEND_FROM_EMAIL',
} as const;

/** The `upsert_env` definition as shipped, dedented out of the workflow's `run:` block. */
function shippedUpsertEnv(): string {
  const start = WORKFLOW.indexOf('          upsert_env() {');
  const end = WORKFLOW.indexOf('          }\n', start);
  expect(start, 'the deploy no longer defines upsert_env').toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return WORKFLOW.slice(start, end + '          }\n'.length)
    .split('\n')
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n');
}

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

/**
 * Runs both shipped upserts against a base env file and returns what the release
 * env file ends up containing, parsed the way `docker run --env-file` reads it.
 * A secret left out of `secrets` is an unset one, which is how GitHub delivers
 * an override nobody configured.
 */
function upsert(
  baseLines: readonly string[],
  secrets: Readonly<Record<string, string>>,
): Record<string, string> {
  const workspace = mkdtempSync(join(tmpdir(), 'fluxradar-resend-'));
  workspaces.push(workspace);
  writeFileSync(join(workspace, 'production.env'), `${baseLines.join('\n')}\n`);

  const calls = Object.entries(SOURCES)
    .map(([key, source]) => `upsert_env ${key} ${source}`)
    .join('\n');
  execFileSync('sh', ['-c', `${shippedUpsertEnv()}\n${calls}\n`], {
    env: { PATH: process.env.PATH ?? '', RUNNER_TEMP: workspace, ...secrets },
  });

  const values: Record<string, string> = {};
  for (const line of readFileSync(join(workspace, 'production.env'), 'utf8').split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const separator = line.indexOf('=');
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

const BASE_PAIR = [
  `${RESEND_ENV_VARS.apiKey}=${BASE_KEY}`,
  `${RESEND_ENV_VARS.from}=${BASE_SENDER}`,
];

describe('DEPLOY-013 the Resend overrides', () => {
  it('are declared on the step and written into the release env file', () => {
    for (const [key, source] of Object.entries(SOURCES)) {
      expect(WORKFLOW).toContain(`${source}: \${{ secrets.${source} }}`);
      expect(WORKFLOW).toContain(`upsert_env ${key} ${source}`);
    }
  });

  // Written after the normalizer has run, or after the file has been uploaded,
  // an override exists in the workflow and not in production.
  it('are applied before the env file is normalised and shipped', () => {
    const normalizeAt = WORKFLOW.indexOf('node deploy/normalize-env-file.cjs');
    // Where the env file ships: a `files:` entry of the remote-upload action.
    const uploadAt = WORKFLOW.indexOf('${{ runner.temp }}/production.env');

    for (const key of Object.keys(SOURCES)) {
      const upsertAt = WORKFLOW.indexOf(`upsert_env ${key} `);
      expect(upsertAt, `${key} is never written into the release env file`).toBeGreaterThan(-1);
      expect(normalizeAt).toBeGreaterThan(upsertAt);
    }
    expect(uploadAt).toBeGreaterThan(normalizeAt);
  });

  it('replace the base values when both secrets are set', () => {
    const values = upsert(BASE_PAIR, {
      PRODUCTION_RESEND_API_KEY: API_KEY,
      PRODUCTION_RESEND_FROM_EMAIL: SENDER,
    });

    expect(readResendConfig(values)).toEqual({
      state: 'configured',
      config: { apiKey: API_KEY, from: SENDER },
    });
  });

  // GitHub resolves an undefined secret to the empty string, so "not configured"
  // and "configured as nothing" arrive here identically. Both must be skipped,
  // or a deploy that changed nothing silently disables email.
  it.each([
    ['unset', {}],
    ['empty', { PRODUCTION_RESEND_API_KEY: '', PRODUCTION_RESEND_FROM_EMAIL: '' }],
  ])('keep the base values when the secrets are %s', (_case, secrets) => {
    const values = upsert(BASE_PAIR, secrets);

    expect(readResendConfig(values)).toEqual({
      state: 'configured',
      config: { apiKey: BASE_KEY, from: BASE_SENDER },
    });
  });

  it('can supply either half on its own, leaving the other as the base file has it', () => {
    expect(upsert(BASE_PAIR, { PRODUCTION_RESEND_FROM_EMAIL: SENDER })).toMatchObject({
      [RESEND_ENV_VARS.apiKey]: BASE_KEY,
      [RESEND_ENV_VARS.from]: SENDER,
    });
    expect(upsert(BASE_PAIR, { PRODUCTION_RESEND_API_KEY: API_KEY })).toMatchObject({
      [RESEND_ENV_VARS.apiKey]: API_KEY,
      [RESEND_ENV_VARS.from]: BASE_SENDER,
    });
  });

  // The state that shipped once already: a base env file with no RESEND_* line
  // at all, and the deploy expected to supply the whole integration.
  it('configure email from a base file that mentions Resend nowhere', () => {
    const values = upsert(['POSTGRES_PASSWORD=p4ssw0rd'], {
      PRODUCTION_RESEND_API_KEY: API_KEY,
      PRODUCTION_RESEND_FROM_EMAIL: SENDER,
    });

    expect(readResendConfig(values).state).toBe('configured');
  });

  // Half a pair sends nothing, and says so at boot rather than at the first
  // customer who never got their verification email.
  it('leave a half-supplied pair reported as invalid, by name', () => {
    const result = readResendConfig(
      upsert(['POSTGRES_PASSWORD=p4ssw0rd'], { PRODUCTION_RESEND_FROM_EMAIL: SENDER }),
    );

    expect(result.state).toBe('invalid');
    if (result.state !== 'invalid') return;
    expect(result.missing).toContain(RESEND_ENV_VARS.apiKey);
  });

  // Spaces and angle brackets survive `printf %s` but not a careless rewrite,
  // and a mangled sender is an HTTP error on the first send and nothing before.
  it('carry the display-name form through verbatim', () => {
    const values = upsert(BASE_PAIR, { PRODUCTION_RESEND_FROM_EMAIL: SENDER });

    expect(values[RESEND_ENV_VARS.from]).toBe(SENDER);
  });

  it('leave every unrelated variable in the base file untouched', () => {
    const values = upsert(['POSTGRES_PASSWORD=p4ssw0rd', 'SESSION_SECRET=abc'], {
      PRODUCTION_RESEND_API_KEY: API_KEY,
      PRODUCTION_RESEND_FROM_EMAIL: SENDER,
    });

    expect(values.POSTGRES_PASSWORD).toBe('p4ssw0rd');
    expect(values.SESSION_SECRET).toBe('abc');
  });

  // RESEND_REPLY_TO configures nothing on its own and is optional even when the
  // pair is set, so a deploy secret for it could only ever add the half-filled
  // state readResendConfig reports as invalid.
  it('are the key and the sender, and never the reply-to', () => {
    const overridden = [...WORKFLOW.matchAll(/^\s*upsert_env (RESEND_\S+) \S+\s*$/gm)].map(
      (match) => match[1] as string,
    );

    expect([...overridden].sort()).toEqual([RESEND_ENV_VARS.apiKey, RESEND_ENV_VARS.from].sort());
    expect(overridden).not.toContain(RESEND_ENV_VARS.replyTo);
  });
});
