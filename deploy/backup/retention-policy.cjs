// What a retention sweep is allowed to delete.
//
// This is the one part of the backup path that removes data, so it is written as
// a pure planner: it takes the object listing, the policy and the current time,
// and returns exactly which keys would be deleted. Nothing here touches S3 —
// backup-cli.cjs performs the plan, `--dry-run` prints it, and the test suite
// asserts it, all against the same function.
//
// The rules are deliberately conservative, because every failure mode of a
// retention sweep is "the backups are gone when they were needed":
//
//   * Only keys this tool itself writes are ever candidates. Anything else in
//     the bucket — another prefix, a hand-uploaded file, a key with a timestamp
//     it cannot parse — is invisible to the planner and can never be deleted.
//   * The newest N snapshots survive regardless of age, so a deployment that has
//     been quiet for longer than the retention window still has history.
//   * A sweep refuses to run at all when the newest backup is stale. A stale
//     newest backup means backups have been failing; deleting the older ones
//     would then be the sweep finishing what the failure started.
//   * One run may delete at most `maxDeletePerRun` snapshots. A clock jump, a
//     mis-set policy or a partially listed bucket therefore costs a bounded
//     number of snapshots and shows up in the next run's log instead of
//     emptying the bucket in one pass.
//
// The same file also answers the question the VERIFICATION path asks, because it
// is the same question about the same keys: how old is the snapshot we are about
// to restore, and is that still acceptable? See assessSnapshotFreshness.

const ARCHIVE_SUFFIX = '.dump.enc';
const METADATA_SUFFIX = '.meta.json';

/** `fluxradar-20260906T021700Z` — UTC, sortable, and the only name deletable. */
const SNAPSHOT_NAME = /(?:^|\/)fluxradar-(\d{8})T(\d{6})Z\.dump\.enc$/;

const DEFAULT_POLICY = Object.freeze({
  retentionDays: 30,
  minKeep: 7,
  maxDeletePerRun: 50,
  // Retention's own refusal threshold: it stops DELETING when the newest
  // snapshot is this old, so it is deliberately generous.
  staleHours: 48,
  // The freshness alarm, and a different question with a different answer: how
  // old may the newest snapshot be before the nightly verification calls the
  // backups broken? Backups run daily, so one missed night (24h) plus a couple
  // of hours of slack is already the signal. Keep it BELOW staleHours: the
  // alarm has to fire before retention quietly stops pruning.
  maxAgeHours: 26,
});

/** A snapshot timestamped ahead of the clock is wrong, not fresh. */
const FUTURE_TOLERANCE_HOURS = 0.25;
/** Key and sidecar disagreeing by more than this is worth saying out loud. */
const TIMESTAMP_DISAGREEMENT_HOURS = 1;

/** Builds the key of a snapshot taken at `date`, partitioned by UTC month. */
function snapshotKey(prefix, date) {
  const stamp = date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const year = stamp.slice(0, 4);
  const month = stamp.slice(4, 6);
  const base = `${trimPrefix(prefix)}/${year}/${month}/fluxradar-${stamp}`;
  return { archive: `${base}${ARCHIVE_SUFFIX}`, metadata: `${base}${METADATA_SUFFIX}` };
}

function trimPrefix(prefix) {
  return prefix.replace(/^\/+|\/+$/g, '');
}

