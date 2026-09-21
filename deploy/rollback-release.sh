#!/usr/bin/env bash
# Puts a previous release back in front of production traffic — and says out
# loud whether it managed to.
#
# WHY THIS IS A FILE AND NOT A FUNCTION IN deploy.yml
#
# A rollback is needed from two places, and they cannot share a shell:
#
#   1. the release script's exit handler, when a step AFTER the traffic switch
#      fails while it is still running;
#   2. the workflow's public smoke test, which runs on the GitHub runner AFTER
#      that script has exited successfully. Its failure means the release is
#      live and broken — the exact case an in-script trap can no longer reach.
#
# Two copies of a rollback drift, and the copy that drifts is the one that only
# runs on the worst day. So both callers run THIS script, and DEPLOY-011 runs it
# directly against a recorded `docker`.
#
# WHAT IT REFUSES TO DO
#
# Never report a rollback it did not perform. The previous version of this logic
# was inline and guarded by `[ -f "$PREVIOUS_RELEASE/docker-compose.yml" ]`; when
# that file was absent — a pruned release directory, a dangling `current` — the
# whole rollback silently became a no-op while the deploy log said it had rolled
# back. Caddy kept the failed release's upstreams, whose containers had just been
# deleted, so "rolled back" meant a 502. Every path below either restores the
# target AND PROVES IT ANSWERS before printing ROLLBACK OK, or prints why it
# could not and exits non-zero.
#
# Never destroy the only release there is. Removing the failed release's
# containers is the first thing a rollback does — they run with
# `--restart unless-stopped` against the production database — but it is only
# right when there is another release to put back. On the first deploy of a host
# there is none, and doing it anyway turned "this release failed its smoke test"
# into "this host serves nothing at all". So the target is resolved BEFORE
# anything is touched, and a missing one changes nothing.
#
# Usage: rollback-release.sh <app-dir> [failed-release-dir]
#
# Exit codes, because the callers act on them (deploy.yml, both call sites):
#
#   0  ROLLBACK OK / ROLLBACK OK (DEGRADED) — the target is serving, proven.
#   1  ROLLBACK FAILED — it could not restore; production needs manual recovery.
#   2  usage error.
#   3  ROLLBACK IMPOSSIBLE — no target exists, so NOTHING was changed and the
#      release that failed is still whatever is in front of traffic.
#   4  NOTHING TO ROLL BACK — the release named as failed IS the recorded
#      target, so NOTHING was changed: a previous rollback already restored it,
#      or this was a redeploy of the commit that was already live.
#
# The target is read from <app-dir>/runtime/rollback.env, which the release
# script writes before it switches traffic. Run by hand to undo the release that
# is live now (docs/DEPLOYMENT.md, "Release rollback").

set -u

APP_DIR="${1:-}"
FAILED_RELEASE="${2:-}"

if [ -z "$APP_DIR" ]; then
  echo "usage: rollback-release.sh <app-dir> [failed-release-dir]" >&2
  exit 2
fi

RUNTIME_DIR="$APP_DIR/runtime"
STATE_FILE="$RUNTIME_DIR/active.env"
TARGET_FILE="$RUNTIME_DIR/rollback.env"

# Defaults first: the file is sourced under `set -u`, and an older release may
# have written fewer variables than this script reads.
FLUXRADAR_ROLLBACK_RELEASE=""
FLUXRADAR_ROLLBACK_RELEASE_ID=""
FLUXRADAR_ROLLBACK_API_UPSTREAM=""
FLUXRADAR_ROLLBACK_WEB_UPSTREAM=""
FLUXRADAR_ROLLBACK_API_CONTAINER=""
FLUXRADAR_ROLLBACK_WEB_CONTAINER=""
if [ -f "$TARGET_FILE" ]; then
  # shellcheck disable=SC1090
  . "$TARGET_FILE"
fi

TARGET_RELEASE="$FLUXRADAR_ROLLBACK_RELEASE"
TARGET_ID="$FLUXRADAR_ROLLBACK_RELEASE_ID"
if [ -z "$TARGET_ID" ] && [ -n "$TARGET_RELEASE" ]; then
  TARGET_ID="${TARGET_RELEASE##*/}"
fi

