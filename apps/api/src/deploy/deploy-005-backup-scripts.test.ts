import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';
import { startStubBucket, type StubBucket } from '../test-utils/stub-bucket.ts';

// DEPLOY-005: what the backup and restore scripts actually do on the server.
//
// These two scripts are the ones a cron job and an incident run. Everything they
// touch that matters is behind `docker`: pg_dump against the live database,
// createdb/dropdb, pg_restore. So `docker` is replaced with a recorder on PATH —
// every invocation is written to a log the assertions read, and the pg_dump call
// returns a canned dump. That makes the questions below answerable without a
// Docker daemon and, more importantly, without a production database:
//
//   * does a backup end with an encrypted object in the bucket that decrypts
//     back to exactly what pg_dump produced?
//   * does the restore path refuse, before touching anything, every way of
//     asking it to overwrite the live database?
//   * does the verification restore only ever create and drop a throwaway
//     database whose name it chose itself?
//
// The one thing a fake `docker` cannot prove is that pg_dump/pg_restore agree
// with the real PostgreSQL 17 in the container. That is the deliberate boundary
// of this suite; the scheduled `backup-verify` workflow closes it against the
// real server (.github/workflows/backup-verify.yml).

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const BACKUP_DIR = join(REPO_ROOT, 'deploy', 'backup');
const BACKUP_SCRIPT = join(BACKUP_DIR, 'pg-backup.sh');
const RESTORE_SCRIPT = join(BACKUP_DIR, 'pg-restore.sh');

const execFileAsync = promisify(execFile);
const KEY = randomBytes(32).toString('base64');
const PREFIX = 'fluxradar/postgres';
const DUMP_CONTENT = 'PGDMP fake custom-format dump produced by the recorder\n'.repeat(64);

const workspaces: string[] = [];
const buckets: StubBucket[] = [];

afterEach(async () => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
  for (const bucket of buckets.splice(0)) await bucket.close();
});

interface Harness {
  readonly appDir: string;
  readonly envFile: string;
  readonly binDir: string;
  readonly stub: StubBucket;
  /** Every `docker` invocation, one line of arguments each. */
  dockerCalls: () => readonly string[];
}

/**
 * A fake `docker` that records its arguments and answers the three commands the
 * scripts depend on: `ps` (find the container), `exec … pg_dump` (emit a dump on
 * stdout) and everything else (succeed silently). It writes its own argv to a
 * log so the assertions can state exactly what was and was not run.
 */
const DOCKER_RECORDER = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$DOCKER_LOG"
for arg in "$@"; do
  case "$arg" in
    pg_dump) printf '%s' "$FAKE_DUMP"; exit 0 ;;
    pg_restore) : > "$DOCKER_LOG.restored" ;;
    psql)
      # The restore checks four counts. Only one of them — unfinished migrations
      # — is expected to be zero on a healthy database, so it is answered
      # separately; otherwise a passing restore could never be simulated.
      #
      # The destructive path asks for the table count TWICE with the same query:
      # once to require an empty target, once to check what was restored. With
      # FAKE_PSQL_EMPTY_UNTIL_RESTORE set, this answers the way a real database
      # would — 0 before the restore, FAKE_PSQL_ROWS after it.
      case "$*" in
        *"finished_at IS NULL"*) printf '%s\\n' "\${FAKE_PSQL_UNFINISHED:-0}" ;;
        *information_schema.tables*)
          if [ -n "\${FAKE_PSQL_EMPTY_UNTIL_RESTORE:-}" ] && [ ! -f "$DOCKER_LOG.restored" ]; then
            printf '0\\n'
          else
            printf '%s\\n' "\${FAKE_PSQL_ROWS:-0}"
          fi ;;
        *) printf '%s\\n' "\${FAKE_PSQL_ROWS:-0}" ;;
      esac
      exit 0 ;;
  esac
done
case "$1" in
  ps) printf '%s\\n' "\${FAKE_PS_OUTPUT-fluxradar-postgres-1}" ;;
