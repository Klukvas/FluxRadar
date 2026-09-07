// The backup command line: encrypt + upload, download + decrypt, list, prune.
//
// Everything that talks to Hetzner Object Storage lives here so the shell
// scripts around it only have to do what shell is good at: run `pg_dump` and
// `pg_restore` inside the PostgreSQL container. This file never runs a
// destructive database statement and never deletes a local file it did not
// create.
//
// Secret handling: the encryption key and the S3 credentials are read from the
// environment (optionally loaded from the release env file with --env-file) and
// are never printed, never passed as command arguments — which would expose them
// in `ps` — and never written to the metadata sidecar.

const { existsSync, mkdirSync, readFileSync, rmSync, statSync } = require('node:fs');
const { dirname } = require('node:path');

const {
  KEY_ENV_VAR,
  decryptFile,
  digestFile,
  encryptFile,
  readKeyFromEnv,
} = require('./archive-crypto.cjs');
const { S3Client } = require('./s3-client.cjs');
const {
  ARCHIVE_SUFFIX,
  DEFAULT_POLICY,
  METADATA_SUFFIX,
  assessSnapshotFreshness,
  planRetention,
  snapshotKey,
  snapshotTimestamp,
} = require('./retention-policy.cjs');

const DEFAULT_PREFIX = 'fluxradar/postgres';
const S3_ENV_VARS = [
  'HETZNER_S3_ENDPOINT',
  'HETZNER_S3_REGION',
  'HETZNER_S3_BUCKET',
  'HETZNER_S3_ACCESS_KEY',
  'HETZNER_S3_SECRET_KEY',
];

function parseArgs(argv) {
  const options = new Map();
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const name = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      options.set(name, 'true');
      continue;
    }
    options.set(name, next);
    index += 1;
  }
  return { options, positional };
}

/**
 * Reads a KEY=value file with `docker run --env-file` semantics — which is what
 * deploy/normalize-env-file.cjs guarantees the release env file is written in.
 * Values are taken verbatim: no quote stripping, no interpolation.
 *
 * The FILE WINS over an inherited environment variable of the same name. That is
 * the opposite of the usual precedence and it is deliberate: this tool is
 * pointed at the release's authoritative env file, and a stale `export
 * HETZNER_S3_BUCKET` left in a shell must not be able to redirect a backup — or
 * a restore — to a different bucket than the one the deployment uses.
 */
function loadEnvFile(path, env) {
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line === '' || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    env[key] = line.slice(separator + 1);
  }
}

