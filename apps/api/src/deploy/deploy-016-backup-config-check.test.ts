import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';

// DEPLOY-016: every deploy says whether the release it ships can be backed up.
//
// Production ran for two weeks with FLUXRADAR_BACKUP_ENCRYPTION_KEY set nowhere.
// pg-backup.sh refused to run every night and backup-verify failed every night,
// while every deploy in that time went green: nothing in the deploy asked. The
// package stage now runs deploy/backup/check-backup-config.sh on the env file it
// is about to ship and turns any missing name into a warning on the run.
//
// The list it checks is a copy of what the backup tooling requires, so the
// copy is compared with both sources here — a variable added to either one
// without being added to the check fails this test instead of going unasked.

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'deploy', 'backup', 'check-backup-config.sh');
const PG_BACKUP_PATH = join(REPO_ROOT, 'deploy', 'backup', 'pg-backup.sh');
const BACKUP_CLI_PATH = join(REPO_ROOT, 'deploy', 'backup', 'backup-cli.cjs');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'deploy.yml');

const COMPLETE: Readonly<Record<string, string>> = {
  POSTGRES_DB: 'fluxradar',
  POSTGRES_USER: 'fluxradar',
  FLUXRADAR_BACKUP_ENCRYPTION_KEY: 'c2VjcmV0LWtleS10aGF0LW11c3QtbmV2ZXItYmUtcHJpbnRlZA==',
  HETZNER_S3_ENDPOINT: 'https://fsn1.your-objectstorage.com',
  HETZNER_S3_REGION: 'fsn1',
  HETZNER_S3_BUCKET: 'fluxradar-backups',
  HETZNER_S3_ACCESS_KEY: 'access-key-value',
  HETZNER_S3_SECRET_KEY: 'secret-key-value',
};

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

function check(values: Readonly<Record<string, string>>): { exitCode: number; stdout: string } {
  const workspace = mkdtempSync(join(tmpdir(), 'fluxradar-backup-config-'));
  workspaces.push(workspace);
  const envFile = join(workspace, 'production.env');
  writeFileSync(
    envFile,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n',
  );
  const result = spawnSync('bash', [SCRIPT_PATH, envFile], { encoding: 'utf8' });
  return { exitCode: result.status ?? 1, stdout: result.stdout.trim() };
}

function without(...keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(COMPLETE).filter(([key]) => !keys.includes(key)));
}

/** The names the check itself looks for, read out of the script. */
function checkedNames(): readonly string[] {
  const script = readFileSync(SCRIPT_PATH, 'utf8');
  return [...script.matchAll(/^REQUIRED="(?:\$REQUIRED )?([^"]+)"$/gm)].flatMap((match) =>
    (match[1] ?? '').split(/\s+/),
  );
}

describe('DEPLOY-016 backup configuration check', () => {
  it('passes, silently, when everything a backup needs is set', () => {
    expect(check(COMPLETE)).toEqual({ exitCode: 0, stdout: '' });
  });

  it('names the missing encryption key — the state production was in', () => {
    const result = check(without('FLUXRADAR_BACKUP_ENCRYPTION_KEY'));
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('FLUXRADAR_BACKUP_ENCRYPTION_KEY');
  });

  it('treats a variable that is present but empty as missing', () => {
    const result = check({ ...COMPLETE, HETZNER_S3_BUCKET: '' });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('HETZNER_S3_BUCKET');
  });

  it('names every missing variable, and never prints a value', () => {
    const result = check(without('HETZNER_S3_REGION', 'HETZNER_S3_SECRET_KEY'));
    expect(result.stdout.split(' ').sort()).toEqual(['HETZNER_S3_REGION', 'HETZNER_S3_SECRET_KEY']);
    for (const value of Object.values(COMPLETE)) expect(result.stdout).not.toContain(value);
  });

  it('refuses to guess when it has no env file to read', () => {
    expect(spawnSync('bash', [SCRIPT_PATH, '/nonexistent/production.env']).status).toBe(2);
  });

  describe('checks exactly what the backup tooling requires', () => {
    it("covers pg-backup.sh's own required list", () => {
      const pgBackup = readFileSync(PG_BACKUP_PATH, 'utf8');
      const required = /^for required in ([A-Z0-9_ ]+); do$/m.exec(pgBackup)?.[1]?.split(' ') ?? [];
      expect(required.length).toBeGreaterThan(0);
      for (const name of required) expect(checkedNames()).toContain(name);
    });

    it("covers backup-cli.cjs's S3 variables", () => {
      const cli = readFileSync(BACKUP_CLI_PATH, 'utf8');
      const block = /const S3_ENV_VARS = \[([^\]]+)\]/.exec(cli)?.[1] ?? '';
      const s3 = [...block.matchAll(/'([A-Z0-9_]+)'/g)].map((match) => match[1] ?? '');
      expect(s3.length).toBeGreaterThan(0);
      for (const name of s3) expect(checkedNames()).toContain(name);
    });
  });

  it('runs on every deploy, on the env file the package stage is about to ship', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
    const checkAt = workflow.indexOf(
      'bash deploy/backup/check-backup-config.sh "$RUNNER_TEMP/production.env"',
    );
    expect(checkAt).toBeGreaterThan(workflow.indexOf('node deploy/normalize-env-file.cjs'));
    expect(checkAt).toBeLessThan(workflow.indexOf('${{ runner.temp }}/production.env'));
    expect(workflow).toContain('::warning title=Production cannot be backed up::');
  });
});
