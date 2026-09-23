#!/usr/bin/env bash
#
# FluxRadar PostgreSQL restore — verification by default, destruction only when
# it is spelled out.
#
# A backup nobody has restored is a hope, not a backup, so the default mode of
# this script is the one that is safe to run on a schedule against production:
# it downloads the newest snapshot, decrypts it, restores it into a THROWAWAY
# database beside the live one, checks the result and drops the throwaway again.
# The live database is never read from, written to or dropped in that mode.
#
# Restoring OVER a database is a separate, deliberate act. It requires an
# explicit target, an explicit flag, an environment variable naming the database
# by hand, and no running API container — see "--target-database" below.
#
# Usage:
#   pg-restore.sh [--verify-latest] [--key S3KEY] [--keep] [--dry-run]
#   pg-restore.sh --target-database NAME --i-know-this-destroys-data
#
#   --verify-latest   (default) restore the newest snapshot into a throwaway
#                     database, verify it, drop it again. FAILS when the newest
#                     snapshot is older than FLUXRADAR_BACKUP_MAX_AGE_HOURS
#                     (default 26): a backup that stopped running two weeks ago
#                     still decrypts and still restores, so age is the only thing
#                     that catches it.
#   --key S3KEY       verify a specific snapshot instead of the newest one. A
#                     snapshot named by hand is never age-gated.
#   --keep            do not drop the throwaway database (leaves it for
#                     inspection; it is never the live database).
#   --dry-run         download and decrypt only; touch no database at all.
#   --target-database restore into this database. Refuses the live database
#                     unless FLUXRADAR_RESTORE_ALLOW_PRODUCTION is set to
#                     "overwrite-<POSTGRES_DB>" and no API container is running.

set -Eeuo pipefail

APP_DIR="${FLUXRADAR_APP_DIR:-/opt/fluxradar}"
ENV_FILE=""
SNAPSHOT_KEY=""
TARGET_DATABASE=""
MODE="verify"
KEEP="false"
DRY_RUN="false"
CONFIRM_DESTRUCTIVE="false"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --app-dir) APP_DIR="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --key) SNAPSHOT_KEY="$2"; shift 2 ;;
    --target-database) TARGET_DATABASE="$2"; MODE="target"; shift 2 ;;
    --i-know-this-destroys-data) CONFIRM_DESTRUCTIVE="true"; shift ;;
    --verify-latest) MODE="verify"; shift ;;
    --keep) KEEP="true"; shift ;;
    --dry-run) DRY_RUN="true"; shift ;;
    -h|--help) sed -n '3,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf 'pg-restore: unknown argument "%s"\n' "$1" >&2; exit 64 ;;
  esac
done

: "${ENV_FILE:=$APP_DIR/current/.env.production}"

log() { printf '[restore] %s\n' "$*"; }
fail() { printf '[restore] ERROR: %s\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || fail "env file not found: $ENV_FILE"

load_env_file() {
  local line key value
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in ''|'#'*) continue ;; esac
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in ''|*[!A-Za-z0-9_]*) continue ;; esac
    export "$key=$value"
  done < "$1"
}
load_env_file "$ENV_FILE"

for required in POSTGRES_DB POSTGRES_USER FLUXRADAR_BACKUP_ENCRYPTION_KEY; do
  [ -n "${!required:-}" ] || fail "$required is not set in $ENV_FILE"
done

STAMP="$(date -u '+%Y%m%d%H%M%S')"
VERIFY_DATABASE="fluxradar_verify_$STAMP"