# BEFORE ANYTHING IS TOUCHED: is there something to roll back TO?
#
# This has to come first, and it did not. The removal below was unconditional,
# so on the first deploy of a host — where rollback.env exists but names no
# release, because there was none — a failed public smoke test removed the only
# API and web containers on the box and then exited 1. The deploy failed either
# way; the difference is that afterwards the host served nothing at all.
#
# A rollback with no target is not a rollback. It changes NOTHING, says so, and
# exits 3 so both callers can tell "there was nothing to restore, the release
# you deployed is still up" apart from "the restore was attempted and failed".
if [ -z "$TARGET_RELEASE" ]; then
  echo "ROLLBACK IMPOSSIBLE: $TARGET_FILE names no release to roll back to." >&2
  echo "That is the first deploy of this host, or the file was never written. NOTHING has been changed: ${FAILED_RELEASE:-the release that failed} keeps whatever containers and proxy configuration it had, because removing them would leave this host serving nothing at all." >&2
  echo "CRITICAL: manual action required. The release in front of traffic is the one that just failed its checks, and there is no earlier release on this host to restore — deploy a working release (docs/DEPLOYMENT.md, 'Release rollback')." >&2
  exit 3
fi

# BEFORE ANYTHING IS TOUCHED, part two: is the release being rolled back the very
# release a rollback would restore?
#
# runtime/rollback.env records ONE step back, and nothing rewrites it after a
# rollback. So once a rollback has run, `current` IS the recorded target, and a
# second rollback named the live release as the failed one. It then did to it
# exactly what it does to a failed release: `docker rm -f` on the containers
# serving production, a recreate from the same image, and ROLLBACK OK after up to
# a minute of downtime. The likeliest way here is an operator pressing "Roll back
# production" after a deploy that had already rolled itself back; a redeploy of
# the commit that is already live arrives at the same state from the other side.
#
# There is nothing further back to go to, so NOTHING is changed.
failed_id="${FAILED_RELEASE%/}"
failed_id="${failed_id##*/}"
if [ -n "$failed_id" ] && [ "$failed_id" = "$TARGET_ID" ]; then
  echo "NOTHING TO ROLL BACK: $TARGET_ID is both the release named as failed and the recorded rollback target." >&2
  echo "$TARGET_FILE records one step back and a previous rollback has already taken it (or this was a redeploy of the live commit). NOTHING has been changed; $TARGET_ID keeps whatever containers and proxy configuration it had." >&2
  echo "To go further back, deploy a known-good commit (docs/DEPLOYMENT.md, 'Release rollback')." >&2
  exit 4
fi

# From here a target exists, so the failed release is genuinely being replaced
# and its containers go first, whatever else this script can do. They run with
# `--restart unless-stopped` against the production database, so leaving them up
# means a release that is being rolled back keeps claiming jobs and sending
# customer email.
if [ -n "$FAILED_RELEASE" ]; then
  docker rm -f "fluxradar-api-$failed_id" "fluxradar-web-$failed_id" >/dev/null 2>&1 || true
  docker rm -f "fluxradar-rollback-probe-$failed_id" >/dev/null 2>&1 || true
fi

# Which docker-compose.yml, .env.production and Caddyfile template the rollback
# can work from. The target's own copies are the right ones; when its directory
# has been pruned they are gone, and the failed release's copies are used instead
# so the target's containers still get traffic back. That is a compromise — the
# proxy config is one release newer than the containers behind it — and it is
# reported as such, because the alternative is leaving Caddy pointed at
# containers that were just deleted.
compose_dir=""
caddy_template=""
degraded=0
if [ -f "$TARGET_RELEASE/docker-compose.yml" ] && [ -f "$TARGET_RELEASE/.env.production" ]; then
  compose_dir="$TARGET_RELEASE"
fi
if [ -f "$TARGET_RELEASE/deploy/Caddyfile" ]; then
  caddy_template="$TARGET_RELEASE/deploy/Caddyfile"
fi
if [ -z "$compose_dir" ] || [ -z "$caddy_template" ]; then
  degraded=1
  echo "WARNING: the rollback target $TARGET_RELEASE no longer holds docker-compose.yml, .env.production and deploy/Caddyfile." >&2
  if [ -n "$FAILED_RELEASE" ]; then
    if [ -z "$compose_dir" ] \
      && [ -f "$FAILED_RELEASE/docker-compose.yml" ] \
      && [ -f "$FAILED_RELEASE/.env.production" ]; then
      compose_dir="$FAILED_RELEASE"
    fi
    if [ -z "$caddy_template" ] && [ -f "$FAILED_RELEASE/deploy/Caddyfile" ]; then
      caddy_template="$FAILED_RELEASE/deploy/Caddyfile"
    fi
    echo "Falling back to $FAILED_RELEASE's copies so the previous release's containers get traffic back." >&2
  fi
