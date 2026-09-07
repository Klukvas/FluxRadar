// DEPLOY-013: the transactional sender, and the one variable a deploy may correct.
//
// `RESEND_FROM_EMAIL` is the half of the Resend pair that changes on its own —
// a rebrand, a new sending subdomain, a mailbox the provider stopped accepting.
// The other half, the API key, is a credential and stays in PRODUCTION_ENV_FILE
// with every other credential. Correcting only the sender used to mean rewriting
// that whole base secret blind, which is how an unrelated variable gets dropped.
//
// So the deploy gained one more optional override, and it inherits the rule the
// others already follow: non-empty replaces, empty keeps what the base defines.
// Three ways that can silently fail, none of them visible in a green deploy:
//
//   1. The override is declared on the step but never written into the release
//      env file (or written after the file has already shipped). The deploy is
//      green; production keeps the old sender.
//   2. An unset secret resolves to the empty string, and a blanket upsert writes
//      `RESEND_FROM_EMAIL=` over a working base value. Email stops, and
//      `readResendConfig` reports a half-configured provider nobody changed.
//   3. The display-name form — `FluxRadar <no-reply@fluxradar.net>`, with spaces
//      and angle brackets — is mangled in transit, producing a sender Resend
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
const BASE_SENDER = 'FluxRadar <old-sender@fluxradar.net>';

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
 * Runs the shipped upsert against a base env file and returns what the release
 * env file ends up containing, parsed the way `docker run --env-file` reads it.
 */
function upsert(
  baseLines: readonly string[],
  secretValue: string | undefined,
): Record<string, string> {
  const workspace = mkdtempSync(join(tmpdir(), 'fluxradar-resend-'));
  workspaces.push(workspace);
  writeFileSync(join(workspace, 'production.env'), `${baseLines.join('\n')}\n`);

  execFileSync(
    'sh',
    ['-c', `${shippedUpsertEnv()}\nupsert_env RESEND_FROM_EMAIL PRODUCTION_RESEND_FROM_EMAIL\n`],
    {
      env: {
        PATH: process.env.PATH ?? '',
        RUNNER_TEMP: workspace,
        ...(secretValue === undefined ? {} : { PRODUCTION_RESEND_FROM_EMAIL: secretValue }),
      },
    },
  );

  const values: Record<string, string> = {};
  for (const line of readFileSync(join(workspace, 'production.env'), 'utf8').split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const separator = line.indexOf('=');
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

describe('DEPLOY-013 the Resend sender override', () => {
  it('is declared on the step and written into the release env file', () => {
    expect(WORKFLOW).toContain(
      'PRODUCTION_RESEND_FROM_EMAIL: ${{ secrets.PRODUCTION_RESEND_FROM_EMAIL }}',
    );
    expect(WORKFLOW).toContain('upsert_env RESEND_FROM_EMAIL PRODUCTION_RESEND_FROM_EMAIL');
  });

  // Written after the normalizer has run, or after the file has been uploaded,
  // the override exists in the workflow and not in production.
  it('is applied before the env file is normalised and shipped', () => {
    const upsertAt = WORKFLOW.indexOf('upsert_env RESEND_FROM_EMAIL');
    const normalizeAt = WORKFLOW.indexOf('node deploy/normalize-env-file.cjs');
    const uploadAt = WORKFLOW.indexOf('scp "$RUNNER_TEMP/production.env"');

    expect(upsertAt).toBeGreaterThan(-1);
    expect(normalizeAt).toBeGreaterThan(upsertAt);
    expect(uploadAt).toBeGreaterThan(normalizeAt);
  });

  it('replaces the base sender when the secret is set', () => {
    const values = upsert(
      [`${RESEND_ENV_VARS.apiKey}=${API_KEY}`, `${RESEND_ENV_VARS.from}=${BASE_SENDER}`],
      SENDER,
    );

    expect(values[RESEND_ENV_VARS.from]).toBe(SENDER);
    expect(values[RESEND_ENV_VARS.apiKey]).toBe(API_KEY);
  });

  // GitHub resolves an undefined secret to the empty string, so "not configured"
  // and "configured as nothing" arrive here identically. Both must be skipped.
  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('keeps the base sender when the secret is %s', (_case, secretValue) => {
    const values = upsert(
      [`${RESEND_ENV_VARS.apiKey}=${API_KEY}`, `${RESEND_ENV_VARS.from}=${BASE_SENDER}`],
      secretValue,
    );

    expect(values[RESEND_ENV_VARS.from]).toBe(BASE_SENDER);
  });

  it('adds the sender to a base file that has only the key', () => {
    const values = upsert([`${RESEND_ENV_VARS.apiKey}=${API_KEY}`], SENDER);

    expect(readResendConfig(values)).toEqual({
      state: 'configured',
      config: { apiKey: API_KEY, from: SENDER },
    });
  });

  // Spaces and angle brackets survive `printf %s` but not a careless rewrite,
  // and a mangled sender is an HTTP error on the first send and nothing before.
  it('carries the display-name form through verbatim, and Resend config accepts it', () => {
    const values = upsert([`${RESEND_ENV_VARS.apiKey}=${API_KEY}`], SENDER);

    expect(values[RESEND_ENV_VARS.from]).toBe(SENDER);
    expect(readResendConfig(values).state).toBe('configured');
  });

  it('leaves every unrelated variable in the base file untouched', () => {
    const values = upsert(
      ['POSTGRES_PASSWORD=p4ssw0rd', `${RESEND_ENV_VARS.apiKey}=${API_KEY}`, 'SESSION_SECRET=abc'],
      SENDER,
    );

    expect(values.POSTGRES_PASSWORD).toBe('p4ssw0rd');
    expect(values.SESSION_SECRET).toBe('abc');
  });

  // The reply-to is optional everywhere and configures nothing on its own: a
  // deploy secret for it could only ever produce the half-filled state
  // readResendConfig reports as invalid. The API key is a credential and belongs
  // with the others in the base file, not in a second place that can disagree.
  it('is the only Resend variable the deploy overrides', () => {
    const overridden = [...WORKFLOW.matchAll(/^\s*upsert_env (RESEND_\S+) \S+\s*$/gm)].map(
      (match) => match[1],
    );

    expect(overridden).toEqual([RESEND_ENV_VARS.from]);
  });
});
