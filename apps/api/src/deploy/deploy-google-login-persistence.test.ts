import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';

const ROOT = join(API_PACKAGE_ROOT, '..', '..');
const workspaces: string[] = [];
const DUMMY_SECRET = 'test-only-google-placeholder';
const overlay = `GOOGLE_LOGIN_CLIENT_ID=dummy.apps.googleusercontent.com\nGOOGLE_LOGIN_CLIENT_SECRET=${DUMMY_SECRET}\nGOOGLE_LOGIN_REDIRECT_URI=https://fluxradar.net/api/auth/google/callback\n`;

function workspace(): string {
  const path = mkdtempSync(join(ROOT, 'node_modules', '.google-login-deploy-'));
  workspaces.push(path);
  return path;
}

afterEach(() => {
  for (const path of workspaces.splice(0)) rmSync(path, { recursive: true, force: true });
});

function loadOverlay(
  options: { content?: string; required?: boolean; metadata?: string; symlink?: boolean } = {},
) {
  const path = workspace();
  const file = join(path, 'google-login.env');
  if (options.content !== undefined) {
    writeFileSync(file, options.content, { mode: 0o600 });
    if (options.symlink) {
      symlinkSync(file, join(path, 'link.env'));
    }
  }
  // Production is GNU/Linux and root. Only stat metadata is simulated for
  // non-root/macOS test hosts; key validation and symlink checks execute intact.
  writeFileSync(join(path, 'stat'), '#!/bin/sh\nprintf "%s\\n" "$STAT_RESULT"\n');
  chmodSync(join(path, 'stat'), 0o700);
  const selected = options.symlink ? join(path, 'link.env') : file;
  const result = spawnSync(
    'bash',
    [
      '-euc',
      '. "$1"; load_google_login_env "$2" "$3"; printf "required=%s\\n" "$GOOGLE_LOGIN_REQUIRED"; printf "%s\\n" ${GOOGLE_LOGIN_ENV_ARGS[@]+"${GOOGLE_LOGIN_ENV_ARGS[@]}"}',
      'test',
      join(ROOT, 'deploy/google-login-env.sh'),
      selected,
      String(options.required ?? false),
    ],
    {
      encoding: 'utf8',
      env: { PATH: `${path}:${process.env.PATH ?? ''}`, STAT_RESULT: options.metadata ?? '0:600' },
    },
  );
  return { ...result, file, selected };
}

function fakeProbe(
  options: {
    requiredPassword?: boolean;
    subject?: boolean;
    applied?: boolean;
    config?: boolean;
    enabled?: string;
    redirect?: string;
  } = {},
) {
  const path = workspace();
  const api = join(path, 'apps/api');
  const client = join(api, 'node_modules/@prisma/client');
  mkdirSync(client, { recursive: true });
  writeFileSync(join(api, 'package.json'), '{}');
  writeFileSync(join(client, 'package.json'), '{"main":"index.cjs"}');
  const fields = [
    { name: 'passwordHash', type: 'String', isRequired: options.requiredPassword ?? false },
    ...(options.subject === false
      ? []
      : [{ name: 'googleSubject', type: 'String', isRequired: false }]),
  ];
  const calls = join(path, 'calls.txt');
  writeFileSync(
    join(client, 'index.cjs'),
    `
const fs=require('node:fs');
const log=(value)=>fs.appendFileSync(${JSON.stringify(calls)},value+'\\n');
exports.Prisma={dmmf:{datamodel:{models:[{name:'Account',fields:${JSON.stringify(fields)}}]}}};
exports.PrismaClient=class {
  account={findFirst:async()=>{log('ACCOUNT_QUERY');return null}};
  async $transaction(fn){return fn(this)}
  async $executeRawUnsafe(sql){log(sql)}
  async $queryRawUnsafe(sql){log(sql.startsWith('SHOW')?'READ_ONLY_MODE':'METADATA_QUERY');return sql.startsWith('SHOW')?[{transaction_read_only:'on'}]:[{applied:${options.applied ?? true}}]}
  async $disconnect(){log('DISCONNECT')}
};`,
  );
  if (options.config) {
    mkdirSync(join(api, 'dist/auth'), { recursive: true });
    symlinkSync(
      join(API_PACKAGE_ROOT, 'dist/auth/google-provider.js'),
      join(api, 'dist/auth/google-provider.js'),
    );
  }
  const script = options.config ? 'rollback-readonly-probe.cjs' : 'rollback-schema-probe.cjs';
  const result = spawnSync(process.execPath, [join(ROOT, 'deploy', script)], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      NODE_ENV: 'production',
      FLUXRADAR_PROBE_APP_DIR: path,
      FRONTEND_ORIGIN: 'https://fluxradar.net',
      GOOGLE_LOGIN_ENABLED: options.enabled ?? '',
      GOOGLE_LOGIN_CLIENT_ID: 'dummy.apps.googleusercontent.com',
      GOOGLE_LOGIN_CLIENT_SECRET: DUMMY_SECRET,
      GOOGLE_LOGIN_REDIRECT_URI:
        options.redirect ?? 'https://fluxradar.net/api/auth/google/callback',
    },
    timeout: 10_000,
  });
  return { ...result, calls: existsSync(calls) ? readFileSync(calls, 'utf8') : '' };
}