fi
if [ -z "$compose_dir" ] || [ -z "$caddy_template" ]; then
  echo "ROLLBACK FAILED: neither the rollback target nor the failed release provides the docker-compose.yml, .env.production and deploy/Caddyfile a rollback needs." >&2
  echo "Production is still proxied to the failed release, whose containers were removed. Restore $APP_DIR/current by hand (docs/DEPLOYMENT.md, 'Release rollback')." >&2
  exit 1
fi

# Same semantics as the release script's own render_caddyfile: the runtime file
# is bind-mounted into Caddy, so an existing one is REWRITTEN IN PLACE and never
# replaced, which would break the mount.
render_caddyfile() {
  awk -v api="$1" -v web="$2" '{
    gsub(/\{\$FLUXRADAR_API_UPSTREAM\}/, api)
    gsub(/\{\$FLUXRADAR_WEB_UPSTREAM\}/, web)
    print
  }' "$3" > "$RUNTIME_DIR/Caddyfile.next" || return 1
  if [ -f "$RUNTIME_DIR/Caddyfile" ]; then
    cat "$RUNTIME_DIR/Caddyfile.next" > "$RUNTIME_DIR/Caddyfile" || return 1
    rm -f "$RUNTIME_DIR/Caddyfile.next"
  else
    mv -f "$RUNTIME_DIR/Caddyfile.next" "$RUNTIME_DIR/Caddyfile" || return 1
  fi
  chmod 644 "$RUNTIME_DIR/Caddyfile"
}

# Runs the target release's container again when it is gone.
#
# It is gone on exactly the path this script exists for: a successful release
# script removes the previous containers, and the public smoke test fails after
# that. `docker start` covers a stopped container; `docker run` recreates one
# that was removed, from the image the rollback gate proved is still on the host.
ensure_container() {
  name="$1"
  shift
  if docker container inspect "$name" >/dev/null 2>&1; then
    if [ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null)" = "true" ]; then
      return 0
    fi
    docker start "$name" >/dev/null && return 0
    echo "ROLLBACK: could not start the existing container $name; recreating it." >&2
    docker rm -f "$name" >/dev/null 2>&1 || true
  fi
  docker run -d --name "$name" --restart unless-stopped --network-alias "$name" "$@" >/dev/null
}

api_upstream=""
web_upstream=""
state_api_container="$FLUXRADAR_ROLLBACK_API_CONTAINER"
state_web_container="$FLUXRADAR_ROLLBACK_WEB_CONTAINER"
if [ -n "$TARGET_ID" ] \
  && docker image inspect "fluxradar-api:$TARGET_ID" >/dev/null 2>&1 \
  && docker image inspect "fluxradar-web:$TARGET_ID" >/dev/null 2>&1; then
  postgres_container="$(cd "$compose_dir" && docker compose --env-file .env.production -p fluxradar ps -q postgres 2>/dev/null || true)"
  network=""
  if [ -n "$postgres_container" ]; then
    network="$(docker inspect --format '{{range $network, $_ := .NetworkSettings.Networks}}{{println $network}}{{end}}' "$postgres_container" 2>/dev/null | awk 'NF { print; exit }')"
  fi
  if [ -z "$network" ]; then
    echo "ROLLBACK FAILED: the application's Docker network could not be determined, so the previous release's containers cannot be attached to it." >&2
    exit 1
  fi
  # The FAILED release's env file, not the target's own, whenever it is there.
  #
  # That is the file the deploy's rollback compatibility gate started this exact
  # image against, before any traffic moved: it proved the previous release
  # boots on it and can read the migrated database. The target's own env file is
  # what it ran on before the deploy — historically fine, but never checked
  # against the schema the migration has since produced. Prefer the verified one.
  api_env_file="$compose_dir/.env.production"
  if [ -n "$FAILED_RELEASE" ] && [ -f "$FAILED_RELEASE/.env.production" ]; then
    api_env_file="$FAILED_RELEASE/.env.production"
  fi
  ensure_container "fluxradar-api-$TARGET_ID" \
    --network "$network" \
    --env-file "$api_env_file" \
    --env NODE_ENV=production \
    --env PORT=3310 \
    --env FRONTEND_ORIGIN=https://fluxradar.net \
    "fluxradar-api:$TARGET_ID" \
    || { echo "ROLLBACK FAILED: the previous release's API container could not be started." >&2; exit 1; }
  ensure_container "fluxradar-web-$TARGET_ID" \
    --network "$network" \
    "fluxradar-web:$TARGET_ID" \
    || { echo "ROLLBACK FAILED: the previous release's web container could not be started." >&2; exit 1; }
  # Docker's user-defined network resolves container names and aliases. Keep
  # the rollback on those stable identities rather than recording an
  # ephemeral IP that can become stale as soon as a container is recreated.
  api_upstream="fluxradar-api-$TARGET_ID:3310"
  web_upstream="fluxradar-web-$TARGET_ID:80"
  state_api_container="fluxradar-api-$TARGET_ID"
  state_web_container="fluxradar-web-$TARGET_ID"
