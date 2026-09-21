#!/usr/bin/env bash
# Names every variable a database backup needs that a release env file lacks.
#
# Production ran for two weeks with FLUXRADAR_BACKUP_ENCRYPTION_KEY set nowhere.
# pg-backup.sh refused to run every night, backup-verify failed every night, and
# every deploy in that time went green — because nothing in the deploy asked
# whether the release it was shipping could be backed up at all. The `package`
# stage now runs this against the env file it is about to ship, and turns a
# non-empty answer into a warning on the run.
#
# It warns rather than blocks on purpose: a deploy gated on the backup config
# would also block the fix for whatever else is wrong in production.
#
# Usage: check-backup-config.sh <env-file>
# Output: the missing NAMES, space-separated — never a value.
# Exit:   0 — everything is set; 1 — something is missing; 2 — usage error.

set -uo pipefail

ENV_FILE="${1:-}"
if [ -z "$ENV_FILE" ] || [ ! -f "$ENV_FILE" ]; then
  echo 'usage: check-backup-config.sh <env-file>' >&2
  exit 2
fi

# pg-backup.sh's own `for required in` list, then backup-cli.cjs's S3_ENV_VARS.
# DEPLOY-016 fails when either of those names a variable that is not here.
REQUIRED="POSTGRES_DB POSTGRES_USER FLUXRADAR_BACKUP_ENCRYPTION_KEY"
REQUIRED="$REQUIRED HETZNER_S3_ENDPOINT HETZNER_S3_REGION HETZNER_S3_BUCKET HETZNER_S3_ACCESS_KEY HETZNER_S3_SECRET_KEY"

missing=""
for name in $REQUIRED; do
  # The file is in the one form deploy/normalize-env-file.cjs guarantees:
  # KEY=value, unquoted. An empty value is as missing as an absent line.
  if ! grep -q "^$name=." "$ENV_FILE"; then
    missing="$missing $name"
  fi
done

if [ -n "$missing" ]; then
  echo "${missing# }"
  exit 1
fi
exit 0
