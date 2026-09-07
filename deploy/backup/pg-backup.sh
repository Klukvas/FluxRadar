#!/usr/bin/env bash
#
# FluxRadar production PostgreSQL backup.
#
# Takes a consistent `pg_dump` of the live database, encrypts it, uploads it to
# Hetzner Object Storage and applies the retention policy. Read-only against the
# database: the only statements it issues are the ones pg_dump issues.
#
# Runs from cron on the single Hetzner Docker host (see fluxradar-backup.cron),
# and from the deploy user's shell for an ad-hoc snapshot before a risky change.
#
# pg_dump is executed INSIDE the running PostgreSQL container, never from a
# client on the host: the server is PostgreSQL 17 and a host client of a
# different major version refuses to dump it. That also means the host needs no
# PostgreSQL packages at all.
#
# Usage:
#   pg-backup.sh [--app-dir DIR] [--env-file PATH] [--dry-run] [--keep-local]
#
#   --dry-run     dump and encrypt, but write nothing to the bucket and delete
#                 nothing. Verifies the whole path including credentials shape.
#   --keep-local  leave the plaintext dump in the work directory (it is deleted
#                 by default; it contains every customer record).

set -Eeuo pipefail

APP_DIR="${FLUXRADAR_APP_DIR:-/opt/fluxradar}"
ENV_FILE=""
DRY_RUN="false"
KEEP_LOCAL="false"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --app-dir) APP_DIR="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --dry-run) DRY_RUN="true"; shift ;;
    --keep-local) KEEP_LOCAL="true"; shift ;;
    -h|--help) sed -n '3,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf 'pg-backup: unknown argument "%s"\n' "$1" >&2; exit 64 ;;
  esac
done

: "${ENV_FILE:=$APP_DIR/current/.env.production}"

log() { printf '[backup] %s\n' "$*"; }
fail() { printf '[backup] ERROR: %s\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || fail "env file not found: $ENV_FILE"

# Load KEY=value with `docker run --env-file` semantics — the exact form
# deploy/normalize-env-file.cjs guarantees. The file is never sourced: sourcing
# would execute whatever a value happens to look like.
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

# The PostgreSQL container is found by its compose labels rather than by a name
# or a working directory, so this keeps working across releases and however the
# stack was last started.
POSTGRES_CONTAINER="${FLUXRADAR_POSTGRES_CONTAINER:-}"
if [ -z "$POSTGRES_CONTAINER" ]; then
  POSTGRES_CONTAINER="$(docker ps \
    --filter 'label=com.docker.compose.project=fluxradar' \
    --filter 'label=com.docker.compose.service=postgres' \
    --filter 'status=running' --format '{{.ID}}' | head -n 1)"
fi
[ -n "$POSTGRES_CONTAINER" ] || fail 'no running PostgreSQL container was found for project "fluxradar"'

WORK_DIR="$APP_DIR/backups/work"
install -m 700 -d "$WORK_DIR"
STAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
DUMP_PATH="$WORK_DIR/fluxradar-$STAMP.dump"

# The plaintext dump is the whole database in one file. It is removed on every
# exit path, successful or not, unless --keep-local was asked for explicitly.
cleanup() {
  if [ "$KEEP_LOCAL" = "true" ]; then
    log "keeping local artifacts in $WORK_DIR (--keep-local)"
    return
  fi
  rm -f -- "$DUMP_PATH" "$DUMP_PATH.enc"
}
trap cleanup EXIT

# `docker exec -e PGPASSWORD` (no value) forwards this from the current process
# instead of putting the password into the container's argv, where `ps` on the
# host would show it. The official image authenticates a unix-socket connection
# with trust, so this is belt and braces — and it is what keeps the scripts
# working if that ever changes.
export PGPASSWORD="${POSTGRES_PASSWORD:-}"

log "dumping database from container ${POSTGRES_CONTAINER:0:12} (pg_dump custom format)"
# -e PGPASSWORD with no value forwards it from this process rather than putting
# the password into the container's argv, where `ps` would show it.
if ! docker exec -e PGPASSWORD -i "$POSTGRES_CONTAINER" \
  pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --format=custom --no-owner --no-privileges --compress=6 > "$DUMP_PATH"; then
  fail 'pg_dump failed; nothing was uploaded and no snapshot was deleted'
fi
[ -s "$DUMP_PATH" ] || fail 'pg_dump produced an empty file'
log "dump written: $(wc -c < "$DUMP_PATH") bytes"

# Node runs the encryption and the S3 transfer. The host is not required to have
# Node installed: the API image already carries the exact runtime this repository
# targets, and the scripts are bind-mounted into it read-only.
run_backup_cli() {
  if command -v node >/dev/null 2>&1; then
    # The env file is read by the CLI itself here; in the container branch below
    # docker has already injected it, and the host path does not exist there.
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

# Inside the borrowed container the work directory is mounted at /work, so the
# dump path has to be translated; on the host it is used as it is.
cli_path() {
  if command -v node >/dev/null 2>&1; then printf '%s' "$1"; else printf '/work/%s' "$(basename "$1")"; fi
}

UPLOAD_ARGS=(upload --dump "$(cli_path "$DUMP_PATH")")
PRUNE_ARGS=(prune)
if [ "$DRY_RUN" = "true" ]; then
  UPLOAD_ARGS+=(--dry-run)
  PRUNE_ARGS+=(--dry-run)
  log 'dry run: the bucket will not be written to and nothing will be deleted'
fi

run_backup_cli "${UPLOAD_ARGS[@]}"
run_backup_cli "${PRUNE_ARGS[@]}"
log 'backup finished'
