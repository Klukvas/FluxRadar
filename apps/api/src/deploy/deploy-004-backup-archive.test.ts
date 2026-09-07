import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { API_PACKAGE_ROOT } from '../test-utils/template-db.ts';
import { startStubBucket, type StubBucket } from '../test-utils/stub-bucket.ts';

// DEPLOY-004: the backup archive itself.
//
// Everything downstream of `pg_dump` — encrypt, upload, verify, list, prune,
// download, decrypt — runs here against a stub bucket that is as strict as Ceph
// is. The point is that the failure modes of a backup are all silent: a dump
// uploaded with the wrong payload hash, an archive that decrypts to garbage, a
// retention sweep that deletes the history it was supposed to bound. None of
// them is visible until a restore, and a restore only happens on the worst day.
//
// The scripts under test are the ones that ship (deploy/backup/*.cjs), loaded
// through createRequire the way deploy-002 loads the env normalizer.

const REPO_ROOT = join(API_PACKAGE_ROOT, '..', '..');
const BACKUP_DIR = join(REPO_ROOT, 'deploy', 'backup');
const CLI_PATH = join(BACKUP_DIR, 'backup-cli.cjs');

const require_ = createRequire(import.meta.url);
const crypto = require_(join(BACKUP_DIR, 'archive-crypto.cjs')) as {
  KEY_ENV_VAR: string;
  parseKey: (value: string | undefined) => Buffer;
  encryptFile: (source: string, target: string, key: Buffer) => Promise<{ bytes: number }>;
  decryptFile: (source: string, target: string, key: Buffer) => Promise<{ bytes: number }>;
  digestFile: (path: string) => Promise<{ sha256: string; md5: string; bytes: number }>;
};
const retention = require_(join(BACKUP_DIR, 'retention-policy.cjs')) as {
  ARCHIVE_SUFFIX: string;
  METADATA_SUFFIX: string;
  planRetention: (
    objects: readonly { key: string; bytes?: number }[],
    options: { now: Date; policy?: Record<string, number> },
  ) => {
    snapshots: readonly { key: string }[];
    keep: readonly string[];
    delete: readonly string[];
    refusedReason: string | null;
    warnings: readonly string[];
  };
  snapshotKey: (prefix: string, date: Date) => { archive: string; metadata: string };
  snapshotTimestamp: (key: string) => Date | null;
  assessSnapshotFreshness: (
    snapshot: {
      key: string;
      keyTakenAt?: Date | null;
      metadataTakenAt?: string | null;
    } | null,
    options: { now: Date; maxAgeHours: number },
  ) => {
    ok: boolean;
    reason: string | null;
    ageHours: number | null;
    takenAt: Date | null;
    warnings: readonly string[];
  };
};
const s3 = require_(join(BACKUP_DIR, 's3-client.cjs')) as {
  S3Client: new (options: Record<string, unknown>) => {
    putText: (key: string, body: string, contentType: string) => Promise<{ etag: string }>;
    getText: (key: string) => Promise<string>;
    headObject: (key: string) => Promise<{ bytes: number; etag: string } | null>;
    deleteObject: (key: string) => Promise<void>;
    listObjects: (prefix: string) => Promise<{ key: string; bytes: number }[]>;
  };
};

const KEY = randomBytes(32).toString('base64');
const PREFIX = 'fluxradar/postgres';
/** Taken from the shipped module so a renamed suffix breaks here too. */
const { ARCHIVE_SUFFIX, METADATA_SUFFIX } = retention;

const workspaces: string[] = [];
const buckets: StubBucket[] = [];

afterEach(async () => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
  for (const bucket of buckets.splice(0)) await bucket.close();
});

function workspace(): string {
  const path = mkdtempSync(join(tmpdir(), 'fluxradar-backup-'));
  workspaces.push(path);
  return path;
}

async function bucket(): Promise<StubBucket> {
  const stub = await startStubBucket();
  buckets.push(stub);
  return stub;
}