esac
exit 0
`;

async function harness(overrides: Record<string, string> = {}): Promise<Harness> {
  const appDir = mkdtempSync(join(tmpdir(), 'fluxradar-appdir-'));
  workspaces.push(appDir);
  const stub = await startStubBucket();
  buckets.push(stub);

  mkdirSync(join(appDir, 'current'), { recursive: true });
  const envFile = join(appDir, 'current', '.env.production');
  const values: Record<string, string> = {
    POSTGRES_DB: 'fluxradar',
    POSTGRES_USER: 'fluxradar',
    POSTGRES_PASSWORD: 'not-a-real-password',
    HETZNER_S3_ENDPOINT: stub.url,
    HETZNER_S3_REGION: 'nbg1',
    HETZNER_S3_BUCKET: stub.bucket,
    HETZNER_S3_ACCESS_KEY: 'access-key-id',
    HETZNER_S3_SECRET_KEY: 'secret-access-key',
    FLUXRADAR_BACKUP_ENCRYPTION_KEY: KEY,
    FLUXRADAR_BACKUP_PREFIX: PREFIX,
    ...overrides,
  };
  writeFileSync(
    envFile,
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`,
  );

  const binDir = join(appDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, 'docker'), DOCKER_RECORDER);
  chmodSync(join(binDir, 'docker'), 0o755);

  return {
    appDir,
    envFile,
    binDir,
    stub,
    dockerCalls: () => {
      try {
        return readFileSync(join(appDir, 'docker.log'), 'utf8').split('\n').filter(Boolean);
      } catch {
        return [];
      }
    },
  };
}

/**
 * Every database a recorded `docker` call would actually act on.
 *
 * Grepping the raw command line for the live database name is not the invariant:
 * `createdb --username fluxradar fluxradar_verify_1` legitimately names it as the
 * ROLE. What matters is the target — the last argument of createdb/dropdb and the
 * `--dbname` value of pg_restore/psql — so those are extracted by position.
 */
function databaseTargets(calls: readonly string[]): readonly { tool: string; database: string }[] {
  const targets: { tool: string; database: string }[] = [];
  for (const call of calls) {
    const args = call.split(' ');
    for (const tool of ['createdb', 'dropdb']) {
      if (args.includes(tool)) targets.push({ tool, database: args[args.length - 1] ?? '' });
    }
    for (const tool of ['pg_restore', 'psql']) {
      const index = args.indexOf('--dbname');
      if (args.includes(tool) && index !== -1) {
        targets.push({ tool, database: args[index + 1] ?? '' });
      }
    }
  }
  return targets;
}

/** Runs a shipped script with the fake docker first on PATH. */
async function runScript(
  script: string,
  args: readonly string[],
  context: Harness,
  env: Readonly<Record<string, string>> = {},
): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('bash', [script, ...args], {
      encoding: 'utf8',
      env: {
        PATH: `${context.binDir}:${process.env.PATH ?? ''}`,
        HOME: context.appDir,
        DOCKER_LOG: join(context.appDir, 'docker.log'),
        FAKE_DUMP: DUMP_CONTENT,
        FLUXRADAR_APP_DIR: context.appDir,
        ...env,
      },
      maxBuffer: 16 * 1024 * 1024,
    });
    return { ok: true, output: `${stdout}${stderr}` };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

