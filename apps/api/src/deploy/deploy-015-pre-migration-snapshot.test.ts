import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';

// DEPLOY-015: the snapshot before a migration has to fail CLOSED.
//
// `prisma migrate deploy` cannot be undone, and the dump taken just before it is
// the only thing that can bring back a column it dropped. The first version of
// this gate lived inline in deploy.yml and decided "no snapshot needed" from
//
//   added="$(comm -13 <(list current) <(list new) || true)"
//
// where nothing checked the listings and `|| true` swallowed the comparison. Any
// failure in there — a missing directory, an unreadable one, a comm error — came
// out as an empty list, which read as "no new migrations", and the migration ran
// with no snapshot. It also had no test at all.
//
// deploy/backup/pre-migration-snapshot.sh is RUN here, from a release directory
// laid out the way the package stage leaves it, against a recorded pg-backup.sh.

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'deploy', 'backup', 'pre-migration-snapshot.sh');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'deploy.yml');
const MIGRATIONS = join('apps', 'api', 'prisma', 'migrations');

const CURRENT_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NEXT_ID = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

/** pg-backup.sh as the active release ships it, recording each invocation. */
const BACKUP_RECORDER = String.raw`#!/usr/bin/env bash
printf '%s\n' "$*" >> "$BACKUP_LOG"
exit "$BACKUP_EXIT"
`;

interface Options {
  /** No `current` symlink at all. */
  readonly firstDeploy?: boolean;
  /** Migration directories of the active release; `null` means it has no migrations directory. */
  readonly current?: readonly string[] | null;
  /** Migration directories of the new release; `null` means it has no migrations directory. */
  readonly next?: readonly string[] | null;
  /** migration_lock.toml — a FILE beside the migrations — only in the new release. */
  readonly lockFileOnlyInNext?: boolean;
  readonly unreadableNext?: boolean;
  readonly noBackupScript?: boolean;
  readonly backupExit?: number;
  readonly allow?: string;
}

interface GateRun {
  readonly exitCode: number;
  readonly output: string;
  readonly backupCalls: readonly string[];
}

const workspaces: string[] = [];
const lockedDirs: string[] = [];

afterEach(() => {
  for (const dir of lockedDirs.splice(0)) chmodSync(dir, 0o755);
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

function makeRelease(
  appDir: string,
  releaseId: string,
  migrations: readonly string[] | null,
  withLockFile: boolean,
): string {
  const releaseDir = join(appDir, 'releases', releaseId);
  mkdirSync(join(releaseDir, 'deploy', 'backup'), { recursive: true });
  if (migrations !== null) {
    const migrationsDir = join(releaseDir, MIGRATIONS);
    mkdirSync(migrationsDir, { recursive: true });
    for (const name of migrations) {
      mkdirSync(join(migrationsDir, name));
      writeFileSync(join(migrationsDir, name, 'migration.sql'), '-- migration\n');
    }
    if (withLockFile) writeFileSync(join(migrationsDir, 'migration_lock.toml'), 'provider = "postgresql"\n');
  }
  return releaseDir;
}

function runGate(options: Options = {}): GateRun {
  const appDir = realpathSync(mkdtempSync(join(tmpdir(), 'fluxradar-premigration-')));
  workspaces.push(appDir);

  const currentDir = makeRelease(
    appDir,
    CURRENT_ID,
    options.current === undefined ? ['20260101000000_init', '20260201000000_billing'] : options.current,
    true,
  );
  if (!options.noBackupScript) {
    const backupScript = join(currentDir, 'deploy', 'backup', 'pg-backup.sh');
    writeFileSync(backupScript, BACKUP_RECORDER);
    chmodSync(backupScript, 0o755);
  }
  if (!options.firstDeploy) symlinkSync(currentDir, join(appDir, 'current'));

  const nextDir = makeRelease(
    appDir,
    NEXT_ID,
    options.next === undefined ? ['20260101000000_init', '20260201000000_billing'] : options.next,
    options.lockFileOnlyInNext ?? true,
  );
  if (options.lockFileOnlyInNext) {
    rmSync(join(currentDir, MIGRATIONS, 'migration_lock.toml'), { force: true });
  }
  if (options.unreadableNext) {
    const dir = join(nextDir, MIGRATIONS);
    chmodSync(dir, 0o000);
    lockedDirs.push(dir);
  }

  // Run from where the backup stage runs it: the NEW release's own copy.
  const scriptPath = join(nextDir, 'deploy', 'backup', 'pre-migration-snapshot.sh');
  copyFileSync(SCRIPT_PATH, scriptPath);
  const backupLog = join(appDir, 'backup.log');
  writeFileSync(backupLog, '');

  const result = spawnSync('bash', [scriptPath, appDir, NEXT_ID, options.allow ?? 'false'], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      BACKUP_LOG: backupLog,
      BACKUP_EXIT: String(options.backupExit ?? 0),
    },
  });

  return {
    exitCode: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    backupCalls: readFileSync(backupLog, 'utf8').split('\n').filter(Boolean),
  };
}

