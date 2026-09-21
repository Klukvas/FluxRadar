import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';

// DEPLOY-018: a contract-phase migration waits until every release a rollback
// could return to can read what it leaves behind (D-230).
//
// The rollback probe cannot enforce that: it runs after `migrate deploy` and
// checks only the live release, while the server keeps an older one too. So the
// migration names its prerequisite (`-- fluxradar:contract-requires <migration>`)
// and deploy/contract-phase-gate.sh, run before anything is migrated, checks
// every rollback candidate ships it. The layouts below are the real sequence:
// R19 before the D-229 release, R20 the D-229 release, R21 an ordinary release
// after it, C the release carrying the contract migration.

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const GATE_PATH = join(REPO_ROOT, 'deploy', 'contract-phase-gate.sh');
const MIGRATIONS = join('apps', 'api', 'prisma', 'migrations');

const INIT = '20260904110000_init';
const PREREQUISITE = '20260922100000_egress_locations';
const CONTRACT = '20260923100000_drop_retired_payment_columns';

const CONTRACT_SQL = `-- fluxradar:contract-phase — drops the retired columns.
-- fluxradar:contract-requires ${PREREQUISITE}
ALTER TABLE "Purchase" DROP COLUMN "paddleTransactionId";
`;

const RELEASES = {
  R19: [INIT],
  R20: [INIT, PREREQUISITE],
  R21: [INIT, PREREQUISITE],
  C: [INIT, PREREQUISITE, CONTRACT],
} as const satisfies Record<string, readonly string[]>;
type ReleaseName = keyof typeof RELEASES;

interface Layout {
  /** Oldest first; each gets a later modification time than the one before. */
  readonly onDisk: readonly ReleaseName[];
  readonly live?: ReleaseName;
  /** What runtime/rollback.env names; `missing` is a pruned directory, `null` writes no file. */
  readonly rollbackTarget?: ReleaseName | 'missing' | null;
  /** SQL for C's contract migration, when a test needs another one. */
  readonly contractSql?: string;
}

const workspaces: string[] = [];
const lockedDirs: string[] = [];