/** The UTC instant encoded in a snapshot key, or null when it is not one. */
function snapshotTimestamp(key) {
  const match = SNAPSHOT_NAME.exec(key);
  if (match === null) return null;
  const [, day, time] = match;
  const iso =
    `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T` +
    `${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizePolicy(policy = {}) {
  const merged = { ...DEFAULT_POLICY, ...policy };
  for (const [name, value] of Object.entries(merged)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`retention policy value for ${name} must be a non-negative number`);
    }
  }
  if (merged.minKeep < 1) {
    throw new Error(
      'retention policy minKeep must be at least 1: a bucket with no backup is not a policy',
    );
  }
  return merged;
}

/**
 * Decides what to delete.
 *
 * Returns `{ snapshots, keep, delete: keys, refusedReason, warnings }`.
 * `refusedReason` non-null means nothing may be deleted this run and the caller
 * must say so out loud rather than treating an empty delete list as success.
 */
function planRetention(objects, options) {
  const policy = normalizePolicy(options.policy);
  const now = options.now;
  const snapshots = [];
  for (const object of objects) {
    const takenAt = snapshotTimestamp(object.key);
    if (takenAt === null) continue;
    snapshots.push({ key: object.key, takenAt, bytes: object.bytes ?? 0 });
  }
  snapshots.sort((left, right) => right.takenAt.getTime() - left.takenAt.getTime());

  const warnings = [];
  const metadataKeys = new Set(
    objects.map((object) => object.key).filter((key) => key.endsWith(METADATA_SUFFIX)),
  );

  if (snapshots.length === 0) {
    return {
      snapshots,
      keep: [],
      delete: [],
      refusedReason: 'no FluxRadar snapshot was found under this prefix',
      warnings,
    };
  }

  const newest = snapshots[0];
  const ageHours = (now.getTime() - newest.takenAt.getTime()) / 3_600_000;
  if (ageHours > policy.staleHours) {
    return {
      snapshots,
      keep: snapshots.map((snapshot) => snapshot.key),
      delete: [],
      refusedReason:
        `the newest snapshot is ${Math.floor(ageHours)}h old (limit ${policy.staleHours}h): ` +
        'backups are failing, so nothing is pruned until a fresh one exists',
      warnings,
    };
  }

  const cutoff = now.getTime() - policy.retentionDays * 24 * 3_600_000;
  const keep = [];
  const expired = [];
  snapshots.forEach((snapshot, index) => {
    const withinMinimum = index < policy.minKeep;
    const withinWindow = snapshot.takenAt.getTime() >= cutoff;
    if (withinMinimum || withinWindow) keep.push(snapshot.key);
    else expired.push(snapshot);
  });

  const selected = expired.slice(0, policy.maxDeletePerRun);
  if (expired.length > selected.length) {
    warnings.push(
      `${expired.length - selected.length} expired snapshot(s) were left for the next run ` +
        `(maxDeletePerRun=${policy.maxDeletePerRun})`,
    );
    for (const snapshot of expired.slice(policy.maxDeletePerRun)) keep.push(snapshot.key);
  }

  const deleteKeys = [];
  for (const snapshot of selected) {
    deleteKeys.push(snapshot.key);
    const metadataKey = snapshot.key.replace(ARCHIVE_SUFFIX, METADATA_SUFFIX);
    if (metadataKeys.has(metadataKey)) deleteKeys.push(metadataKey);
  }

  return { snapshots, keep, delete: deleteKeys, refusedReason: null, warnings };
}

/**
 * How old the snapshot a restore is about to use really is, and whether that is
 * still inside the freshness limit.
 *
 * A backup that stopped running two weeks ago passes every other check in this
 * repository: the newest object still decrypts, still matches its checksum and
 * still restores. It is the AGE that makes it useless, so the age is the thing
 * that has to be asserted rather than assumed — this is the check that turns
 * "the bucket has a snapshot" into "the bucket has a snapshot worth restoring".
 *
 * Two timestamps are consulted, and the OLDER one wins. The key states when the
 * upload happened; the sidecar states when the dump was taken. They normally
 * agree within seconds, but a backup job that re-uploads an old dump under a
 * fresh key would look brand new by its key alone — which is exactly the failure
 * this function exists to catch, so it may never be the optimistic one.
 *
 * Returns `{ ok, reason, ageHours, takenAt, warnings }`. `ok: false` means the
 * caller must fail loudly; `reason` is written for the operator who reads it at
 * 4am.
 */
function assessSnapshotFreshness(snapshot, options) {
  const maxAgeHours = options.maxAgeHours;
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    throw new Error(
      'the snapshot freshness limit must be a positive number of hours ' +
        `(FLUXRADAR_BACKUP_MAX_AGE_HOURS, got ${JSON.stringify(options.maxAgeHours)})`,
    );
  }
  const warnings = [];
  const absent = { ok: false, ageHours: null, takenAt: null, warnings };
  if (snapshot === null || snapshot === undefined) {
    return { ...absent, reason: 'no FluxRadar snapshot exists under this prefix' };
  }

  const keyTakenAt = snapshot.keyTakenAt ?? null;
  const rawMetadataTakenAt = snapshot.metadataTakenAt ?? null;
  let metadataTakenAt = null;
  if (rawMetadataTakenAt !== null) {
    const parsed = new Date(rawMetadataTakenAt);
    if (Number.isNaN(parsed.getTime())) {
      warnings.push(
        `the metadata sidecar of ${snapshot.key} states an unusable takenAt; ` +
          'the age is taken from the key instead',
      );
    } else {
      metadataTakenAt = parsed;
    }
  }

  const candidates = [keyTakenAt, metadataTakenAt].filter((value) => value !== null);
  if (candidates.length === 0) {
    return {
      ...absent,
      reason:
        `cannot tell how old ${snapshot.key} is: its key carries no timestamp and its ` +
        'metadata sidecar states none, so it cannot be accepted as a fresh backup',
    };
  }
  if (
    candidates.length === 2 &&
    Math.abs(candidates[0].getTime() - candidates[1].getTime()) >
      TIMESTAMP_DISAGREEMENT_HOURS * 3_600_000
  ) {
    warnings.push(
      `${snapshot.key} was uploaded at ${keyTakenAt.toISOString()} but its dump was taken at ` +
        `${metadataTakenAt.toISOString()}; the older of the two is used`,
    );
  }
  // The oldest candidate: a fresh key over a stale dump must not read as fresh.
  const takenAt = candidates.reduce((left, right) => (left.getTime() <= right.getTime() ? left : right));
  const ageHours = (options.now.getTime() - takenAt.getTime()) / 3_600_000;

  if (ageHours < -FUTURE_TOLERANCE_HOURS) {
    return {
      ok: false,
      ageHours,
      takenAt,
      warnings,
      reason:
        `${snapshot.key} is timestamped ${takenAt.toISOString()}, which is in the future: ` +
        'a clock or a metadata sidecar is wrong, so its age cannot be trusted',
    };
  }
  if (ageHours > maxAgeHours) {
    return {
      ok: false,
      ageHours,
      takenAt,
      warnings,
      reason:
        `the newest snapshot is ${ageHours.toFixed(1)}h old (limit ${maxAgeHours}h): ` +
        'backups have stopped producing usable snapshots, so this one is not a backup to rely on',
    };
  }
  return { ok: true, reason: null, ageHours, takenAt, warnings };
}

module.exports = {
  ARCHIVE_SUFFIX,
  DEFAULT_POLICY,
  METADATA_SUFFIX,
  assessSnapshotFreshness,
  planRetention,
  snapshotKey,
  snapshotTimestamp,
};