describe('DEPLOY-005 backup and restore scripts', () => {
  describe('pg-backup.sh', () => {
    it('dumps, encrypts and uploads a snapshot that decrypts back to the dump', async () => {
      const context = await harness();
      const result = await runScript(BACKUP_SCRIPT, [], context);
      expect(result.output).toContain('backup finished');
      expect(result.ok).toBe(true);

      const archiveKey = [...context.stub.objects.keys()].find((key) => key.endsWith('.dump.enc'));
      expect(archiveKey).toBeDefined();
      expect(archiveKey!.startsWith(`${PREFIX}/`)).toBe(true);
      // Ciphertext, not the dump: the bucket never sees a customer record.
      expect(context.stub.objects.get(archiveKey!)!.body.toString('latin1')).not.toContain('PGDMP');

      const restored = join(context.appDir, 'roundtrip.dump');
      const download = await execFileAsync(
        process.execPath,
        [
          join(BACKUP_DIR, 'backup-cli.cjs'),
          'download',
          '--env-file',
          context.envFile,
          '--key',
          archiveKey!,
          '--out',
          restored,
        ],
        { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } },
      );
      expect(download.stdout).toContain('checksum verified');
      expect(readFileSync(restored, 'utf8')).toBe(DUMP_CONTENT);
    });

    it('runs pg_dump inside the container and issues no write statement', async () => {
      const context = await harness();
      await runScript(BACKUP_SCRIPT, [], context);
      const calls = context.dockerCalls();
      expect(calls.some((call) => call.includes('pg_dump'))).toBe(true);
      // A backup reads. Anything that could change or drop state is a bug, and
      // this is the assertion that would catch it being added.
      for (const forbidden of [
        'pg_restore',
        'dropdb',
        'createdb',
        'DROP ',
        'DELETE ',
        'TRUNCATE',
      ]) {
        expect(calls.join('\n')).not.toContain(forbidden);
      }
    });

    it('leaves no plaintext dump behind', async () => {
      const context = await harness();
      await runScript(BACKUP_SCRIPT, [], context);
      const workDir = join(context.appDir, 'backups', 'work');
      const leftovers = readFileSync(join(context.appDir, 'docker.log'), 'utf8');
      expect(leftovers).toContain('pg_dump');
      expect(() => readFileSync(join(workDir, 'fluxradar.dump'))).toThrow();
      const remaining = await execFileAsync('bash', ['-c', `ls -1 ${workDir} | wc -l`], {
        encoding: 'utf8',
      });
      expect(Number(remaining.stdout.trim())).toBe(0);
    });

    it('writes nothing to the bucket on a dry run', async () => {
      const context = await harness();
      const result = await runScript(BACKUP_SCRIPT, ['--dry-run'], context);
      expect(result.ok).toBe(true);
      expect(result.output).toContain('DRY RUN');
      expect(context.stub.objects.size).toBe(0);
    });

    it('fails, without uploading, when the encryption key is absent', async () => {
      const context = await harness({ FLUXRADAR_BACKUP_ENCRYPTION_KEY: '' });
      const result = await runScript(BACKUP_SCRIPT, [], context);
      expect(result.ok).toBe(false);
      expect(result.output).toContain('FLUXRADAR_BACKUP_ENCRYPTION_KEY');
      expect(context.stub.objects.size).toBe(0);
    });

    it('fails when no PostgreSQL container is running', async () => {
      const context = await harness();
      const result = await runScript(BACKUP_SCRIPT, [], context, { FAKE_PS_OUTPUT: '' });
      expect(result.ok).toBe(false);
      expect(result.output).toContain('no running PostgreSQL container');
      expect(context.stub.objects.size).toBe(0);
    });

    it('fails when pg_dump produces nothing', async () => {
      const context = await harness();
      const result = await runScript(BACKUP_SCRIPT, [], context, { FAKE_DUMP: '' });
      expect(result.ok).toBe(false);
      expect(result.output).toContain('empty file');
      expect(context.stub.objects.size).toBe(0);
    });
  });

  describe('pg-restore.sh', () => {
    /** Uploads one snapshot so the restore path has something to fetch. */
    async function withSnapshot(context: Harness): Promise<void> {
      const result = await runScript(BACKUP_SCRIPT, [], context);
      expect(result.ok).toBe(true);
      rmSync(join(context.appDir, 'docker.log'), { force: true });
    }

    it('restores the newest snapshot into a throwaway database and drops it again', async () => {
      const context = await harness();
      await withSnapshot(context);
      const result = await runScript(RESTORE_SCRIPT, ['--verify-latest'], context, {
        FAKE_PSQL_ROWS: '42',
      });
      expect(result.output).toContain('restore verification succeeded');
      expect(result.ok).toBe(true);

      const calls = context.dockerCalls();
      const targets = databaseTargets(calls);
      const created = targets.find((target) => target.tool === 'createdb')?.database;
      expect(created).toMatch(/^fluxradar_verify_\d+$/);
      expect(targets.some((target) => target.tool === 'pg_restore')).toBe(true);
      expect(
        targets.some((target) => target.tool === 'dropdb' && target.database === created),
      ).toBe(true);
      // EVERY database this run acted on is the throwaway it created itself. The
      // live database is never created, restored into, queried or dropped.
      expect(targets.map((target) => target.database)).toEqual(targets.map(() => created));
    });

    it('keeps the throwaway database only when asked, and still never the live one', async () => {
      const context = await harness();
      await withSnapshot(context);
      const result = await runScript(RESTORE_SCRIPT, ['--verify-latest', '--keep'], context, {
        FAKE_PSQL_ROWS: '7',
      });
      expect(result.ok).toBe(true);
      expect(result.output).toContain('was kept');
      expect(context.dockerCalls().join('\n')).not.toContain('dropdb');
    });

    it('touches no database at all on a dry run', async () => {
      const context = await harness();
      await withSnapshot(context);
      const result = await runScript(RESTORE_SCRIPT, ['--dry-run'], context);
      expect(result.ok).toBe(true);
      expect(result.output).toContain('no database was touched');
      const calls = context.dockerCalls().join('\n');
      expect(calls).not.toContain('pg_restore');
      expect(calls).not.toContain('createdb');
      expect(calls).not.toContain('dropdb');
    });

    it('refuses a destructive target without the explicit flag, before downloading', async () => {
      const context = await harness();
      await withSnapshot(context);
      const result = await runScript(
        RESTORE_SCRIPT,
        ['--target-database', 'fluxradar_staging'],
        context,
      );
      expect(result.ok).toBe(false);
      expect(result.output).toContain('--i-know-this-destroys-data');
      expect(context.dockerCalls()).toEqual([]);
    });

    it('refuses the live database even with the flag, until it is named by hand', async () => {
      const context = await harness();
      await withSnapshot(context);
      const result = await runScript(
        RESTORE_SCRIPT,
        ['--target-database', 'fluxradar', '--i-know-this-destroys-data'],
        context,
      );
      expect(result.ok).toBe(false);
      expect(result.output).toContain('refusing to restore over the live database');
      expect(result.output).toContain('FLUXRADAR_RESTORE_ALLOW_PRODUCTION=overwrite-fluxradar');
      expect(context.dockerCalls()).toEqual([]);
    });

    it('still refuses the live database while an API container is running', async () => {
      const context = await harness();
      await withSnapshot(context);
      const result = await runScript(
        RESTORE_SCRIPT,
        ['--target-database', 'fluxradar', '--i-know-this-destroys-data'],
        context,
        {
          FLUXRADAR_RESTORE_ALLOW_PRODUCTION: 'overwrite-fluxradar',
          FAKE_PS_OUTPUT: 'fluxradar-api-abc123',
        },
      );
      expect(result.ok).toBe(false);
      expect(result.output).toContain('is still running');
      expect(context.dockerCalls().join('\n')).not.toContain('pg_restore');
    });

    it('refuses a target database name that is not a plain identifier', async () => {
      const context = await harness();
      const result = await runScript(
        RESTORE_SCRIPT,
        [
          '--target-database',
          'fluxradar"; DROP DATABASE fluxradar; --',
          '--i-know-this-destroys-data',
        ],
        context,
      );
      expect(result.ok).toBe(false);
      expect(result.output).toContain('must be lowercase letters');
      expect(context.dockerCalls()).toEqual([]);
    });

    it('fails when the restored database does not look like FluxRadar', async () => {
      const context = await harness();
      await withSnapshot(context);
      // Every count comes back as zero: no tables, no applied migrations.
      const result = await runScript(RESTORE_SCRIPT, ['--verify-latest'], context, {
        FAKE_PSQL_ROWS: '0',
      });
      expect(result.ok).toBe(false);
      expect(result.output).toMatch(/not a FluxRadar database|records no applied migration/);
      // The throwaway database is still cleaned up on the failure path.
      expect(context.dockerCalls().join('\n')).toContain('dropdb');
    });

    // A backup job that stopped two weeks ago leaves a snapshot that decrypts,
    // checksums and restores perfectly. Age is the only thing that catches it,
    // and --verify-latest is the scheduled run whose job is to notice.
    describe('freshness of the newest snapshot', () => {
      /** Uploads one snapshot stamped `hours` ago, straight through the CLI. */
      async function withSnapshotAged(context: Harness, hours: number): Promise<void> {
        const dump = join(context.appDir, 'aged.dump');
        writeFileSync(dump, DUMP_CONTENT);
        await execFileAsync(
          process.execPath,
          [
            join(BACKUP_DIR, 'backup-cli.cjs'),
            'upload',
            '--env-file',
            context.envFile,
            '--dump',
            dump,
            '--at',
            new Date(Date.now() - hours * 3_600_000).toISOString(),
          ],
          { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } },
        );
        rmSync(`${dump}.enc`, { force: true });
        rmSync(dump, { force: true });
      }

      it('verifies a snapshot from last night', async () => {
        const context = await harness();
        await withSnapshotAged(context, 2);
        const result = await runScript(RESTORE_SCRIPT, ['--verify-latest'], context, {
          FAKE_PSQL_ROWS: '42',
        });
        expect(result.output).toContain('restore verification succeeded');
        expect(result.ok).toBe(true);
      });

      it('fails on a stale one before it creates or touches any database', async () => {
        const context = await harness();
        await withSnapshotAged(context, 40);
        const result = await runScript(RESTORE_SCRIPT, ['--verify-latest'], context, {
          FAKE_PSQL_ROWS: '42',
        });
        expect(result.ok).toBe(false);
        expect(result.output).toContain('40.0h old');
        expect(result.output).toContain('limit 26h');
        const calls = context.dockerCalls().join('\n');
        expect(calls).not.toContain('createdb');
        expect(calls).not.toContain('pg_restore');
      });

      it('applies the operator\'s limit from the release env file', async () => {
        const context = await harness({ FLUXRADAR_BACKUP_MAX_AGE_HOURS: '72' });
        await withSnapshotAged(context, 40);
        const result = await runScript(RESTORE_SCRIPT, ['--verify-latest'], context, {
          FAKE_PSQL_ROWS: '42',
        });
        expect(result.output).toContain('restore verification succeeded');
        expect(result.ok).toBe(true);
      });

      it('never blocks a disaster recovery on the age of the only backup left', async () => {
        // The destructive path is an operator restoring on the worst day. The
        // freshness alarm must not be the thing that stops them.
        const context = await harness();
        await withSnapshotAged(context, 400);
        const result = await runScript(
          RESTORE_SCRIPT,
          ['--target-database', 'fluxradar_staging', '--i-know-this-destroys-data'],
          context,
          { FAKE_PSQL_ROWS: '42', FAKE_PSQL_EMPTY_UNTIL_RESTORE: '1' },
        );
        expect(result.output).toContain('restore verification succeeded');
        expect(result.ok).toBe(true);
        expect(context.dockerCalls().join('\n')).toContain('pg_restore');
      });
    });

    it('fails when there is no snapshot to restore', async () => {
      const context = await harness();
      const result = await runScript(RESTORE_SCRIPT, ['--verify-latest'], context);
      expect(result.ok).toBe(false);
      expect(result.output).toContain('no FluxRadar snapshot');
      expect(context.dockerCalls().join('\n')).not.toContain('pg_restore');
    });
  });

  describe('the schedule that runs them', () => {
    const cron = readFileSync(join(BACKUP_DIR, 'fluxradar-backup.cron'), 'utf8');

    it('takes a snapshot daily and proves a restore weekly', () => {
      expect(cron).toMatch(/^\d+ \d+ \* \* \* \S+ .*pg-backup\.sh/m);
      expect(cron).toMatch(/^\d+ \d+ \* \* 0 \S+ .*pg-restore\.sh --verify-latest/m);
    });

    it('never schedules a destructive restore', () => {
      expect(cron).not.toContain('--target-database');
      expect(cron).not.toContain('--i-know-this-destroys-data');
    });

    it('carries no secret', () => {
      expect(cron).not.toMatch(/FLUXRADAR_BACKUP_ENCRYPTION_KEY\s*=\s*\S/);
      expect(cron).not.toMatch(/HETZNER_S3_SECRET_KEY\s*=\s*\S/);
    });
  });
});