fi

if [ -z "$api_upstream" ] || [ -z "$web_upstream" ]; then
  api_upstream="$FLUXRADAR_ROLLBACK_API_UPSTREAM"
  web_upstream="$FLUXRADAR_ROLLBACK_WEB_UPSTREAM"
fi
if { [ -z "$api_upstream" ] || [ -z "$web_upstream" ]; } && [ "$degraded" -eq 0 ]; then
  # A release from before the per-release container naming: it is served by the
  # compose services, which Caddy reaches by service name.
  api_upstream="api:3310"
  web_upstream="web:80"
fi
if [ -z "$api_upstream" ] || [ -z "$web_upstream" ]; then
  echo "ROLLBACK FAILED: the upstreams of the rollback target are unknown — its images are not on this host and $TARGET_FILE records none." >&2
  echo "Production is still proxied to the failed release, whose containers were removed. Restore $APP_DIR/current by hand (docs/DEPLOYMENT.md, 'Release rollback')." >&2
  exit 1
fi

if ! render_caddyfile "$api_upstream" "$web_upstream" "$caddy_template"; then
  echo "ROLLBACK FAILED: the runtime Caddyfile could not be rewritten for the previous release." >&2
  exit 1
fi
if ! cd "$compose_dir"; then
  echo "ROLLBACK FAILED: $compose_dir is not usable as the compose project directory." >&2
  exit 1
fi
export FLUXRADAR_CADDYFILE="$RUNTIME_DIR/Caddyfile"
export FLUXRADAR_API_UPSTREAM="$api_upstream"
export FLUXRADAR_WEB_UPSTREAM="$web_upstream"
if ! docker compose --env-file .env.production -p fluxradar up -d --no-deps --force-recreate caddy; then
  echo "ROLLBACK FAILED: Caddy could not be recreated on the previous release's upstreams." >&2
  echo "Production is not being served. Restore it by hand (docs/DEPLOYMENT.md, 'Release rollback')." >&2
  exit 1
fi
# Proof rather than assumption: the file Caddy was just started on has to name
# the upstreams this rollback chose.
if ! grep -Fq "$api_upstream" "$RUNTIME_DIR/Caddyfile" \
  || ! grep -Fq "$web_upstream" "$RUNTIME_DIR/Caddyfile"; then
  echo "ROLLBACK FAILED: the restored Caddyfile does not name the previous release's upstreams." >&2
  exit 1
fi

# READINESS PROOF — the difference between "Caddy was reconfigured" and "the
# previous release is serving again".
#
# Everything above proves what this script DID: containers were started, the
# runtime Caddyfile names the upstreams it chose, Caddy came back up on it. None
# of that proves anything ANSWERS. Reproduced with the target's images missing
# and no recorded upstreams, the script fell through to the legacy compose
# service names, rewrote Caddy to a dead `api:3310` / `web:80` and printed
# ROLLBACK OK — the same silent lie the file exists to prevent, one layer down.
#
# So the restored release is asked, with bounded retries, from the host itself:
#
#   * each restored container, over its own loopback, using exactly the readiness
#     probes the release script runs on a new release (a database-aware
#     /health/ready for the API, /health for web). Skipped only when this
#     rollback does not know a container name — the legacy compose-service path,
#     which the proxy probe below still covers.
#   * the public hostname THROUGH Caddy, resolved to 127.0.0.1, which is the same
#     loopback wiring check the release script makes after its own traffic
#     switch. `--insecure` for the same reason it uses it there: the certificate
#     is the public smoke test's job, and ACME may still be issuing. What is
#     being asked here is whether the proxy reaches a live upstream at all.
#
# Nothing here talks to anything off this host, so it runs wherever the rollback
# runs. If it cannot be proven, this is a FAILED rollback and says so: production
# is not being served by the previous release, whatever the Caddyfile says.
PUBLIC_HOST="${FLUXRADAR_PUBLIC_HOST:-fluxradar.net}"
# The same window the release script gives a NEW release to become ready
# (30 attempts, two seconds apart). A restored container boots exactly like one,
# so a tighter bound here would call a rollback failed while it was still
# starting — and this is the one place a false negative is expensive.
PROBE_ATTEMPTS="${FLUXRADAR_ROLLBACK_PROBE_ATTEMPTS:-30}"
PROBE_DELAY="${FLUXRADAR_ROLLBACK_PROBE_DELAY:-2}"

