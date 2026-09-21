#!/usr/bin/env bash
# Takes a snapshot of the live database before a release that adds a migration.
#
# `prisma migrate deploy` runs in the release stage and CANNOT be undone. Every
# rollback control the deploy has protects the CODE: the compatibility gate
# proves the previous release can read the migrated schema, and
# rollback-release.sh puts that release back in front of traffic. None of it
# restores a column a migration dropped or a value it rewrote — for that the only
# answer is a dump, and the newest scheduled one can be up to 26 hours old
# (docs/DEPLOYMENT.md, "Freshness"). So one is taken here, by the release that is
# still running, immediately before the schema changes under it.
#
# Run ON THE SERVER by the `backup` stage of deploy.yml, from the new release's
# directory (the package stage has already extracted it):
#
#   bash "$APP_DIR/releases/$RELEASE_ID/deploy/backup/pre-migration-snapshot.sh" \
#     "$APP_DIR" "$RELEASE_ID" "$ALLOW_MIGRATION_WITHOUT_BACKUP"
#
# WHEN IN DOUBT, IT SNAPSHOTS. The snapshot is skipped only when the migration
# directories of the active and the new release were BOTH listed successfully and
# the new one adds nothing. A release missing its migrations directory, an
# active release without one, a listing that fails, a comparison that fails —
# each of them means "cannot tell what this release will migrate", and the answer
# to that is the snapshot, never "no snapshot needed". The inline version this
# replaces did the opposite: `comm … || true` over process substitutions whose
# failures nothing checked, so any error there read as "no new migrations" and
# the irreversible migration ran with no snapshot.
#
# A failed snapshot is fatal: proceeding would run an irreversible migration with
# a safety net nobody checked. ALLOW_MIGRATION_WITHOUT_BACKUP=true is the escape
# hatch for the day that trade is knowingly the right one.
#
# Exit: 0 — snapshot taken, none needed, or explicitly allowed to go without.
#       1 — refused: nothing was migrated and the previous release keeps serving.
#       2 — usage error.
#
# Portable on purpose (GNU and BSD userland): DEPLOY-015 runs it on developer
# machines, and GNU-only flags would turn every listing into a "failure" there.

set -uo pipefail
# Not `-e`: this is a gate, and every failure below is decided explicitly.

APP_DIR="${1:-}"
RELEASE_ID="${2:-}"
ALLOW_WITHOUT_BACKUP="${3:-false}"
if [ -z "$APP_DIR" ] || [ -z "$RELEASE_ID" ]; then
  echo 'usage: pre-migration-snapshot.sh <app-dir> <release-id> [allow-without-backup]' >&2
  exit 2
fi
RELEASE_DIR="$APP_DIR/releases/$RELEASE_ID"
MIGRATIONS_SUBPATH="apps/api/prisma/migrations"

if [ ! -L "$APP_DIR/current" ] && [ ! -e "$APP_DIR/current" ]; then
  echo "First deploy: there is no running release and no database to snapshot."
  exit 0
fi

WORK_DIR="$(mktemp -d)" || {
  echo 'ERROR: could not create a work directory to compare migrations in.' >&2
  WORK_DIR=""
}
cleanup() {
  if [ -n "$WORK_DIR" ]; then rm -rf -- "$WORK_DIR"; fi
}
trap cleanup EXIT

# Writes the migration directory names of a release, sorted, to $2.
# Returns 2 when the release has no migrations directory at all, 1 on any other
# failure. `ls -p` marks directories with a trailing slash, which is how the
# migration_lock.toml FILE beside them is left out.
list_migrations() {
  local dir="$1/$MIGRATIONS_SUBPATH"
  local out="$2"
  [ -d "$dir" ] || return 2
  ls -1p -- "$dir" > "$out.raw" || return 1
  { grep '/$' "$out.raw" || true; } | sed 's#/$##' | LC_ALL=C sort > "$out" || return 1
}

# Why a snapshot is required; empty means it is not.
reason=""
added=""
if [ -z "$WORK_DIR" ]; then
  reason="the migrations could not be compared"
else
  list_migrations "$RELEASE_DIR" "$WORK_DIR/new"
  new_status=$?
  list_migrations "$APP_DIR/current" "$WORK_DIR/current"
  current_status=$?
  if [ "$new_status" -eq 2 ]; then
    reason="this release carries no $MIGRATIONS_SUBPATH, so what it will migrate cannot be told"
  elif [ "$new_status" -ne 0 ]; then
    reason="this release's migrations could not be listed"
  elif [ "$current_status" -eq 2 ]; then
    reason="the active release has no $MIGRATIONS_SUBPATH to compare against"
  elif [ "$current_status" -ne 0 ]; then
    reason="the active release's migrations could not be listed"
  elif ! added="$(LC_ALL=C comm -13 "$WORK_DIR/current" "$WORK_DIR/new")"; then
    reason="the two migration lists could not be compared"
  elif [ -n "$added" ]; then
    reason="this release adds migrations"
  fi
fi

if [ -z "$reason" ]; then
  echo "No new migrations in $RELEASE_ID; the schema is unchanged and no snapshot is needed."
  exit 0
fi

echo "A snapshot is required: $reason."
if [ -n "$added" ]; then
  printf '  %s\n' $added
fi
echo "Taking a snapshot of the live database before anything is migrated."

BACKUP_SCRIPT="$APP_DIR/current/deploy/backup/pg-backup.sh"
if [ ! -f "$BACKUP_SCRIPT" ]; then
  echo "ERROR: $BACKUP_SCRIPT is missing on the server." >&2
  echo "The active release predates the backup tooling, so no pre-migration snapshot can be taken." >&2
elif bash "$BACKUP_SCRIPT" --app-dir "$APP_DIR"; then
  echo "OK: a snapshot of the pre-migration database is in the bucket."
  exit 0
else
  echo "ERROR: the pre-migration snapshot failed." >&2
fi

# Either the backup script was missing or it failed. Both mean the same thing.
if [ "$ALLOW_WITHOUT_BACKUP" = "true" ]; then
  echo "WARNING: ALLOW_MIGRATION_WITHOUT_BACKUP=true — applying an irreversible migration with NO verified snapshot taken immediately before it." >&2
  exit 0
fi
echo "Refusing to migrate without one. Nothing has been changed: the previous release is still serving and the schema is untouched." >&2
echo "Fix the backup (docs/DEPLOYMENT.md, 'Database backup and restore'), or set the ALLOW_MIGRATION_WITHOUT_BACKUP variable to 'true' to deploy anyway." >&2
exit 1