afterEach(() => {
  for (const dir of lockedDirs.splice(0)) chmodSync(dir, 0o755);
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

function lay(layout: Layout): string {
  const appDir = realpathSync(mkdtempSync(join(tmpdir(), 'fluxradar-contract-gate-')));
  workspaces.push(appDir);
  const base = Date.now() / 1000 - 3600;
  layout.onDisk.forEach((name, index) => {
    const migrationsDir = join(appDir, 'releases', name, MIGRATIONS);
    for (const migration of RELEASES[name]) {
      mkdirSync(join(migrationsDir, migration), { recursive: true });
      const sql = migration === CONTRACT ? (layout.contractSql ?? CONTRACT_SQL) : '-- additive\n';
      writeFileSync(join(migrationsDir, migration, 'migration.sql'), sql);
    }
    // The release script's pruning keeps the newest directories by mtime.
    const at = base + index * 60;
    utimesSync(join(appDir, 'releases', name), at, at);
  });
  if (layout.live !== undefined) {
    symlinkSync(join(appDir, 'releases', layout.live), join(appDir, 'current'));
  }
  if (layout.rollbackTarget !== undefined && layout.rollbackTarget !== null) {
    mkdirSync(join(appDir, 'runtime'), { recursive: true });
    const target = join(
      appDir,
      'releases',
      layout.rollbackTarget === 'missing' ? 'pruned-release' : layout.rollbackTarget,
    );
    writeFileSync(
      join(appDir, 'runtime', 'rollback.env'),
      `FLUXRADAR_ROLLBACK_RELEASE=${target}\nFLUXRADAR_ROLLBACK_RELEASE_ID=${layout.rollbackTarget}\n`,
    );
  }
  return appDir;
}

function gate(...args: readonly string[]): { readonly exitCode: number; readonly output: string } {
  const result = spawnSync('bash', [GATE_PATH, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
  });
  return {
    exitCode: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

const beforeMigrate = (appDir: string, release: ReleaseName = 'C') =>
  gate('before-migrate', appDir, release);

describe('DEPLOY-018 contract-phase gate', () => {
  describe('before migrate', () => {
    it('lets the contract run once the live release and its rollback target ship the prerequisite', () => {
      const appDir = lay({
        onDisk: ['R19', 'R20', 'R21', 'C'],
        live: 'R21',
        rollbackTarget: 'R20',
      });
      const run = beforeMigrate(appDir);
      expect(run.output).toContain('every rollback candidate ships');
      expect(run.exitCode).toBe(0);
    });

    // The mistake this exists for: the contract merged straight after D-229.
    it('refuses it straight after the release that ships the prerequisite', () => {
      const appDir = lay({ onDisk: ['R19', 'R20', 'C'], live: 'R20', rollbackTarget: 'R19' });
      const run = beforeMigrate(appDir);
      expect(run.exitCode).toBe(1);
      expect(run.output).toContain(`${CONTRACT} requires ${PREREQUISITE}, which R19 does not ship`);
      expect(run.output).not.toContain('which R20 does not ship');
    });

    it('refuses when the live release itself does not ship it', () => {
      const appDir = lay({ onDisk: ['R19', 'C'], live: 'R19', rollbackTarget: 'R19' });
      const run = beforeMigrate(appDir);
      expect(run.exitCode).toBe(1);
      expect(run.output).toContain('which R19 does not ship');
    });

    // After a rollback, rollback.env names the live release itself. The release
    // pruning keeps beside it is then the other newest directory — checked too.
    it('checks the other directory pruning keeps, not only what rollback.env names', () => {
      const appDir = lay({ onDisk: ['R19', 'R20', 'C'], live: 'R20', rollbackTarget: 'R20' });
      const run = beforeMigrate(appDir);
      expect(run.exitCode).toBe(1);
      expect(run.output).toContain('which R19 does not ship');
    });

    it('refuses when runtime/rollback.env names no rollback target', () => {
      const appDir = lay({ onDisk: ['R20', 'R21', 'C'], live: 'R21', rollbackTarget: null });
      const run = beforeMigrate(appDir);
      expect(run.exitCode).toBe(1);
      expect(run.output).toContain('names no rollback target');
    });

    it('refuses when the recorded rollback target is gone from the server', () => {
      const appDir = lay({ onDisk: ['R20', 'R21', 'C'], live: 'R21', rollbackTarget: 'missing' });
      const run = beforeMigrate(appDir);
      expect(run.exitCode).toBe(1);
      expect(run.output).toContain('is not on this server');
    });

    it('refuses a contract migration that names no prerequisite', () => {
      const appDir = lay({
        onDisk: ['R20', 'R21', 'C'],
        live: 'R21',
        rollbackTarget: 'R20',
        contractSql: '-- fluxradar:contract-phase\nALTER TABLE "Purchase" DROP COLUMN "x";\n',
      });
      const run = beforeMigrate(appDir);
      expect(run.exitCode).toBe(1);
      expect(run.output).toContain('names no prerequisite');
    });

    it('passes a release with no contract-phase migration without asking for more', () => {
      const appDir = lay({ onDisk: ['R19', 'R20'], live: 'R19', rollbackTarget: null });
      const run = beforeMigrate(appDir, 'R20');
      expect(run.exitCode).toBe(0);
      expect(run.output).toContain('carries no contract-phase migration');
    });

    it('passes the first deploy, which has nothing to roll back to', () => {
      const appDir = lay({ onDisk: ['C'] });
      expect(beforeMigrate(appDir).exitCode).toBe(0);
    });

    // Root reads a mode-000 directory anyway, so the failure cannot be staged.
    it.skipIf(process.getuid?.() === 0)('refuses when the migrations cannot be read', () => {
      const appDir = lay({ onDisk: ['R20', 'R21', 'C'], live: 'R21', rollbackTarget: 'R20' });
      const dir = join(appDir, 'releases', 'C', MIGRATIONS);
      chmodSync(dir, 0o000);
      lockedDirs.push(dir);
      const run = beforeMigrate(appDir);
      expect(run.exitCode).toBe(1);
      expect(run.output).toContain('could not be read');
    });
  });

  // A contract deploy that fails AFTER migrating never prunes, so the release
  // from before D-229 is still on disk, image and all, next to a schema it
  // cannot read. Rolling back to it by hand is what this refuses.
  describe('rollback target', () => {
    const afterFailedContract = { onDisk: ['R19', 'R20', 'R21', 'C'], live: 'R21' } as const;

    it('refuses the release from before the prerequisite', () => {
      const appDir = lay(afterFailedContract);
      const run = gate('rollback-target', appDir, join(appDir, 'releases', 'R19'));
      expect(run.exitCode).toBe(1);
      expect(run.output).toContain(`${CONTRACT} requires ${PREREQUISITE}, which R19 does not ship`);
    });

    it('allows a release that ships the prerequisite', () => {
      const appDir = lay(afterFailedContract);
      expect(gate('rollback-target', appDir, join(appDir, 'releases', 'R20')).exitCode).toBe(0);
    });

    it('allows a release that ships the contract migration itself', () => {
      const appDir = lay(afterFailedContract);
      expect(gate('rollback-target', appDir, join(appDir, 'releases', 'C')).exitCode).toBe(0);
    });

    it('allows any release while no release carries a contract migration', () => {
      const appDir = lay({ onDisk: ['R19', 'R20'], live: 'R20' });
      expect(gate('rollback-target', appDir, join(appDir, 'releases', 'R19')).exitCode).toBe(0);
    });
  });

  it('answers a wrong call with its usage and exit 2', () => {
    const run = gate('before-migrate');
    expect(run.exitCode).toBe(2);
    expect(run.output).toContain('usage: contract-phase-gate.sh');
  });
});