# ---- The destructive path, gated four ways --------------------------------
# Order matters: every refusal below happens before a single byte is downloaded,
# so a mistyped command cannot even start.
if [ "$MODE" = "target" ]; then
  case "$TARGET_DATABASE" in
    ''|*[!a-z0-9_]*) fail 'target database name must be lowercase letters, digits and underscores' ;;
  esac
  if [ "$CONFIRM_DESTRUCTIVE" != "true" ]; then
    fail "restoring into \"$TARGET_DATABASE\" replaces its contents; pass --i-know-this-destroys-data"
  fi
  if [ "$TARGET_DATABASE" = "$POSTGRES_DB" ]; then
    if [ "${FLUXRADAR_RESTORE_ALLOW_PRODUCTION:-}" != "overwrite-$POSTGRES_DB" ]; then
      fail "refusing to restore over the live database; set FLUXRADAR_RESTORE_ALLOW_PRODUCTION=overwrite-$POSTGRES_DB to confirm"
    fi
    running_api="$(docker ps --filter 'name=fluxradar-api-' --filter 'status=running' --format '{{.Names}}' | head -n 1)"
    if [ -n "$running_api" ]; then
      fail "the API container $running_api is still running; stop it before restoring over the live database"
    fi
  fi
fi

WORK_DIR="$APP_DIR/backups/restore-work"
install -m 700 -d "$WORK_DIR"
DUMP_PATH="$WORK_DIR/fluxradar-restore-$STAMP.dump"

cleanup() {
  rm -f -- "$DUMP_PATH" "$DUMP_PATH.enc"
}
trap cleanup EXIT

# `docker exec -e PGPASSWORD` (no value) forwards this from the current process
# instead of putting the password into the container's argv, where `ps` on the
# host would show it. The official image authenticates a unix-socket connection
# with trust, so this is belt and braces — and it is what keeps the scripts
# working if that ever changes.
export PGPASSWORD="${POSTGRES_PASSWORD:-}"

POSTGRES_CONTAINER="${FLUXRADAR_POSTGRES_CONTAINER:-}"
if [ -z "$POSTGRES_CONTAINER" ]; then
  POSTGRES_CONTAINER="$(docker ps \
    --filter 'label=com.docker.compose.project=fluxradar' \
    --filter 'label=com.docker.compose.service=postgres' \
    --filter 'status=running' --format '{{.ID}}' | head -n 1)"
fi
[ -n "$POSTGRES_CONTAINER" ] || fail 'no running PostgreSQL container was found for project "fluxradar"'

run_backup_cli() {
  if command -v node >/dev/null 2>&1; then
    node "$SCRIPT_DIR/backup-cli.cjs" "$@" --env-file "$ENV_FILE"
    return
  fi
  local api_image
  api_image="${FLUXRADAR_BACKUP_NODE_IMAGE:-}"
  if [ -z "$api_image" ]; then
    api_image="$(docker ps --filter 'name=fluxradar-api-' --filter 'status=running' \
      --format '{{.Image}}' | head -n 1)"
  fi
  [ -n "$api_image" ] || fail 'no node on PATH and no running FluxRadar API image to borrow one from'
  docker run --rm \
    --env-file "$ENV_FILE" \
    --volume "$SCRIPT_DIR:/fluxradar-backup:ro" \
    --volume "$WORK_DIR:/work" \
    "$api_image" node /fluxradar-backup/backup-cli.cjs "$@"
}

cli_path() {
  if command -v node >/dev/null 2>&1; then printf '%s' "$1"; else printf '/work/%s' "$(basename "$1")"; fi
}

DOWNLOAD_ARGS=(download --out "$(cli_path "$DUMP_PATH")")
if [ -n "$SNAPSHOT_KEY" ]; then DOWNLOAD_ARGS+=(--key "$SNAPSHOT_KEY"); fi
# A restore INTO a database is a disaster recovery, and the only backup that
# exists on that day may well be older than the freshness alarm. Refusing to
# restore it would be the alarm causing the outage it warns about, so the age
# gate is switched off on this path only — and it stays on for --verify-latest,
# which is the scheduled run whose whole job is to notice a stale backup.
if [ "$MODE" = "target" ]; then DOWNLOAD_ARGS+=(--allow-stale); fi
log 'downloading and decrypting the snapshot'
run_backup_cli "${DOWNLOAD_ARGS[@]}"
[ -s "$DUMP_PATH" ] || fail 'the decrypted dump is empty'

