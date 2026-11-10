// DEPLOY-024: a deploy never restarts the production database.
//
// deploy/release.sh runs `docker compose` from the new release's own
// directory. When docker-compose.yml bind-mounted the Postgres init script by a
// relative path, that path resolved differently on every release, compose saw
// a changed postgres service and recreated the container mid-deploy. The
// release still serving traffic then lost its database for a second or two
// (deploy run 42734459319, 2026-11-10: the queue recovery timer failed with
// "make sure your database server is running at postgres:5432").
//
// The fix gives the mount a fixed source under runtime/, so the service config
// is identical between deploys. --no-recreate was rejected: it would pin the
// long-lived container to a release directory that prune_old_releases deletes,
// and the container could not start again after a host reboot.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const COMPOSE_PATH = join(REPO_ROOT, 'docker-compose.yml');
const INIT_SCRIPT_PATH = join(REPO_ROOT, 'deploy', 'postgres-init.sql');
const RELEASE_PATH = join(REPO_ROOT, 'deploy', 'release.sh');
const ROLLBACK_PATH = join(REPO_ROOT, 'deploy', 'rollback-release.sh');
const STABLE_INIT_EXPORT = 'export FLUXRADAR_POSTGRES_INIT="$RUNTIME_DIR/postgres-init.sql"';

function scriptLines(scriptPath: string): string[] {
  return readFileSync(scriptPath, 'utf8')
    .split('\n')
    .map((line) => line.trim());
}

function isComposeUp(line: string): boolean {
  return !line.startsWith('#') && /\bdocker compose\b.*\sup\s/.test(line);
}

function postgresServiceBlock(): string {
  const compose = readFileSync(COMPOSE_PATH, 'utf8');
  const match = /^ {2}postgres:\n((?: {4}.*\n|\n)+)/m.exec(compose);
  if (match?.[1] === undefined) throw new Error('docker-compose.yml has no postgres service');
  return match[1];
}

const hasComposeCli = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;
// CI runners ship the compose CLI, so a missing one there is a broken runner,
// not a reason to drop the only behavioural check.
const skipHashCheck = !hasComposeCli && process.env.CI === undefined;

describe('DEPLOY-024: deploys leave a running database alone', () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('postgres binds no relative path without a stable override', () => {
    const bindSources = [...postgresServiceBlock().matchAll(/^ {6}- (\S+?):\//gm)].map(
      (match) => match[1],
    );
    expect(bindSources).toContain('${FLUXRADAR_POSTGRES_INIT:-./deploy/postgres-init.sql}');
    for (const source of bindSources) {
      expect(source, `bind source ${source}`).not.toMatch(/^\.{1,2}\//);
    }
  });

  it('release.sh points the init mount at runtime/ before bringing postgres up', () => {
    const lines = scriptLines(RELEASE_PATH);
    const exportIndex = lines.indexOf(STABLE_INIT_EXPORT);
    const postgresUps = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => isComposeUp(line) && /\spostgres$/.test(line));
    expect(exportIndex).toBeGreaterThanOrEqual(0);
    expect(postgresUps).toHaveLength(1);
    expect(postgresUps[0]?.index).toBeGreaterThan(exportIndex);
  });

  it.each([RELEASE_PATH, ROLLBACK_PATH])(
    '%s brings no other service up together with postgres',
    (scriptPath) => {
      const otherUps = scriptLines(scriptPath).filter(
        (line) => isComposeUp(line) && !/\spostgres$/.test(line),
      );
      // Both scripts recreate caddy; finding none means the matcher went blind.
      expect(otherUps.length).toBeGreaterThan(0);
      for (const line of otherUps) expect(line).toMatch(/\s--no-deps\s/);
    },
  );

  it.skipIf(skipHashCheck)('two release directories give postgres the same config hash', () => {
    const root = mkdtempSync(join(tmpdir(), 'fluxradar-deploy-024-'));
    tempDirs.push(root);
    const stableInit = join(root, 'runtime', 'postgres-init.sql');
    mkdirSync(join(root, 'runtime'));
    copyFileSync(INIT_SCRIPT_PATH, stableInit);

    const hashes = ['release-a', 'release-b'].map((release) => {
      const dir = join(root, release);
      mkdirSync(join(dir, 'deploy'), { recursive: true });
      copyFileSync(COMPOSE_PATH, join(dir, 'docker-compose.yml'));
      copyFileSync(INIT_SCRIPT_PATH, join(dir, 'deploy', 'postgres-init.sql'));
      writeFileSync(join(dir, '.env'), '');
      writeFileSync(
        join(dir, '.env.production'),
        'POSTGRES_DB=db\nPOSTGRES_USER=user\nPOSTGRES_PASSWORD=pass\nDATABASE_URL=postgres://db\n',
      );
      const result = spawnSync(
        'docker',
        [
          'compose',
          '--env-file',
          '.env.production',
          '-p',
          'fluxradar',
          'config',
          '--hash',
          'postgres',
        ],
        {
          cwd: dir,
          encoding: 'utf8',
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            FLUXRADAR_POSTGRES_INIT: stableInit,
          },
        },
      );
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim();
    });

    expect(hashes[0]).toMatch(/^postgres [0-9a-f]{64}$/);
    expect(hashes[1]).toBe(hashes[0]);
  });
});
