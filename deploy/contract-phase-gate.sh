#!/usr/bin/env bash
# Keeps a contract-phase migration from running until every release a rollback
# could return to can read what it leaves behind (D-230).
#
# A migration marked `-- fluxradar:contract-phase` drops or renames something an
# older release still reads. The rollback probe cannot stop one that ships too
# early: it runs AFTER `prisma migrate deploy`, and it checks only the release
# that is live. The server keeps an older release as well, and a rollback to it
# would then fail on its first query — with the schema already changed.
#
# So a contract migration names, one line each, the migrations a release must
# already ship for the change to be safe under it:
#
#   -- fluxradar:contract-requires 20260922100000_egress_locations
#
# A release "ships" a migration when its apps/api/prisma/migrations holds that
# directory. Migrations are never deleted, so every later release ships it too.
#
# Usage:
#
#   contract-phase-gate.sh before-migrate <app-dir> <release-id>
#     Run by pre-migration-snapshot.sh in the backup stage, before anything is
#     migrated. Every contract migration the new release carries must have its
#     prerequisites shipped by every release that can be rolled back to once
#     this deploy completes: the live release (`current`), the target it
#     recorded in runtime/rollback.env, and the two newest other release
#     directories — the ones the release script's pruning keeps.
#
#   contract-phase-gate.sh rollback-target <app-dir> <target-release-dir>
#     Run by hand before putting an arbitrary release back — one that is not
#     the target rollback-release.sh would pick. For every contract migration any release on the
#     server carries and the target does not, the target must ship its
#     prerequisites. This is the case the deploy cannot cover: a contract
#     deploy that failed AFTER migrating never pruned, so an older release is
#     still on disk, with its image, next to a schema it cannot read.
#
# Exit: 0 — safe; 1 — refused, with every reason (nothing was changed);
#       2 — usage error.
#
# Fails CLOSED: a contract migration that names no prerequisite, a candidate
# that cannot be found, a migrations directory that cannot be read — each
# refuses. Portable (GNU and BSD userland): DEPLOY-018 runs it on developer
# machines.

set -uo pipefail
# Not `-e`: every failure below is decided explicitly.

MIGRATIONS_SUBPATH="apps/api/prisma/migrations"
CONTRACT_MARKER='fluxradar:contract-phase'

usage() {
  echo 'usage: contract-phase-gate.sh before-migrate <app-dir> <release-id>' >&2
  echo '       contract-phase-gate.sh rollback-target <app-dir> <target-release-dir>' >&2
  exit 2
}

# Contract-phase migrations a release carries, one name per line.
# Returns 1 when that cannot be told. A release with no migrations directory
# has nothing to migrate, so it carries none; one that cannot be read is doubt.
contract_migrations() {
  local dir="$1/$MIGRATIONS_SUBPATH" entry status
  [ -e "$dir" ] || return 0
  if [ ! -d "$dir" ] || [ ! -r "$dir" ] || [ ! -x "$dir" ]; then
    return 1
  fi
  for entry in "$dir"/*/; do
    [ -d "$entry" ] || continue
    [ -r "$entry/migration.sql" ] || return 1
    grep -q "$CONTRACT_MARKER" "$entry/migration.sql"
    status=$?
    case "$status" in
      0) basename "$entry" ;;
      1) ;;
      *) return 1 ;;
    esac
  done
}

# The migrations a contract migration requires, one name per line.
requirements() {
  sed -n -E 's/^--[[:space:]]*fluxradar:contract-requires[[:space:]]+([^[:space:]]+).*$/\1/p' "$1"
}

ships() {
  [ -d "$1/$MIGRATIONS_SUBPATH/$2" ]
}

# The release runtime/rollback.env names, or nothing.
recorded_rollback_target() {
  local file="$1/runtime/rollback.env"
  [ -f "$file" ] || return 0
  sed -n 's/^FLUXRADAR_ROLLBACK_RELEASE=//p' "$file" | tail -n 1 | sed -e 's/^"//' -e 's/"$//'
}

# Physical path of a release directory, or nothing when it is not there.
resolve() {
  (cd "$1" 2>/dev/null && pwd -P)
}

# Appends one line per prerequisite of <migration> (in <source>) that
# <candidate> does not ship, and a line when there is none to check.
unmet_for() {
  local source="$1" migration="$2" candidate="$3" required found=""
  while IFS= read -r required; do
    [ -n "$required" ] || continue
    found=1
    if ! ships "$candidate" "$required"; then
      echo "$migration requires $required, which ${candidate##*/} does not ship"
    fi
  done < <(requirements "$source/$MIGRATIONS_SUBPATH/$migration/migration.sql")
  if [ -z "$found" ]; then
    echo "$migration is contract-phase but names no prerequisite (-- fluxradar:contract-requires <migration>)"
  fi
}