describe('Google login deployment persistence', () => {
  it('keeps an unconfigured installation optional', () => {
    const result = loadOverlay();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('required=false');
  });

  it('requires a configured overlay and passes only its path without changing it', () => {
    const result = loadOverlay({ content: overlay });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`required=true\n--env-file\n${result.selected}`);
    expect(result.stdout + result.stderr).not.toContain(DUMMY_SECRET);
    expect(readFileSync(result.file, 'utf8')).toBe(overlay);
  });

  it('refuses a missing required overlay', () => {
    const result = loadOverlay({ required: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Required Google login overlay is missing');
  });

  it.each(['0:644', '501:600'])('refuses unsafe metadata %s', (metadata) => {
    expect(loadOverlay({ content: overlay, metadata }).status).not.toBe(0);
  });

  it('refuses symlinks', () => {
    expect(loadOverlay({ content: overlay, symlink: true }).status).not.toBe(0);
  });

  it.each([
    overlay.replace('GOOGLE_LOGIN_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_ID'),
    overlay.replace(DUMMY_SECRET, ''),
    `${overlay}GOOGLE_LOGIN_ENABLED=true\n`,
    overlay.replace(DUMMY_SECRET, 'contains whitespace'),
  ])('refuses incomplete, business-provider or extra key overlays', (content) => {
    const result = loadOverlay({ content });
    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain(DUMMY_SECRET);
  });

  it('accepts the generated nullable Google account client', () => {
    const result = fakeProbe();
    expect(result.status).toBe(0);
    expect(result.calls).toContain('SET TRANSACTION READ ONLY');
    expect(result.calls).toContain('ACCOUNT_QUERY');
    expect(result.calls).toContain('DISCONNECT');
  });

  it.each([{ requiredPassword: true }, { subject: false }])(
    'rejects an incompatible client before reading an account',
    (options) => {
      const result = fakeProbe(options);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('nullable passwordHash and googleSubject');
      expect(result.calls).not.toContain('ACCOUNT_QUERY');
      expect(result.calls).toContain('DISCONNECT');
    },
  );

  it('keeps older clients usable before the Google migration exists', () => {
    expect(fakeProbe({ requiredPassword: true, subject: false, applied: false }).status).toBe(0);
  });

  it('validates the real pure Google config reader without starting an app', () => {
    expect(fakeProbe({ config: true }).status).toBe(0);
    const invalid = fakeProbe({ config: true, redirect: 'https://attacker.example/wrong' });
    expect(invalid.status).not.toBe(0);
    expect(invalid.stdout + invalid.stderr).not.toContain(DUMMY_SECRET);
  });

  it('keeps the nonsecret false switch effective despite overlay credentials', () => {
    expect(fakeProbe({ config: true, enabled: 'false', redirect: 'invalid' }).status).toBe(0);
    const workflow = readFileSync(join(ROOT, '.github/workflows/deploy.yml'), 'utf8');
    expect(workflow).toContain('PRODUCTION_GOOGLE_LOGIN_ENABLED: ${{ vars.PRODUCTION_GOOGLE_LOGIN_ENABLED }}');
    expect(workflow).toContain('upsert_env GOOGLE_LOGIN_ENABLED PRODUCTION_GOOGLE_LOGIN_ENABLED');
  });
});