probe_api_container() {
  [ -n "$state_api_container" ] || return 0
  docker exec "$state_api_container" \
    node -e "fetch('http://127.0.0.1:3310/health/ready').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))" \
    >/dev/null 2>&1
}

probe_web_container() {
  [ -n "$state_web_container" ] || return 0
  docker exec "$state_web_container" wget -q -O /dev/null http://127.0.0.1/health >/dev/null 2>&1
}

probe_api_through_caddy() {
  curl --fail --silent --show-error --location --insecure \
    --resolve "$PUBLIC_HOST:443:127.0.0.1" "https://$PUBLIC_HOST/api/health" 2>/dev/null \
    | grep -q '"status":"ok"'
}

probe_web_through_caddy() {
  curl --fail --silent --show-error --location --insecure \
    --resolve "$PUBLIC_HOST:443:127.0.0.1" --output /dev/null "https://$PUBLIC_HOST/" 2>/dev/null
}

restored_release_answers() {
  attempt=1
  while [ "$attempt" -le "$PROBE_ATTEMPTS" ]; do
    if probe_api_container && probe_web_container \
      && probe_api_through_caddy && probe_web_through_caddy; then
      return 0
    fi
    attempt=$((attempt + 1))
    if [ "$attempt" -le "$PROBE_ATTEMPTS" ]; then
      sleep "$PROBE_DELAY"
    fi
  done
  return 1
}

if ! restored_release_answers; then
  echo "ROLLBACK FAILED: Caddy was reconfigured onto $api_upstream / $web_upstream, but the restored release did not answer a readiness probe within $((PROBE_ATTEMPTS * PROBE_DELAY))s." >&2
  echo "CRITICAL: production is NOT being served by ${TARGET_ID:-the previous release}. Its containers or images may be gone, or the recorded upstreams may be stale." >&2
  echo "$APP_DIR/current and $STATE_FILE were left untouched so they still describe the release that was live. Recover by hand (docs/DEPLOYMENT.md, 'Release rollback')." >&2
  exit 1
fi

# `current` and the state file are bookkeeping for the NEXT deploy, so they are
# repointed after traffic is back — and only once it has been PROVEN back, so a
# rollback that could not restore service never leaves state claiming it did.
# A failure here is reported but does not turn a restored production into a
# failed rollback.
ln -sfn "$TARGET_RELEASE" "$APP_DIR/current.next" 2>/dev/null \
  && mv -Tf "$APP_DIR/current.next" "$APP_DIR/current" 2>/dev/null
if [ "$(readlink -f "$APP_DIR/current" 2>/dev/null || true)" != "$TARGET_RELEASE" ]; then
  echo "WARNING: $APP_DIR/current could not be repointed at $TARGET_RELEASE; the next deploy would take the wrong rollback target. Fix the symlink by hand." >&2
  rm -f "$APP_DIR/current.next"
fi

cat > "$STATE_FILE" <<STATE
FLUXRADAR_ACTIVE_RELEASE=$TARGET_RELEASE
FLUXRADAR_API_UPSTREAM=$api_upstream
FLUXRADAR_WEB_UPSTREAM=$web_upstream
FLUXRADAR_API_CONTAINER=$state_api_container
FLUXRADAR_WEB_CONTAINER=$state_web_container
STATE
chmod 600 "$STATE_FILE"

if [ "$degraded" -eq 1 ]; then
  echo "ROLLBACK OK (DEGRADED): ${TARGET_ID:-the previous release} is serving again, through the failed release's proxy configuration. Restore its release directory before the next deploy."
else
  echo "ROLLBACK OK: ${TARGET_ID:-the previous release} is serving again on $api_upstream / $web_upstream."
fi