/** Fails by NAME on anything missing; no value of any variable is printed. */
function readConfig(env) {
  const missing = S3_ENV_VARS.filter((name) => (env[name] ?? '').trim() === '');
  if (missing.length > 0) {
    throw new Error(`object storage is not configured for backups; missing: ${missing.join(', ')}`);
  }
  const numeric = (name, fallback) => {
    const raw = (env[name] ?? '').trim();
    if (raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${name} must be a non-negative number`);
    }
    return value;
  };
  /**
   * FLUXRADAR_BACKUP_MAX_AGE_HOURS is the one policy number that is not merely
   * conservative when it is zero: it is the freshness alarm, and
   * assessSnapshotFreshness refuses to run on a limit that is not positive. That
   * refusal used to surface at gate time — inside a nightly restore
   * verification, as an error about a "limit" with no hint that an env file set
   * it to 0 — while `latest-key`, `list` and `prune` happily ran on the same
   * broken configuration. Configuration is validated where it is read.
   *
   * The other four stay on `numeric` on purpose: zero disables pruning
   * (maxDeletePerRun), keeps only the minimum (retentionDays) or makes retention
   * refuse to delete at all (staleHours). Each of those fails towards keeping
   * backups, and planRetention rejects the one that does not (minKeep < 1).
   */
  const positiveHours = (name, fallback) => {
    const value = numeric(name, fallback);
    if (value <= 0) {
      throw new Error(
        `${name} must be a positive number of hours: a limit of ${value} accepts no snapshot ` +
          'as fresh, so the backup freshness gate could never pass',
      );
    }
    return value;
  };
  return {
    endpoint: env.HETZNER_S3_ENDPOINT.trim(),
    region: env.HETZNER_S3_REGION.trim(),
    bucket: env.HETZNER_S3_BUCKET.trim(),
    accessKey: env.HETZNER_S3_ACCESS_KEY.trim(),
    secretKey: env.HETZNER_S3_SECRET_KEY.trim(),
    prefix: (env.FLUXRADAR_BACKUP_PREFIX ?? '').trim() || DEFAULT_PREFIX,
    policy: {
      retentionDays: numeric('FLUXRADAR_BACKUP_RETENTION_DAYS', DEFAULT_POLICY.retentionDays),
      minKeep: numeric('FLUXRADAR_BACKUP_MIN_KEEP', DEFAULT_POLICY.minKeep),
      maxDeletePerRun: numeric('FLUXRADAR_BACKUP_MAX_DELETE', DEFAULT_POLICY.maxDeletePerRun),
      staleHours: numeric('FLUXRADAR_BACKUP_STALE_HOURS', DEFAULT_POLICY.staleHours),
      maxAgeHours: positiveHours('FLUXRADAR_BACKUP_MAX_AGE_HOURS', DEFAULT_POLICY.maxAgeHours),
    },
  };
}

function createClient(config) {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
  });
}

function requireOption(options, name) {
  const value = options.get(name);
  if (value === undefined || value === 'true') {
    throw new Error(`--${name} is required`);
  }
  return value;
}

/**
 * Encrypts a dump and uploads it with a metadata sidecar.
 *
 * The sidecar is plaintext on purpose: it holds the sizes and the SHA-256 of the
 * *plaintext* dump so a restore can prove it reconstructed the exact bytes that
 * were dumped, and it must stay readable when the encryption key is the thing
 * being recovered. It carries no credential and no row of customer data.
 */
async function commandUpload(env, options) {
  const config = readConfig(env);
  const key = readKeyFromEnv(env);
  const dumpPath = requireOption(options, 'dump');
  const dryRun = options.get('dry-run') === 'true';
  // --at exists so a test can pin the key a snapshot lands under; production
  // always stamps the moment the dump finished.
  const at = options.get('at');
  const takenAt = at === undefined || at === 'true' ? new Date() : new Date(at);
  if (Number.isNaN(takenAt.getTime())) throw new Error('--at must be an ISO timestamp');

  const plain = await digestFile(dumpPath);
  const archivePath = `${dumpPath}.enc`;
  await encryptFile(dumpPath, archivePath, key);
  const archive = await digestFile(archivePath);
  const keys = snapshotKey(config.prefix, takenAt);
  const metadata = {
    version: 1,
    takenAt: takenAt.toISOString(),
    database: (env.POSTGRES_DB ?? '').trim() || null,
    release: (env.FLUXRADAR_RELEASE_ID ?? '').trim() || null,
    dumpFormat: 'pg_dump-custom',
    plainBytes: plain.bytes,
    plainSha256: plain.sha256,
    archiveBytes: archive.bytes,
    archiveSha256: archive.sha256,
    encryption: 'aes-256-gcm',
  };

  if (dryRun) {
    console.log(`DRY RUN: would upload ${keys.archive} (${archive.bytes} bytes) and its sidecar`);
    return { archiveKey: keys.archive, metadataKey: keys.metadata, dryRun: true, metadata };
  }

  const client = createClient(config);
  const put = await client.putFile(
    keys.archive,
    archivePath,
    'application/octet-stream',
    archive.sha256,
  );
  await client.putText(keys.metadata, `${JSON.stringify(metadata, null, 2)}\n`, 'application/json');

  // Verify what the bucket actually holds rather than what the PUT reported. A
  // silent truncation is the failure that only shows up during a restore, which
  // is the worst possible moment to discover it.
  const head = await client.headObject(keys.archive);
  if (head === null) {
    throw new Error(`uploaded archive ${keys.archive} is not readable back from the bucket`);
  }
  if (head.bytes !== archive.bytes) {
    throw new Error(
      `uploaded archive ${keys.archive} is ${head.bytes} bytes in the bucket but ` +
        `${archive.bytes} bytes locally`,
    );
  }
  // Ceph returns the MD5 of a single-part upload as the ETag. When it returns
  // something else (a multipart or a server-side transform), the size check above
  // still stands and this is reported rather than treated as a mismatch.
  if (put.etag !== '' && put.etag !== archive.md5) {
    console.warn(`WARNING: ETag ${put.etag} is not the archive MD5; size verified instead`);
  }
  console.log(`uploaded ${keys.archive} (${archive.bytes} bytes, verified)`);
  return { archiveKey: keys.archive, metadataKey: keys.metadata, dryRun: false, metadata };
}

/** Newest snapshot under the configured prefix as `{ key, takenAt }`, or null. */
async function findLatest(client, prefix) {
  const objects = await client.listObjects(`${prefix.replace(/^\/+|\/+$/g, '')}/`);
  const snapshots = objects
    .map((object) => ({ key: object.key, takenAt: snapshotTimestamp(object.key) }))
    .filter((entry) => entry.takenAt !== null)
    .sort((left, right) => right.takenAt.getTime() - left.takenAt.getTime());
  return snapshots[0] ?? null;
}

/**
 * The plaintext sidecar of a snapshot, or null when the object genuinely is not
 * there. Anything else THROWS.
 *
 * It is fetched BEFORE the archive: it is a few hundred bytes and it carries the
 * timestamp the freshness gate needs, so a stale snapshot is refused without
 * downloading a database dump first.
 *
 * The distinction matters because the sidecar is what both gates read. A blanket
 * `catch { return null }` turned "the credentials cannot read this bucket",
 * "the endpoint refused the request" and "the sidecar is corrupt" into the same
 * answer as "an old snapshot predates sidecars" — and that answer downgrades the
 * freshness check to the key's own timestamp and drops the checksum verification
 * entirely, with one warning line. Only a 404 is an expected absence.
 */
async function readMetadataSidecar(client, archiveKey) {
  const metadataKey = archiveKey.replace(ARCHIVE_SUFFIX, METADATA_SUFFIX);
  let body;
  try {
    body = await client.getText(metadataKey);
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.statusCode === 404) {
      return null;
    }
    throw new Error(
      `the metadata sidecar ${metadataKey} could not be read, so this snapshot cannot be ` +
        `age-checked or checksum-verified: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(
      `the metadata sidecar ${metadataKey} exists but is not readable JSON. It carries the ` +
        'checksum and the timestamp this snapshot is verified against, so the snapshot is not ' +
        'trusted; repair or remove the sidecar object and retry.',
    );
  }
}

async function commandList(env, options) {
  const config = readConfig(env);
  const client = createClient(config);
  const objects = await client.listObjects(`${config.prefix.replace(/^\/+|\/+$/g, '')}/`);
  const snapshots = objects
    .filter((object) => object.key.endsWith(ARCHIVE_SUFFIX))
    .map((object) => ({ ...object, takenAt: snapshotTimestamp(object.key) }))
    .filter((object) => object.takenAt !== null)
    .sort((left, right) => right.takenAt.getTime() - left.takenAt.getTime());
  const limit = Number(options.get('limit') ?? snapshots.length);
  for (const snapshot of snapshots.slice(0, limit)) {
    console.log(`${snapshot.takenAt.toISOString()}\t${snapshot.bytes}\t${snapshot.key}`);
  }
  if (snapshots.length === 0) console.log('(no snapshot under this prefix)');
  return snapshots;
}

async function commandLatestKey(env) {
  const config = readConfig(env);
  const latest = await findLatest(createClient(config), config.prefix);
  if (latest === null) throw new Error('no FluxRadar snapshot exists under this prefix');
  console.log(latest.key);
  return latest.key;
}

/**
 * Downloads and decrypts one snapshot. Writes exactly two local files (the
 * ciphertext and the plaintext dump) into a directory the caller owns, and
 * verifies the plaintext against the sidecar's SHA-256 when one exists.
 */
async function commandDownload(env, options) {
  const config = readConfig(env);
  const key = readKeyFromEnv(env);
  const client = createClient(config);
  const requestedKey = options.get('key');
  const namedByCaller = requestedKey !== undefined && requestedKey !== 'true';
  const latest = namedByCaller ? null : await findLatest(client, config.prefix);
  if (!namedByCaller && latest === null) {
    throw new Error('no FluxRadar snapshot exists under this prefix');
  }
  const archiveKey = namedByCaller ? requestedKey : latest.key;
  if (!archiveKey.endsWith(ARCHIVE_SUFFIX)) {
    throw new Error(`refusing to restore "${archiveKey}": not a ${ARCHIVE_SUFFIX} archive`);
  }

  const metadata = await readMetadataSidecar(client, archiveKey);
  if (metadata === null) {
    console.warn('WARNING: no readable metadata sidecar; the dump could not be checksum-verified');
  }

  // THE FRESHNESS GATE. It applies exactly when this command chose the snapshot
  // itself — which is what the nightly verification does — because then "the
  // newest one" is a claim about the state of the backups, and an ancient newest
  // snapshot is a failed backup system that restores perfectly.
  //
  // A snapshot the CALLER named is never age-gated: that is an operator asking
  // for one specific object, and a disaster recovery must not be blocked because
  // the only backup that exists is older than the alarm threshold. `--allow-stale`
  // says the same thing for the "newest" path (pg-restore.sh passes it on the
  // destructive restore, which is exactly that case).
  if (!namedByCaller && options.get('allow-stale') !== 'true') {
    const freshness = assessSnapshotFreshness(
      {
        key: archiveKey,
        keyTakenAt: latest.takenAt,
        metadataTakenAt: metadata === null ? null : (metadata.takenAt ?? null),
      },
      { now: new Date(), maxAgeHours: config.policy.maxAgeHours },
    );
    for (const warning of freshness.warnings) console.warn(`WARNING: ${warning}`);
    if (!freshness.ok) throw new Error(freshness.reason);
    console.log(
      `newest snapshot ${archiveKey} is ${freshness.ageHours.toFixed(1)}h old ` +
        `(limit ${config.policy.maxAgeHours}h)`,
    );
  }

  const outPath = requireOption(options, 'out');
  mkdirSync(dirname(outPath), { recursive: true, mode: 0o700 });
  const archivePath = `${outPath}.enc`;
  await client.getFile(archiveKey, archivePath);
  await decryptFile(archivePath, outPath, key);
  rmSync(archivePath, { force: true });

  if (metadata !== null) {
    const plain = await digestFile(outPath);
    // A sidecar that parses but records no plainSha256 verifies NOTHING, and
    // saying "checksum verified" there is the one claim a restore must never
    // make on trust: the operator reading it is deciding whether to put this
    // dump in front of the business. It is reported as unverified instead —
    // which is the same thing the missing-sidecar branch below says.
    if (metadata.plainSha256 === undefined || metadata.plainSha256 === null) {
      console.warn(
        `WARNING: the metadata sidecar for ${archiveKey} records no plainSha256; ` +
          'the dump could not be checksum-verified',
      );
      console.log(
        `decrypted ${archiveKey} -> ${outPath} (${plain.bytes} bytes, checksum NOT verified)`,
      );
    } else if (metadata.plainSha256 !== plain.sha256) {
      throw new Error(
        `restored dump does not match the checksum recorded at backup time for ${archiveKey}`,
      );
    } else {
      console.log(
        `decrypted ${archiveKey} -> ${outPath} (${plain.bytes} bytes, checksum verified)`,
      );
    }
  } else {
    console.log(`decrypted ${archiveKey} -> ${outPath} (${statSync(outPath).size} bytes)`);
  }
  return { archiveKey, outPath, metadata };
}

async function commandPrune(env, options) {
  const config = readConfig(env);
  const client = createClient(config);
  const dryRun = options.get('dry-run') === 'true';
  const objects = await client.listObjects(`${config.prefix.replace(/^\/+|\/+$/g, '')}/`);
  const plan = planRetention(objects, { now: new Date(), policy: config.policy });
  for (const warning of plan.warnings) console.warn(`WARNING: ${warning}`);
  if (plan.refusedReason !== null) {
    console.log(`retention sweep did not delete anything: ${plan.refusedReason}`);
    return plan;
  }
  console.log(
    `retention: ${plan.snapshots.length} snapshot(s), keeping ${plan.keep.length}, ` +
      `deleting ${plan.delete.length} object(s)`,
  );
  for (const key of plan.delete) {
    if (dryRun) {
      console.log(`DRY RUN: would delete ${key}`);
      continue;
    }
    await client.deleteObject(key);
    console.log(`deleted ${key}`);
  }
  return plan;
}

const COMMANDS = {
  upload: commandUpload,
  download: commandDownload,
  list: commandList,
  'latest-key': commandLatestKey,
  prune: commandPrune,
};

const USAGE = `Usage: node backup-cli.cjs <command> [options]

Commands:
  upload   --dump <path> [--dry-run]     encrypt a pg_dump file and store it
  download [--key <s3 key>] [--allow-stale] --out <path>
                                         fetch and decrypt a snapshot; without
                                         --key the newest one is used and must be
                                         newer than FLUXRADAR_BACKUP_MAX_AGE_HOURS
  list     [--limit N]                   list snapshots, newest first
  latest-key                             print the newest snapshot key
  prune    [--dry-run]                   apply the retention policy

Common options:
  --env-file <path>   load KEY=value pairs (the release .env.production)

Configuration is read from the environment: ${S3_ENV_VARS.join(', ')},
${KEY_ENV_VAR}, FLUXRADAR_BACKUP_PREFIX, FLUXRADAR_BACKUP_RETENTION_DAYS,
FLUXRADAR_BACKUP_MIN_KEEP, FLUXRADAR_BACKUP_MAX_DELETE, FLUXRADAR_BACKUP_STALE_HOURS,
FLUXRADAR_BACKUP_MAX_AGE_HOURS.
`;

async function main(argv) {
  const { options, positional } = parseArgs(argv);
  const command = positional[0];
  if (command === undefined || COMMANDS[command] === undefined) {
    console.error(USAGE);
    throw new Error(command === undefined ? 'no command given' : `unknown command "${command}"`);
  }
  const env = { ...process.env };
  const envFile = options.get('env-file');
  if (envFile !== undefined && envFile !== 'true') {
    if (!existsSync(envFile)) throw new Error(`--env-file does not exist: ${envFile}`);
    loadEnvFile(envFile, env);
  }
  await COMMANDS[command](env, options);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`backup: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

module.exports = { loadEnvFile, main, parseArgs, readConfig };