const NEW_MIGRATION = '20260301000000_add_column';

describe('DEPLOY-015 pre-migration snapshot', () => {
  describe('when there is nothing to protect', () => {
    it('skips a first deploy, which has no database to snapshot', () => {
      const gate = runGate({ firstDeploy: true });
      expect(gate.exitCode).toBe(0);
      expect(gate.output).toContain('First deploy');
      expect(gate.backupCalls).toEqual([]);
    });

    it('skips a release whose migrations are exactly the active one', () => {
      const gate = runGate();
      expect(gate.exitCode).toBe(0);
      expect(gate.output).toContain('no snapshot is needed');
      expect(gate.backupCalls).toEqual([]);
    });

    it('does not mistake migration_lock.toml for a migration', () => {
      const gate = runGate({ lockFileOnlyInNext: true });
      expect(gate.exitCode).toBe(0);
      expect(gate.backupCalls).toEqual([]);
    });
  });

  describe('when the release adds a migration', () => {
    const withNewMigration = {
      next: ['20260101000000_init', '20260201000000_billing', NEW_MIGRATION],
    };

    it("snapshots through the ACTIVE release's pg-backup.sh, and names the migration", () => {
      const gate = runGate(withNewMigration);
      expect(gate.exitCode).toBe(0);
      expect(gate.backupCalls).toHaveLength(1);
      expect(gate.backupCalls[0]).toMatch(/^--app-dir \S+/);
      expect(gate.output).toContain(NEW_MIGRATION);
      expect(gate.output).toContain('OK: a snapshot of the pre-migration database is in the bucket');
    });

    it('refuses to migrate when the snapshot fails', () => {
      const gate = runGate({ ...withNewMigration, backupExit: 1 });
      expect(gate.exitCode).toBe(1);
      expect(gate.output).toContain('Refusing to migrate without one');
    });

    it('refuses when the active release has no backup tooling to snapshot with', () => {
      const gate = runGate({ ...withNewMigration, noBackupScript: true });
      expect(gate.exitCode).toBe(1);
      expect(gate.output).toContain('predates the backup tooling');
    });

    it('lets an operator go on without it only by saying so, loudly', () => {
      const gate = runGate({ ...withNewMigration, backupExit: 1, allow: 'true' });
      expect(gate.exitCode).toBe(0);
      expect(gate.output).toContain('WARNING: ALLOW_MIGRATION_WITHOUT_BACKUP=true');
      // Anything but the exact word keeps the gate.
      expect(runGate({ ...withNewMigration, backupExit: 1, allow: 'yes' }).exitCode).toBe(1);
    });
  });

  // THE REGRESSION: each of these used to read as "no new migrations".
  describe('when what the release migrates cannot be told, it snapshots', () => {
    it('for a release that carries no migrations directory', () => {
      const gate = runGate({ next: null });
      expect(gate.backupCalls).toHaveLength(1);
      expect(gate.output).toContain('this release carries no');
    });

    it('for an active release that has none to compare against', () => {
      const gate = runGate({ current: null });
      expect(gate.backupCalls).toHaveLength(1);
      expect(gate.output).toContain('has no');
    });

    // Root reads a mode-000 directory anyway, so the failure cannot be staged.
    it.skipIf(process.getuid?.() === 0)('for a migrations directory that cannot be listed', () => {
      const gate = runGate({ unreadableNext: true });
      expect(gate.backupCalls).toHaveLength(1);
      expect(gate.output).toContain('could not be listed');
    });

    it('and still refuses to migrate when that snapshot fails', () => {
      expect(runGate({ next: null, backupExit: 1 }).exitCode).toBe(1);
    });
  });

  it('is what the backup stage runs, from the release directory, with no inline copy left', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
    expect(workflow).toContain(
      'exec bash "$1/releases/$2/deploy/backup/pre-migration-snapshot.sh" "$1" "$2" "$3"',
    );
    expect(workflow).not.toContain('comm -13');
  });
});