if [ "$DRY_RUN" = "true" ]; then
  log "dry run: decrypted $(wc -c < "$DUMP_PATH") bytes; no database was touched"
  exit 0
fi

psql_in_container() {
  docker exec -e PGPASSWORD -i "$POSTGRES_CONTAINER" \
    psql --username "$POSTGRES_USER" --dbname "$1" --no-align --tuples-only --quiet --command "$2"
}

if [ "$MODE" = "verify" ]; then
  RESTORE_DATABASE="$VERIFY_DATABASE"
  log "creating throwaway verification database $RESTORE_DATABASE"
  docker exec -e PGPASSWORD "$POSTGRES_CONTAINER" \
    createdb --username "$POSTGRES_USER" "$RESTORE_DATABASE"
else
  RESTORE_DATABASE="$TARGET_DATABASE"
  # An empty target is required, and this script never empties one itself. A
  # restore into a database that still holds objects half-succeeds — pg_restore
  # errors on what already exists and leaves a mixture of old and restored rows,
  # which is worse than either. Dropping and recreating the live database is a
  # decision an operator makes at the psql prompt, on purpose, with the API
  # stopped.
  existing_tables="$(psql_in_container "$RESTORE_DATABASE" \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
  if [ "${existing_tables:-0}" -ne 0 ]; then
    fail "$RESTORE_DATABASE already contains ${existing_tables} table(s); restore into an empty database, or drop and recreate this one at the psql prompt first, with the API stopped"
  fi
  log "restoring into empty database $RESTORE_DATABASE (destructive path, confirmed)"
fi

drop_verification_database() {
  # Only ever the database this run created, and only when its name still looks
  # like one: no argument, no variable and no failure can point this at the live
  # database.
  case "$1" in
    fluxradar_verify_[0-9]*) ;;
    *) log "refusing to drop \"$1\": not a verification database"; return 0 ;;
  esac
  docker exec -e PGPASSWORD "$POSTGRES_CONTAINER" \
    dropdb --username "$POSTGRES_USER" --force --if-exists "$1" || true
}

if [ "$MODE" = "verify" ] && [ "$KEEP" != "true" ]; then
  trap 'drop_verification_database "$VERIFY_DATABASE"; cleanup' EXIT
fi

log "restoring the dump into $RESTORE_DATABASE"
if ! docker exec -e PGPASSWORD -i "$POSTGRES_CONTAINER" \
  pg_restore --username "$POSTGRES_USER" --dbname "$RESTORE_DATABASE" \
  --no-owner --no-privileges --exit-on-error < "$DUMP_PATH"; then
  fail "pg_restore failed against $RESTORE_DATABASE"
fi

# What "the backup is good" actually means, checked instead of assumed: the
# schema is there, every migration recorded in it finished, and the table the
# whole product hangs off can be read.
tables="$(psql_in_container "$RESTORE_DATABASE" \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")"
migrations="$(psql_in_container "$RESTORE_DATABASE" \
  "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL")"
unfinished="$(psql_in_container "$RESTORE_DATABASE" \
  "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL")"
accounts="$(psql_in_container "$RESTORE_DATABASE" 'SELECT count(*) FROM "Account"')"

log "restored: $tables table(s), $migrations applied migration(s), $accounts account row(s)"
[ "${tables:-0}" -ge 5 ] || fail "restored database has only ${tables:-0} table(s); the dump is not a FluxRadar database"
[ "${migrations:-0}" -ge 1 ] || fail 'restored database records no applied migration'
[ "${unfinished:-0}" -eq 0 ] || fail "restored database records ${unfinished} unfinished migration(s)"

if [ "$MODE" = "verify" ] && [ "$KEEP" = "true" ]; then
  log "verification database $RESTORE_DATABASE was kept; drop it with: dropdb $RESTORE_DATABASE"
fi
log 'restore verification succeeded'