/** The release env file the scripts are pointed at, written per test. */
function envFile(stub: StubBucket, overrides: Record<string, string> = {}): string {
  const path = join(workspace(), 'production.env');
  const values: Record<string, string> = {
    POSTGRES_DB: 'fluxradar',
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
    path,
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`,
  );
  return path;
}

const execFileAsync = promisify(execFile);

/**
 * Runs the CLI the way the shell scripts do: a separate process with a clean
 * environment. Nothing is inherited, so a developer's own HETZNER_S3_* values
 * can never reach a test — and the run is a real end-to-end exercise of the
 * `--env-file` path the cron job depends on.
 *
 * ASYNCHRONOUS ON PURPOSE. The stub bucket is an HTTP server in THIS process, so
 * a synchronous `execFileSync` would block the event loop that has to answer the
 * child's requests, and the two would wait for each other until the suite timed
 * out.
 */
async function runCli(
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_PATH, ...args], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', ...env },
      maxBuffer: 16 * 1024 * 1024,
    });
    // stderr too: the warnings that say what a command did NOT verify are the
    // point of several of these assertions, and a command can succeed and warn.
    return { ok: true, output: `${stdout}${stderr}` };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

/** Narrows a lookup that the surrounding assertions have already established. */
function present<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`expected ${what} to exist`);
  return value;
}

function writeDump(directory: string, bytes = 64_000): string {
  const path = join(directory, 'fluxradar-20260906T021700Z.dump');
  // Not compressible to zero and not all the same byte: a truncation or an
  // encoding slip in the transport shows up as a checksum mismatch.
  writeFileSync(path, randomBytes(bytes));
  return path;
}

describe('DEPLOY-004 backup archive', () => {
  describe('encryption', () => {
    it('round-trips a dump byte for byte', async () => {
      const directory = workspace();
      const source = writeDump(directory);
      const key = crypto.parseKey(KEY);
      await crypto.encryptFile(source, join(directory, 'archive.enc'), key);
      await crypto.decryptFile(join(directory, 'archive.enc'), join(directory, 'out.dump'), key);
      expect(readFileSync(join(directory, 'out.dump')).equals(readFileSync(source))).toBe(true);
    });

    it('does not leave the plaintext recognisable in the archive', async () => {
      const directory = workspace();
      const source = join(directory, 'plain.dump');
      writeFileSync(source, 'PGDMP fluxradar customer records '.repeat(200));
      await crypto.encryptFile(source, join(directory, 'archive.enc'), crypto.parseKey(KEY));
      const archive = readFileSync(join(directory, 'archive.enc')).toString('latin1');
      expect(archive).not.toContain('PGDMP');
      expect(archive).not.toContain('customer records');
    });

    it('refuses a key that is not 32 bytes, naming the variable and not the value', () => {
      const shortKey = randomBytes(16).toString('base64');
      expect(() => crypto.parseKey(shortKey)).toThrow(/FLUXRADAR_BACKUP_ENCRYPTION_KEY/);
      expect(() => crypto.parseKey(shortKey)).not.toThrow(new RegExp(shortKey));
      expect(() => crypto.parseKey(undefined)).toThrow(/refusing to write an unencrypted backup/);
    });

    it('fails on the wrong key instead of producing a plausible dump', async () => {
      const directory = workspace();
      const source = writeDump(directory);
      await crypto.encryptFile(source, join(directory, 'archive.enc'), crypto.parseKey(KEY));
      await expect(
        crypto.decryptFile(
          join(directory, 'archive.enc'),
          join(directory, 'out.dump'),
          crypto.parseKey(randomBytes(32).toString('base64')),
        ),
      ).rejects.toThrow();
    });

    it('fails on a single flipped byte', async () => {
      const directory = workspace();
      const source = writeDump(directory);
      const archivePath = join(directory, 'archive.enc');
      await crypto.encryptFile(source, archivePath, crypto.parseKey(KEY));
      const archive = readFileSync(archivePath);
      const middle = Math.floor(archive.length / 2);
      archive.writeUInt8(archive.readUInt8(middle) ^ 0x01, middle);
      writeFileSync(archivePath, archive);
      await expect(
        crypto.decryptFile(archivePath, join(directory, 'out.dump'), crypto.parseKey(KEY)),
      ).rejects.toThrow();
    });

    it('rejects a truncated archive and a foreign file by shape', async () => {
      const directory = workspace();
      const source = writeDump(directory, 4_000);
      const archivePath = join(directory, 'archive.enc');
      await crypto.encryptFile(source, archivePath, crypto.parseKey(KEY));
      const truncated = join(directory, 'truncated.enc');
      writeFileSync(truncated, readFileSync(archivePath).subarray(0, 40));
      await expect(
        crypto.decryptFile(truncated, join(directory, 'out.dump'), crypto.parseKey(KEY)),
      ).rejects.toThrow();

      const foreign = join(directory, 'foreign.enc');
      writeFileSync(foreign, randomBytes(2_000));
      await expect(
        crypto.decryptFile(foreign, join(directory, 'out2.dump'), crypto.parseKey(KEY)),
      ).rejects.toThrow(/not a FluxRadar encrypted archive/);
    });
  });

  describe('object storage client', () => {
    it('stores, reads back, lists across pages and deletes', async () => {
      const stub = await bucket();
      const client = new s3.S3Client({
        endpoint: stub.url,
        region: 'nbg1',
        bucket: stub.bucket,
        accessKey: 'access-key-id',
        secretKey: 'secret-access-key',
      });
      stub.maxKeys = 2;
      for (let index = 0; index < 5; index += 1) {
        await client.putText(
          `${PREFIX}/object-${index}.json`,
          `{"index":${index}}`,
          'application/json',
        );
      }
      expect(await client.getText(`${PREFIX}/object-3.json`)).toBe('{"index":3}');
      const head = await client.headObject(`${PREFIX}/object-3.json`);
      expect(head?.bytes).toBe(11);
      // Five objects over a two-key page size: a client that ignored the
      // continuation token would silently see only the first page — and a
      // retention sweep reading a partial listing deletes from a partial truth.
      const listed = await client.listObjects(`${PREFIX}/`);
      expect(listed.map((object) => object.key).sort()).toHaveLength(5);
      await client.deleteObject(`${PREFIX}/object-3.json`);
      expect(await client.headObject(`${PREFIX}/object-3.json`)).toBeNull();
    });

    it('reports the provider error code instead of a bare failure', async () => {
      const stub = await bucket();
      const client = new s3.S3Client({
        endpoint: stub.url,
        region: 'nbg1',
        bucket: 'a-bucket-that-does-not-exist',
        accessKey: 'access-key-id',
        secretKey: 'secret-access-key',
      });
      await expect(client.getText('anything')).rejects.toThrow(/NoSuchBucket/);
    });

    it('refuses a non-loopback endpoint that is not https', () => {
      expect(
        () =>
          new s3.S3Client({
            endpoint: 'http://nbg1.your-objectstorage.com',
            region: 'nbg1',
            bucket: 'b',
            accessKey: 'a',
            secretKey: 's',
          }),
      ).toThrow(/must be an https:\/\/ URL/);
    });
  });

  describe('retention policy', () => {
    const now = new Date('2026-09-06T12:00:00Z');
    const at = (daysAgo: number): { key: string } => ({
      key: retention.snapshotKey(PREFIX, new Date(now.getTime() - daysAgo * 86_400_000)).archive,
    });

    it('deletes what is past the window and keeps the sidecar with its archive', () => {
      const objects = [0, 1, 40].flatMap((days) => {
        const keys = retention.snapshotKey(PREFIX, new Date(now.getTime() - days * 86_400_000));
        return [{ key: keys.archive }, { key: keys.metadata }];
      });
      const plan = retention.planRetention(objects, { now, policy: { minKeep: 2 } });
      expect(plan.refusedReason).toBeNull();
      const expired = retention.snapshotKey(PREFIX, new Date(now.getTime() - 40 * 86_400_000));
      expect([...plan.delete].sort()).toEqual([expired.archive, expired.metadata].sort());
    });

    it('keeps the newest snapshots even when every one of them is expired', () => {
      const objects = [200, 210, 220, 230].map(at);
      const plan = retention.planRetention(objects, {
        now,
        policy: { minKeep: 7, staleHours: 24 * 365 },
      });
      expect(plan.delete).toEqual([]);
      expect(plan.keep).toHaveLength(4);
    });

    it('refuses to prune at all when the newest snapshot is stale', () => {
      // A snapshot from 2.4 hours ago is well inside the 6-hour staleness limit,
      // so this sweep is allowed to run.
      const plan = retention.planRetention([at(0.1), at(3), at(90)], {
        now,
        policy: { staleHours: 6, minKeep: 1 },
      });
      expect(plan.refusedReason).toBeNull();

      const stale = retention.planRetention([at(3), at(90), at(120)], {
        now,
        policy: { staleHours: 48, minKeep: 1 },
      });
      expect(stale.refusedReason).toMatch(/backups are failing/);
      expect(stale.delete).toEqual([]);
    });

    it('bounds one sweep and says what it left behind', () => {
      const objects = Array.from({ length: 30 }, (_unused, index) => at(index * 5));
      const plan = retention.planRetention(objects, {
        now,
        policy: { minKeep: 1, retentionDays: 10, maxDeletePerRun: 3 },
      });
      expect(plan.delete).toHaveLength(3);
      expect(plan.warnings.join(' ')).toMatch(/left for the next run/);
    });

    it('never selects a key it did not write', () => {
      const plan = retention.planRetention(
        [
          at(0),
          { key: `${PREFIX}/2020/01/hand-uploaded-dump.sql` },
          { key: 'unrelated/tenant-export.tar.gz' },
          { key: `${PREFIX}/2020/01/fluxradar-not-a-date.dump.enc` },
        ],
        { now, policy: { minKeep: 1, retentionDays: 1 } },
      );
      expect(plan.delete).toEqual([]);
      expect(plan.snapshots).toHaveLength(1);
    });

    it('rejects a policy that would allow an empty bucket', () => {
      expect(() => retention.planRetention([at(0)], { now, policy: { minKeep: 0 } })).toThrow(
        /minKeep/,
      );
    });
  });

  // The check that turns "the bucket has a snapshot" into "the bucket has a
  // snapshot worth restoring". Everything else about a backup that stopped
  // running a fortnight ago still passes: the newest object decrypts, matches its
  // checksum and restores. Only its age says the backups are broken.
  describe('snapshot freshness', () => {
    const now = new Date('2026-09-07T04:20:00Z');
    const keyFor = (hoursAgo: number): string =>
      retention.snapshotKey(PREFIX, new Date(now.getTime() - hoursAgo * 3_600_000)).archive;
    const assess = (
      hoursAgo: number,
      options: { maxAgeHours?: number; metadataTakenAt?: string | null } = {},
    ) =>
      retention.assessSnapshotFreshness(
        {
          key: keyFor(hoursAgo),
          keyTakenAt: retention.snapshotTimestamp(keyFor(hoursAgo)),
          metadataTakenAt: options.metadataTakenAt ?? null,
        },
        { now, maxAgeHours: options.maxAgeHours ?? 26 },
      );

    it("accepts last night's snapshot and reports how old it is", () => {
      const fresh = assess(2);
      expect(fresh.ok).toBe(true);
      expect(fresh.reason).toBeNull();
      expect(fresh.ageHours).toBeCloseTo(2, 6);
      expect(fresh.warnings).toEqual([]);
    });

    it('refuses one that is past the limit, naming the age and the limit', () => {
      const stale = assess(50);
      expect(stale.ok).toBe(false);
      expect(stale.reason).toContain('50.0h old');
      expect(stale.reason).toContain('limit 26h');
    });

    it('accepts the same snapshot under a limit that allows it', () => {
      expect(assess(50, { maxAgeHours: 72 }).ok).toBe(true);
      // ...and refuses a fresh one under a limit that does not.
      expect(assess(2, { maxAgeHours: 1 }).ok).toBe(false);
    });

    it('refuses an empty prefix instead of reporting an unknown age', () => {
      const missing = retention.assessSnapshotFreshness(null, { now, maxAgeHours: 26 });
      expect(missing.ok).toBe(false);
      expect(missing.reason).toContain('no FluxRadar snapshot');
      expect(missing.ageHours).toBeNull();
    });

    it('takes the older of the key and the sidecar', () => {
      // A backup job that re-uploads an old dump under a fresh key is the exact
      // failure this check exists for; the key alone would call it brand new.
      const restamped = assess(2, {
        metadataTakenAt: new Date(now.getTime() - 60 * 3_600_000).toISOString(),
      });
      expect(restamped.ok).toBe(false);
      expect(restamped.reason).toContain('60.0h old');
      expect(restamped.warnings.join(' ')).toContain('the older of the two is used');
    });

    it('falls back to the key when the sidecar states an unusable takenAt', () => {
      const broken = assess(2, { metadataTakenAt: 'the day before yesterday' });
      expect(broken.ok).toBe(true);
      expect(broken.warnings.join(' ')).toContain('unusable takenAt');
    });

    it('refuses a snapshot with no usable timestamp at all', () => {
      const unreadable = retention.assessSnapshotFreshness(
        { key: `${PREFIX}/2026/09/fluxradar-handmade.dump.enc`, keyTakenAt: null },
        { now, maxAgeHours: 26 },
      );
      expect(unreadable.ok).toBe(false);
      expect(unreadable.reason).toContain('cannot tell how old');
    });

    it('refuses a snapshot timestamped in the future rather than calling it fresh', () => {
      const ahead = assess(-5);
      expect(ahead.ok).toBe(false);
      expect(ahead.reason).toContain('in the future');
    });

    it('refuses to run at all on a limit that is not a positive number of hours', () => {
      for (const maxAgeHours of [0, -1, Number.NaN]) {
        expect(() => assess(2, { maxAgeHours })).toThrow(/FLUXRADAR_BACKUP_MAX_AGE_HOURS/);
      }
    });
  });

  describe('command line against a bucket', () => {
    it('uploads an archive that decrypts back to the exact dump, with a checksum sidecar', async () => {
      const stub = await bucket();
      const directory = workspace();
      const dump = writeDump(directory);
      const expected = readFileSync(dump);

      const upload = await runCli(['upload', '--env-file', envFile(stub), '--dump', dump]);
      expect(upload.output).toContain('verified');
      expect(upload.ok).toBe(true);

      const archiveKey = present(
        [...stub.objects.keys()].find((key) => key.endsWith('.dump.enc')),
        'an uploaded archive',
      );
      const metadata = JSON.parse(
        present(
          stub.objects.get(archiveKey.replace('.dump.enc', '.meta.json')),
          'the metadata sidecar',
        ).body.toString('utf8'),
      ) as Record<string, unknown>;
      expect(metadata.plainBytes).toBe(expected.length);
      expect(metadata.encryption).toBe('aes-256-gcm');
      // The sidecar is readable without the key on purpose; it must therefore
      // carry nothing that a bucket reader should not have.
      expect(JSON.stringify(metadata)).not.toContain(KEY);
      expect(JSON.stringify(metadata)).not.toContain('secret-access-key');

      const download = await runCli([
        'download',
        '--env-file',
        envFile(stub),
        '--key',
        archiveKey,
        '--out',
        join(directory, 'restored.dump'),
      ]);
      expect(download.output).toContain('checksum verified');
      expect(download.ok).toBe(true);
      expect(readFileSync(join(directory, 'restored.dump')).equals(expected)).toBe(true);
    });

    it('signs every request and never writes an unencrypted body', async () => {
      const stub = await bucket();
      const directory = workspace();
      const dump = writeDump(directory);
      writeFileSync(dump, Buffer.from('PGDMP unmistakable plaintext marker'.repeat(100)));
      await runCli(['upload', '--env-file', envFile(stub), '--dump', dump]);

      expect(stub.requests.length).toBeGreaterThan(0);
      expect(stub.requests.every((request) => request.signed)).toBe(true);
      const archiveKey = present(
        [...stub.objects.keys()].find((key) => key.endsWith('.dump.enc')),
        'an uploaded archive',
      );
      expect(
        present(stub.objects.get(archiveKey), archiveKey).body.toString('latin1'),
      ).not.toContain('PGDMP');
    });

    it('writes nothing to the bucket on a dry run', async () => {
      const stub = await bucket();
      const directory = workspace();
      const result = await runCli([
        'upload',
        '--env-file',
        envFile(stub),
        '--dump',
        writeDump(directory),
        '--dry-run',
      ]);
      expect(result.ok).toBe(true);
      expect(result.output).toContain('DRY RUN');
      expect(stub.objects.size).toBe(0);
    });

    it('fails the restore when the stored archive was tampered with', async () => {
      const stub = await bucket();
      const directory = workspace();
      await runCli(['upload', '--env-file', envFile(stub), '--dump', writeDump(directory)]);
      const archiveKey = present(
        [...stub.objects.keys()].find((key) => key.endsWith('.dump.enc')),
        'an uploaded archive',
      );
      const stored = present(stub.objects.get(archiveKey), archiveKey);
      const tampered = Buffer.from(stored.body);
      const target = tampered.length - 40;
      tampered.writeUInt8(tampered.readUInt8(target) ^ 0xff, target);
      stub.objects.set(archiveKey, { body: tampered, contentType: stored.contentType });

      const download = await runCli([
        'download',
        '--env-file',
        envFile(stub),
        '--key',
        archiveKey,
        '--out',
        join(directory, 'restored.dump'),
      ]);
      expect(download.ok).toBe(false);
      expect(download.output).toMatch(/backup:/);
    });

    it('refuses to restore an object that is not a FluxRadar archive', async () => {
      const stub = await bucket();
      const directory = workspace();
      const result = await runCli([
        'download',
        '--env-file',
        envFile(stub),
        '--key',
        `${PREFIX}/2026/09/someone-elses-backup.tar.gz`,
        '--out',
        join(directory, 'restored.dump'),
      ]);
      expect(result.ok).toBe(false);
      expect(result.output).toContain('not a .dump.enc archive');
    });

    it('names the missing variables instead of half-running', async () => {
      const stub = await bucket();
      const directory = workspace();
      const broken = envFile(stub, { HETZNER_S3_BUCKET: '', HETZNER_S3_REGION: '' });
      const result = await runCli(['upload', '--env-file', broken, '--dump', writeDump(directory)]);
      expect(result.ok).toBe(false);
      expect(result.output).toContain('HETZNER_S3_REGION');
      expect(result.output).toContain('HETZNER_S3_BUCKET');
      expect(stub.objects.size).toBe(0);
    });

    it('lets the env file win over an inherited variable', async () => {
      const stub = await bucket();
      const directory = workspace();
      const dump = writeDump(directory);
      // A stale `export` in an operator's shell must not redirect a backup.
      const result = await runCli(['upload', '--env-file', envFile(stub), '--dump', dump], {
        HETZNER_S3_BUCKET: 'somebody-elses-bucket',
        FLUXRADAR_BACKUP_PREFIX: 'somebody-elses-prefix',
      });
      expect(result.ok).toBe(true);
      expect(result.output).toContain(`${PREFIX}/`);
      expect([...stub.objects.keys()].every((key) => key.startsWith(`${PREFIX}/`))).toBe(true);
    });

    describe('the freshness gate on the newest snapshot', () => {
      const hoursAgo = (hours: number): string =>
        new Date(Date.now() - hours * 3_600_000).toISOString();

      async function uploadAged(stub: StubBucket, hours: number, env = {}): Promise<string> {
        const directory = workspace();
        const upload = await runCli([
          'upload',
          '--env-file',
          envFile(stub, env),
          '--dump',
          writeDump(directory),
          '--at',
          hoursAgo(hours),
        ]);
        expect(upload.ok).toBe(true);
        return present(
          [...stub.objects.keys()].find((key) => key.endsWith('.dump.enc')),
          'an uploaded archive',
        );
      }

      it('downloads the newest snapshot and states its age', async () => {
        const stub = await bucket();
        await uploadAged(stub, 2);
        const out = join(workspace(), 'restored.dump');
        const download = await runCli(['download', '--env-file', envFile(stub), '--out', out]);
        expect(download.output).toMatch(/is 2\.0h old \(limit 26h\)/);
        expect(download.ok).toBe(true);
        expect(statSync(out).size).toBeGreaterThan(0);
      });

      it('fails on a stale newest snapshot without downloading it', async () => {
        const stub = await bucket();
        await uploadAged(stub, 40);
        const out = join(workspace(), 'restored.dump');
        const download = await runCli(['download', '--env-file', envFile(stub), '--out', out]);
        expect(download.ok).toBe(false);
        expect(download.output).toContain('40.0h old');
        expect(download.output).toContain('limit 26h');
        // The archive is the expensive part and it is never fetched: the gate
        // runs on the key and the sidecar, before any download.
        expect(() => statSync(out)).toThrow();
      });

      it('honours the configured limit in both directions', async () => {
        const stub = await bucket();
        await uploadAged(stub, 40, { FLUXRADAR_BACKUP_MAX_AGE_HOURS: '72' });
        const generous = await runCli([
          'download',
          '--env-file',
          envFile(stub, { FLUXRADAR_BACKUP_MAX_AGE_HOURS: '72' }),
          '--out',
          join(workspace(), 'restored.dump'),
        ]);
        expect(generous.ok).toBe(true);

        const strict = await runCli([
          'download',
          '--env-file',
          envFile(stub, { FLUXRADAR_BACKUP_MAX_AGE_HOURS: '1' }),
          '--out',
          join(workspace(), 'restored.dump'),
        ]);
        expect(strict.ok).toBe(false);
        expect(strict.output).toContain('limit 1h');
      });

      it('rejects a limit that is not a positive number instead of ignoring it', async () => {
        const stub = await bucket();
        await uploadAged(stub, 2);
        const negative = await runCli([
          'download',
          '--env-file',
          envFile(stub, { FLUXRADAR_BACKUP_MAX_AGE_HOURS: '-4' }),
          '--out',
          join(workspace(), 'restored.dump'),
        ]);
        expect(negative.ok).toBe(false);
        expect(negative.output).toContain('FLUXRADAR_BACKUP_MAX_AGE_HOURS must be a non-negative');

        const zero = await runCli([
          'download',
          '--env-file',
          envFile(stub, { FLUXRADAR_BACKUP_MAX_AGE_HOURS: '0' }),
          '--out',
          join(workspace(), 'restored.dump'),
        ]);
        expect(zero.ok).toBe(false);
        expect(zero.output).toContain('positive number of hours');
      });

      it('never age-gates a snapshot the caller named, or one it was told to allow', async () => {
        const stub = await bucket();
        const key = await uploadAged(stub, 40);
        // A disaster recovery restores the only backup that exists, however old.
        const named = await runCli([
          'download',
          '--env-file',
          envFile(stub),
          '--key',
          key,
          '--out',
          join(workspace(), 'restored.dump'),
        ]);
        expect(named.ok).toBe(true);
        const allowed = await runCli([
          'download',
          '--env-file',
          envFile(stub),
          '--allow-stale',
          '--out',
          join(workspace(), 'restored.dump'),
        ]);
        expect(allowed.ok).toBe(true);
      });

      it('still reports a missing snapshot rather than an unknown age', async () => {
        const stub = await bucket();
        const download = await runCli([
          'download',
          '--env-file',
          envFile(stub),
          '--out',
          join(workspace(), 'restored.dump'),
        ]);
        expect(download.ok).toBe(false);
        expect(download.output).toContain('no FluxRadar snapshot exists under this prefix');
      });
    });

    // The sidecar is what BOTH gates read: the timestamp the freshness check
    // uses and the checksum a restore is verified against. Its reader used to be
    // one blanket `try { ... } catch { return null }`, so "the credentials
    // cannot read this object", "the endpoint is having a bad day" and "this
    // object is corrupt" all became the same answer as "this snapshot predates
    // sidecars" — one warning line, no checksum, and an age taken from a key
    // that anybody can name.
    describe('the metadata sidecar', () => {
      async function uploadSnapshot(stub: StubBucket): Promise<{ archive: string; meta: string }> {
        const upload = await runCli([
          'upload',
          '--env-file',
          envFile(stub),
          '--dump',
          writeDump(workspace(), 4_000),
        ]);
        expect(upload.ok).toBe(true);
        const archive = present(
          [...stub.objects.keys()].find((key) => key.endsWith(ARCHIVE_SUFFIX)),
          'an uploaded archive',
        );
        return { archive, meta: archive.replace(ARCHIVE_SUFFIX, METADATA_SUFFIX) };
      }

      for (const status of [403, 500]) {
        it(`refuses a snapshot whose sidecar the bucket answers ${status} for`, async () => {
          const stub = await bucket();
          const { meta } = await uploadSnapshot(stub);
          stub.failures.set(meta, status);
          const out = join(workspace(), 'restored.dump');
          const download = await runCli(['download', '--env-file', envFile(stub), '--out', out]);
          expect(download.ok).toBe(false);
          expect(download.output).toContain(meta);
          expect(download.output).toContain(String(status));
          // Not downgraded to a warning, and the archive is never fetched.
          expect(download.output).not.toContain('no readable metadata sidecar');
          expect(() => statSync(out)).toThrow();
        });
      }

      it('refuses an unreadable sidecar even for a snapshot the caller named', async () => {
        // A disaster recovery is exempt from the AGE gate, not from "the bucket
        // is not answering for this object".
        const stub = await bucket();
        const { archive, meta } = await uploadSnapshot(stub);
        stub.failures.set(meta, 403);
        const download = await runCli([
          'download',
          '--env-file',
          envFile(stub),
          '--key',
          archive,
          '--out',
          join(workspace(), 'restored.dump'),
        ]);
        expect(download.ok).toBe(false);
        expect(download.output).toContain(meta);
      });

      it('refuses a sidecar that exists but is not readable JSON', async () => {
        const stub = await bucket();
        const { meta } = await uploadSnapshot(stub);
        stub.objects.set(meta, {
          body: Buffer.from('{ this is not json', 'utf8'),
          contentType: 'application/json',
        });
        const download = await runCli([
          'download',
          '--env-file',
          envFile(stub),
          '--out',
          join(workspace(), 'restored.dump'),
        ]);
        expect(download.ok).toBe(false);
        expect(download.output).toContain('not readable JSON');
      });

      // A sidecar that parses but carries no plainSha256 verifies NOTHING, and
      // the download said "checksum verified" anyway — the one line an operator
      // reads to decide whether to trust a dump on the worst day of the year.
      it('does not claim a checksum was verified when the sidecar records none', async () => {
        const stub = await bucket();
        const { meta } = await uploadSnapshot(stub);
        const sidecar = JSON.parse(
          present(stub.objects.get(meta), 'the metadata sidecar').body.toString('utf8'),
        ) as Record<string, unknown>;
        delete sidecar.plainSha256;
        stub.objects.set(meta, {
          body: Buffer.from(JSON.stringify(sidecar), 'utf8'),
          contentType: 'application/json',
        });

        const out = join(workspace(), 'restored.dump');
        const download = await runCli(['download', '--env-file', envFile(stub), '--out', out]);
        // It still restores — the dump itself is fine — but it says what it did
        // not check, and it never says the opposite.
        expect(download.ok).toBe(true);
        expect(download.output).not.toContain('checksum verified');
        expect(download.output).toContain('could not be checksum-verified');
        expect(download.output).toContain('checksum NOT verified');
        expect(statSync(out).size).toBeGreaterThan(0);
      });

      it('still fails a sidecar whose checksum does not match the restored dump', async () => {
        // The guard above must not have turned a mismatch into a warning.
        const stub = await bucket();
        const { meta } = await uploadSnapshot(stub);
        const sidecar = JSON.parse(
          present(stub.objects.get(meta), 'the metadata sidecar').body.toString('utf8'),
        ) as Record<string, unknown>;
        stub.objects.set(meta, {
          body: Buffer.from(JSON.stringify({ ...sidecar, plainSha256: 'f'.repeat(64) }), 'utf8'),
          contentType: 'application/json',
        });

        const download = await runCli([
          'download',
          '--env-file',
          envFile(stub),
          '--out',
          join(workspace(), 'restored.dump'),
        ]);
        expect(download.ok).toBe(false);
        expect(download.output).toContain('does not match the checksum recorded at backup time');
      });

      // The one absence that IS expected: a snapshot from before sidecars
      // existed. It still restores, with the checksum verification named as
      // missing rather than silently skipped.
      it('still restores a snapshot that genuinely has no sidecar', async () => {
        const stub = await bucket();
        const { meta } = await uploadSnapshot(stub);
        stub.objects.delete(meta);
        const out = join(workspace(), 'restored.dump');
        const download = await runCli(['download', '--env-file', envFile(stub), '--out', out]);
        expect(download.ok).toBe(true);
        expect(download.output).toContain('no readable metadata sidecar');
        expect(statSync(out).size).toBeGreaterThan(0);
      });
    });

    // A freshness limit of 0 is a limit no snapshot can satisfy. It used to be
    // accepted by the configuration reader and rejected much later, by the gate
    // — so `list`, `latest-key` and `prune` ran happily on a configuration that
    // could never verify a backup, and the error an operator finally saw came
    // out of a nightly restore naming a "limit", not the variable that set it.
    it('rejects a freshness limit of 0 when the configuration is read, not when it is used', async () => {
      const stub = await bucket();
      const broken = envFile(stub, { FLUXRADAR_BACKUP_MAX_AGE_HOURS: '0' });
      for (const command of [['list'], ['latest-key'], ['prune', '--dry-run']]) {
        const result = await runCli([...command, '--env-file', broken]);
        expect(result.ok, `${command[0]} accepted a freshness limit of 0`).toBe(false);
        expect(result.output).toContain('FLUXRADAR_BACKUP_MAX_AGE_HOURS');
        expect(result.output).toContain('positive number of hours');
      }
    });

    it('prunes what the policy expired and nothing else', async () => {
      const stub = await bucket();
      const directory = workspace();
      const environment = envFile(stub, {
        FLUXRADAR_BACKUP_RETENTION_DAYS: '2',
        FLUXRADAR_BACKUP_MIN_KEEP: '1',
      });
      const now = Date.now();
      for (const daysAgo of [0, 1, 30]) {
        const dump = writeDump(directory, 2_048);
        await runCli([
          'upload',
          '--env-file',
          environment,
          '--dump',
          dump,
          '--at',
          new Date(now - daysAgo * 86_400_000).toISOString(),
        ]);
      }
      stub.objects.set(`${PREFIX}/2026/01/operator-notes.txt`, {
        body: Buffer.from('do not delete'),
        contentType: 'text/plain',
      });
      expect(stub.objects.size).toBe(7);

      const dryRun = await runCli(['prune', '--env-file', environment, '--dry-run']);
      expect(dryRun.output).toContain('DRY RUN: would delete');
      expect(stub.objects.size).toBe(7);

      const prune = await runCli(['prune', '--env-file', environment]);
      expect(prune.ok).toBe(true);
      const remaining = [...stub.objects.keys()];
      expect(remaining).toContain(`${PREFIX}/2026/01/operator-notes.txt`);
      expect(remaining.filter((key) => key.endsWith('.dump.enc'))).toHaveLength(2);
    });

    it('lists snapshots newest first and reports the newest key', async () => {
      const stub = await bucket();
      const directory = workspace();
      const environment = envFile(stub);
      const now = Date.now();
      for (const daysAgo of [5, 0, 2]) {
        await runCli([
          'upload',
          '--env-file',
          environment,
          '--dump',
          writeDump(directory, 1_024),
          '--at',
          new Date(now - daysAgo * 86_400_000).toISOString(),
        ]);
      }
      const listed = await runCli(['list', '--env-file', environment]);
      const stamps = listed.output
        .trim()
        .split('\n')
        .map((line) => line.split('\t')[0]);
      expect([...stamps].sort().reverse()).toEqual(stamps);
      const latest = await runCli(['latest-key', '--env-file', environment]);
      expect(latest.output.trim()).toBe(listed.output.trim().split('\n')[0]?.split('\t')[2]);
    });
  });

  it('keeps the archive small enough to be worth checksumming twice', async () => {
    // Guards the one property the streaming implementation exists for: the
    // encrypted archive is the dump plus a fixed header and tag, not a copy of
    // it in memory or a base64 expansion.
    const directory = workspace();
    const source = writeDump(directory, 512_000);
    await crypto.encryptFile(source, join(directory, 'archive.enc'), crypto.parseKey(KEY));
    expect(statSync(join(directory, 'archive.enc')).size).toBe(512_000 + 6 + 1 + 12 + 16);
  });
});