refuse() {
  echo "REFUSED: the contract-phase gate (D-230) found:" >&2
  printf '%s\n' "$1" | LC_ALL=C sort -u | sed 's/^/  - /' >&2
  echo "$2" >&2
  exit 1
}

before_migrate() {
  local app_dir="$1" release_id="$2"
  local release_dir="$app_dir/releases/$release_id"
  local contracts candidates="" problems="" live target candidate migration dir count=0

  if [ ! -L "$app_dir/current" ] && [ ! -e "$app_dir/current" ]; then
    echo "Contract-phase gate: first deploy, there is no release to roll back to."
    return 0
  fi
  if ! contracts="$(contract_migrations "$release_dir")"; then
    refuse "the migrations of $release_id could not be read" \
      "Refusing to migrate: whether this release carries a contract-phase migration cannot be told."
  fi
  if [ -z "$contracts" ]; then
    echo "Contract-phase gate: $release_id carries no contract-phase migration."
    return 0
  fi

  live="$(resolve "$app_dir/current")"
  [ -n "$live" ] || problems+="the live release ($app_dir/current) cannot be resolved"$'\n'
  target="$(recorded_rollback_target "$app_dir")"
  if [ -z "$target" ]; then
    problems+="runtime/rollback.env names no rollback target, so the release before the live one cannot be checked"$'\n'
  elif [ -z "$(resolve "$target")" ]; then
    problems+="the recorded rollback target $target is not on this server"$'\n'
  else
    target="$(resolve "$target")"
  fi
  [ -z "$live" ] || candidates+="$live"$'\n'
  [ -z "$target" ] || [ ! -d "$target" ] || candidates+="$target"$'\n'
  # The two newest other directories are what pruning keeps beside this release.
  while IFS= read -r dir; do
    dir="$(resolve "$dir")"
    [ -n "$dir" ] || continue
    [ "$dir" = "$(resolve "$release_dir")" ] && continue
    candidates+="$dir"$'\n'
    count=$((count + 1))
    [ "$count" -lt 2 ] || break
  done < <(ls -1td "$app_dir"/releases/*/ 2>/dev/null)

  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    for migration in $contracts; do
      problems+="$(unmet_for "$release_dir" "$migration" "$candidate")"$'\n'
    done
  done < <(printf '%s' "$candidates" | LC_ALL=C sort -u)

  problems="$(printf '%s' "$problems" | sed '/^$/d')"
  if [ -n "$problems" ]; then
    refuse "$problems" \
      "Refusing to migrate. Deploy a release that ships the prerequisite and let it become the rollback target first; this gate then passes on the next deploy."
  fi
  echo "Contract-phase gate: every rollback candidate ships what $(printf '%s\n' "$contracts" | tr '\n' ' ')requires."
}

rollback_target() {
  local app_dir="$1" target
  target="$(resolve "$2")"
  local release contracts migration problems=""
  if [ -z "$target" ] || [ ! -d "$target/$MIGRATIONS_SUBPATH" ]; then
    refuse "$2 is not a release directory with $MIGRATIONS_SUBPATH" "Refusing: nothing was changed."
  fi
  for release in "$app_dir"/releases/*/; do
    [ -d "$release" ] || continue
    release="$(resolve "$release")"
    if ! contracts="$(contract_migrations "$release")"; then
      problems+="the migrations of ${release##*/} could not be read"$'\n'
      continue
    fi
    for migration in $contracts; do
      ships "$target" "$migration" && continue
      problems+="$(unmet_for "$release" "$migration" "$target")"$'\n'
    done
  done
  problems="$(printf '%s' "$problems" | sed '/^$/d')"
  if [ -n "$problems" ]; then
    refuse "$problems" \
      "Refusing: ${target##*/} cannot run against a schema those migrations may already have changed. Nothing was changed; choose a newer release."
  fi
  echo "Contract-phase gate: ${target##*/} can be rolled back to."
}

[ "$#" -eq 3 ] || usage
case "$1" in
  before-migrate) before_migrate "$2" "$3" ;;
  rollback-target) rollback_target "$2" "$3" ;;
  *) usage ;;
esac
