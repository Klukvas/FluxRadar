#!/usr/bin/env bash
# The release itself: migrate, prove a rollback is possible, start the new
# containers, switch traffic, check the result — and roll back any failure that
# happens after the switch.
#
# Run ON THE SERVER by the `release` stage of deploy.yml, from the release
# directory the `package` stage extracted:
#
#   bash "$APP_DIR/releases/$RELEASE_ID/deploy/release.sh" \
#     "$APP_DIR" "$RELEASE_ID" "$ALLOW_UNVERIFIED_ROLLBACK"
#
# It lived inline in deploy.yml as a heredoc, which kept it out of shellcheck,
# out of the editor's bash mode and — at 540 lines — put the workflow past the
# 800-line ceiling in ~/.claude/rules. It ships with the release for the same
# reason rollback-release.sh does: the copy that runs is exactly the copy that
# was reviewed and tested for this commit.
#
# Everything between the markers below is extracted and RUN by DEPLOY-001,
# DEPLOY-006 and DEPLOY-010 against a recorded `docker`; keep the markers.
# fluxradar:release-script (regression-tested by
# apps/api/src/deploy/deploy-010-post-switch-rollback.test.ts — keep the
# markers, the test extracts these lines and RUNS them against a
# recorded `docker`, failing one step at a time)
set -eu
set -o pipefail
APP_DIR="$1"
RELEASE_ID="$2"
ALLOW_UNVERIFIED_ROLLBACK="$3"
RELEASE_DIR="$APP_DIR/releases/$RELEASE_ID"
RUNTIME_DIR="$APP_DIR/runtime"
STATE_FILE="$RUNTIME_DIR/active.env"
FLUXRADAR_NETWORK=""
# fluxradar:rollback-target-detection (regression-tested by
# apps/api/src/deploy/deploy-001-rollback-target-detection.test.ts —
# keep the markers, the test extracts and runs exactly these lines)
# `readlink -f` resolves a path whose LAST component does not exist, so
# on a first deploy it still prints "$APP_DIR/current" and the rollback
# gate below would look for the image "fluxradar-api:current". Existence
# decides instead: -L catches a symlink (including a dangling one, which
# is a real rollback target whose release directory is gone, never a
# first deploy), -e catches a plain directory.
PREVIOUS_RELEASE=""
PREVIOUS_RELEASE_ID=""
if [ -L "$APP_DIR/current" ] || [ -e "$APP_DIR/current" ]; then
  PREVIOUS_RELEASE="$(readlink -f "$APP_DIR/current" 2>/dev/null || true)"
  if [ -z "$PREVIOUS_RELEASE" ]; then
    # Fail closed: `current` exists, so a rollback target exists too, and
    # continuing would silently deploy without the safety gate below.
    echo "ERROR: $APP_DIR/current exists but could not be resolved to a release directory." >&2
    exit 1
  fi
  PREVIOUS_RELEASE_ID="${PREVIOUS_RELEASE##*/}"
fi
# fluxradar:end-rollback-target-detection
API_IMAGE="fluxradar-api:$RELEASE_ID"
WEB_IMAGE="fluxradar-web:$RELEASE_ID"
PREVIOUS_API_UPSTREAM=""
PREVIOUS_WEB_UPSTREAM=""
PREVIOUS_API_CONTAINER=""
PREVIOUS_WEB_CONTAINER=""
LEGACY_API_CONTAINER=""
LEGACY_WEB_CONTAINER=""
if [ -f "$STATE_FILE" ]; then
  . "$STATE_FILE"
  PREVIOUS_API_UPSTREAM="${FLUXRADAR_API_UPSTREAM:-}"
  PREVIOUS_WEB_UPSTREAM="${FLUXRADAR_WEB_UPSTREAM:-}"
  PREVIOUS_API_CONTAINER="${FLUXRADAR_API_CONTAINER:-}"
  PREVIOUS_WEB_CONTAINER="${FLUXRADAR_WEB_CONTAINER:-}"
fi
if [ -z "$PREVIOUS_API_UPSTREAM" ] && [ -n "$PREVIOUS_RELEASE" ]; then
  cd "$PREVIOUS_RELEASE"
  LEGACY_API_CONTAINER="$(docker compose --env-file .env.production -p fluxradar ps -q api 2>/dev/null || true)"
  LEGACY_WEB_CONTAINER="$(docker compose --env-file .env.production -p fluxradar ps -q web 2>/dev/null || true)"
fi

API_CONTAINER="fluxradar-api-$RELEASE_ID"
WEB_CONTAINER="fluxradar-web-$RELEASE_ID"
ROLLBACK_PROBE="fluxradar-rollback-probe-$RELEASE_ID"
NEW_API_UPSTREAM=""
NEW_WEB_UPSTREAM=""
# The two facts the exit handler decides everything from.
#
# TRAFFIC_SWITCHED flips to 1 at the moment the runtime Caddyfile is
# rewritten for this release; from then on production is being served
# by it, so ANY later failure has to put the previous release back. A
# failure BEFORE that point must not touch Caddy, `current` or the
# state file at all: the previous release is still serving, and
# "rolling back" to it would only recreate its proxy for nothing.
TRAFFIC_SWITCHED=0
DEPLOY_COMPLETED=0

atomic_switch() {
  ln -sfn "$1" "$APP_DIR/current.next"
  mv -Tf "$APP_DIR/current.next" "$APP_DIR/current"
}

render_caddyfile() {
  awk -v api="$1" -v web="$2" '{
    gsub(/\{\$FLUXRADAR_API_UPSTREAM\}/, api)
    gsub(/\{\$FLUXRADAR_WEB_UPSTREAM\}/, web)
    print
  }' "$3" > "$RUNTIME_DIR/Caddyfile.next"
  if [ -f "$RUNTIME_DIR/Caddyfile" ]; then
    cat "$RUNTIME_DIR/Caddyfile.next" > "$RUNTIME_DIR/Caddyfile"
    rm -f "$RUNTIME_DIR/Caddyfile.next"
  else
    mv -f "$RUNTIME_DIR/Caddyfile.next" "$RUNTIME_DIR/Caddyfile"
  fi
  chmod 644 "$RUNTIME_DIR/Caddyfile"
}

# Records the release a rollback goes back to, and everything a
# rollback needs to find it. Written BEFORE the traffic switch, and
# deliberately left in place afterwards: the public smoke test runs on
# the GitHub runner after THIS script has exited, so the only rollback
# available to it is one driven from a file on the server.
record_rollback_target() {
  cat > "$RUNTIME_DIR/rollback.env" <<TARGET
FLUXRADAR_ROLLBACK_RELEASE=$PREVIOUS_RELEASE
FLUXRADAR_ROLLBACK_RELEASE_ID=$PREVIOUS_RELEASE_ID
FLUXRADAR_ROLLBACK_API_UPSTREAM=$PREVIOUS_API_UPSTREAM
FLUXRADAR_ROLLBACK_WEB_UPSTREAM=$PREVIOUS_WEB_UPSTREAM
FLUXRADAR_ROLLBACK_API_CONTAINER=$PREVIOUS_API_CONTAINER
FLUXRADAR_ROLLBACK_WEB_CONTAINER=$PREVIOUS_WEB_CONTAINER
TARGET
  chmod 600 "$RUNTIME_DIR/rollback.env"
}

# Pre-switch cleanup. A rollback removes the same containers itself,
# inside deploy/rollback-release.sh, so it works from the runner too.
#
# The new containers run with `--restart unless-stopped`, so a deploy
# that fails and simply exits leaves them running against the
# production database — claiming jobs, sending customer email and
# sweeping retention from a release that was never released. Removing
# them touches nothing that serves traffic.
discard_new_containers() {
  docker rm -f "$API_CONTAINER" "$WEB_CONTAINER" >/dev/null 2>&1 || true
  docker rm -f "$ROLLBACK_PROBE" >/dev/null 2>&1 || true
}

# The rollback itself is deploy/rollback-release.sh, which ships with
# the release; see that file for why it is not a function here (the
# public smoke test needs the same rollback after this script exits).
#
# It removes the failed release's containers itself, restores the
# previous one — recreating its containers when they are gone, and
# proving they answer before it reports success — and exits NON-ZERO
# when it could not. The version this replaced was guarded by
# `[ -f "$PREVIOUS_RELEASE/docker-compose.yml" ]` and silently did
# nothing when that file was absent, while the log above said the
# release had been rolled back.
#
# Its exit code carries the outcome: 0 restored, 3 there was no target
# so NOTHING was touched, anything else attempted and failed.
rollback() {
  set +e
  bash "$RELEASE_DIR/deploy/rollback-release.sh" "$APP_DIR" "$RELEASE_DIR"
}

# Prints why a container is unhealthy without leaking configuration.
# Uses an explicit field list from `docker inspect` (never .Config.Env)
# plus the container's own log output, which carries the startup error
# (e.g. "Missing required production configuration: ...") but no secret
# values. Bounded to the last log lines so the deploy log stays readable.
dump_container_diagnostics() {
  container_name="$1"
  echo "----- diagnostics: $container_name -----"
  docker inspect \
    --format 'status={{.State.Status}} running={{.State.Running}} restarting={{.State.Restarting}} exitCode={{.State.ExitCode}} oomKilled={{.State.OOMKilled}} restartCount={{.RestartCount}} error={{.State.Error}}' \
    "$container_name" 2>/dev/null || echo "container not found: $container_name"
  echo "----- last 80 log lines: $container_name -----"
  docker logs --tail 80 "$container_name" 2>&1 || echo "no logs available: $container_name"
  echo "----- end diagnostics: $container_name -----"
}
# The single exit path of this script: it decides, from the phase the
# deploy reached, whether a failure must roll back or must NOT.
#
# It is an EXIT trap and not an ERR trap because an ERR trap misses
# exactly the failures that matter here, and both gaps were real:
#
#   * `exit 1` never raises ERR, so every explicit failure after the
#     traffic switch — Caddy never came up, the generated Caddyfile
#     did not name the new upstreams, `caddy validate` refused it —
#     left the new, broken release in front of traffic.
#   * Without `set -E` an ERR trap is not inherited by shell
#     functions, so a failure inside ensure_network_attachment,
#     render_caddyfile or atomic_switch killed the script through
#     errexit WITHOUT running the trap at all.
#
# An EXIT trap has neither gap: it runs on errexit, on an explicit
# `exit`, and on a failure inside a function.
on_exit() {
  status=$?
  trap - EXIT
  # errexit inside the handler would abandon a half-done rollback.
  set +e
  # Past DEPLOY_COMPLETED the release is live, recorded, and has
  # already passed every check this script makes. Only bookkeeping is
  # left, so nothing from here rolls production back: a disk-retention
  # failure is reported and the release keeps serving.
  if [ "$DEPLOY_COMPLETED" -eq 1 ]; then
    if [ "$status" -ne 0 ]; then
      echo "ERROR: the release is live and recorded, but the retention sweep after it failed (status $status). Nothing was rolled back; free disk space on the server by hand." >&2
    fi
    exit "$status"
  fi
  # Stopping early without a failing status is still a failed deploy.
  if [ "$status" -eq 0 ]; then
    status=1
  fi
  if [ "$TRAFFIC_SWITCHED" -eq 1 ]; then
    echo "ERROR: the deploy failed AFTER traffic was switched to $RELEASE_ID; rolling back to ${PREVIOUS_RELEASE_ID:-nothing (first deploy)}." >&2
    rollback
    rollback_status=$?
    if [ "$rollback_status" -eq 0 ]; then
      echo "The previous release is serving again; this deploy failed without leaving a broken release live." >&2
    elif [ "$rollback_status" -eq 3 ]; then
      # First deploy: there is no earlier release, so the rollback
      # deliberately changed nothing. Tearing $RELEASE_ID down here
      # would turn a failed deploy into a host that serves nothing —
      # which is exactly what it used to do.
      echo "CRITICAL: there is no earlier release on this host to roll back to, so nothing was torn down and $RELEASE_ID is still in front of traffic after failing this deploy. Production needs manual attention: deploy a working release (docs/DEPLOYMENT.md, 'Release rollback')." >&2
    elif [ "$rollback_status" -eq 4 ]; then
      # A redeploy of the commit that was already live: the recorded
      # target IS this release, so there is no different one to put
      # back, and the rollback deliberately changed nothing.
      echo "CRITICAL: $RELEASE_ID is also the recorded rollback target (a redeploy of the live commit), so there is no different release to go back to and nothing was changed. It is still in front of traffic after failing this deploy. Deploy a known-good commit (docs/DEPLOYMENT.md, 'Release rollback')." >&2
    else
      echo "CRITICAL: the rollback did NOT restore a serving release. Production needs manual recovery (docs/DEPLOYMENT.md, 'Release rollback')." >&2
    fi
  else
    echo "ERROR: the deploy failed BEFORE any traffic was switched; the previous release keeps serving and nothing is rolled back." >&2
    discard_new_containers
  fi
  exit "$status"
}
trap on_exit EXIT

mkdir -p "$RUNTIME_DIR"
cd "$RELEASE_DIR"
docker compose --env-file .env.production -p fluxradar up -d postgres
POSTGRES_CONTAINER="$(docker compose --env-file .env.production -p fluxradar ps -q postgres)"
if [ -z "$POSTGRES_CONTAINER" ]; then
  echo "PostgreSQL container was not created; cannot determine the application network" >&2
  exit 1
fi
FLUXRADAR_NETWORK="$(docker inspect --format '{{range $network, $_ := .NetworkSettings.Networks}}{{println $network}}{{end}}' "$POSTGRES_CONTAINER" | awk 'NF { print; exit }')"
if [ -z "$FLUXRADAR_NETWORK" ]; then
  echo "Could not determine the Docker network attached to PostgreSQL" >&2
  exit 1
fi
ensure_network_attachment() {
  container_name="$1"
  if ! docker inspect --format '{{range $network, $_ := .NetworkSettings.Networks}}{{println $network}}{{end}}' "$container_name" \
    | grep -Fxq "$FLUXRADAR_NETWORK"; then
    docker network connect "$FLUXRADAR_NETWORK" "$container_name"
  fi
}
docker run --rm \
  --name "${API_CONTAINER}-migrate" \
  --network "$FLUXRADAR_NETWORK" \
  --env-file "$RELEASE_DIR/.env.production" \
  --env NODE_ENV=production \
  --env PORT=3310 \
  --env FRONTEND_ORIGIN=https://fluxradar.net \
  "$API_IMAGE" \
  apps/api/node_modules/.bin/prisma migrate deploy --schema apps/api/prisma/schema.prisma

# ---- Rollback compatibility gate --------------------------------
# The migration has already run, and it cannot be undone from here. Every
# way this step can still fail leaves the PREVIOUS release in front of
# traffic: a readiness or Caddy failure aborts before (or rolls back to
# before) the traffic switch. That release therefore has to be able to
# boot and serve against the schema and the environment file this deploy
# just produced — otherwise a failed deploy silently becomes a broken
# production instead of a no-op.
#
# Proving it, rather than asserting it in a comment: start the previous
# release's own image as a throwaway container against the migrated
# database and the new env file, and require TWO things of it.
#
#   1. Its readiness probe passes. That exercises the real startup path,
#      so it catches a production variable the old release validates at
#      boot but the new one no longer requires.
#   2. Its own Prisma client can still read every model it knows about
#      (deploy/rollback-schema-probe.cjs, copied in from this release
#      but executed against the OLD image's client and datamodel).
#      Readiness alone CANNOT catch a schema problem: it is a
#      `SELECT 1`, which succeeds against any reachable database,
#      including one whose columns the old client no longer finds. The
#      schema probe issues one `findFirst` per model, so every scalar
#      column the old release selects is named in a real query — that is
#      what fails a contract-phase migration (a dropped or renamed
#      column, a removed table) before it can strand a rollback.
#
# This runs BEFORE any traffic switch and before the previous
# containers are removed, so failing here leaves production exactly as
# it was. Migrations must stay additive/expand-phase for this to pass;
# see docs/DEPLOYMENT.md.
# PREVIOUS_RELEASE_ID was resolved from `current` at the top of this
# script; it is empty only when `current` does not exist at all.
if [ -z "$PREVIOUS_RELEASE_ID" ]; then
  # No `current` symlink at all: this is the first deploy, so there is
  # genuinely no rollback target and nothing to verify.
  echo "First deploy ($APP_DIR/current does not exist): no rollback target exists yet."
elif ! docker image inspect "fluxradar-api:$PREVIOUS_RELEASE_ID" >/dev/null 2>&1 \
  || ! docker image inspect "fluxradar-web:$PREVIOUS_RELEASE_ID" >/dev/null 2>&1; then
  # A rollback target IS expected — `current` points at $PREVIOUS_RELEASE
  # — but its image is gone, so its compatibility cannot be proven and a
  # rollback could not recreate it either. Silently continuing here would
  # disable the safety gate on exactly the deploys that need it most.
  echo "ERROR: the rollback target ($PREVIOUS_RELEASE_ID) is still the active release, but its image is missing on this host." >&2
  echo "Its compatibility with the migrated schema cannot be verified, and an automatic rollback could not recreate it." >&2
  echo "Restore it with 'docker load' from a saved image, or set the ALLOW_UNVERIFIED_ROLLBACK variable to 'true' to deploy without a verified rollback." >&2
  if [ "$ALLOW_UNVERIFIED_ROLLBACK" = "true" ]; then
    echo "WARNING: ALLOW_UNVERIFIED_ROLLBACK=true — continuing WITHOUT a verified rollback target. Rollback is NOT proven safe for this deploy." >&2
  else
    exit 1
  fi
else
  echo "Verifying that the rollback target ($PREVIOUS_RELEASE_ID) is compatible with the migrated schema"
  docker rm -f "$ROLLBACK_PROBE" >/dev/null 2>&1 || true
  # fluxradar:rollback-probe-container (regression-tested by
  # apps/api/src/deploy/deploy-006-rollback-probe-readonly.test.ts —
  # keep the markers, the test extracts and asserts exactly these lines)
  #
  # READ-ONLY BY CONSTRUCTION. `--entrypoint node` with an inert script
  # replaces the image's production command, so the previous release
  # never starts its API: no retention sweep deleting expired scans and
  # webhook rows, no claim or drain of the live job queue (which means
  # no crawl, no AI call and no customer email sent from a container
  # this deploy is about to throw away), no pending-refund sweep and no
  # migration. The container exists only to hold a node process open so
  # the two probes below can be exec'd into it, and both of them read.
  #
  # What the previous release's own startup would have validated is
  # asked directly instead, by rollback-readonly-probe.cjs.
  docker run -d \
    --name "$ROLLBACK_PROBE" \
    --network "$FLUXRADAR_NETWORK" \
    --env-file "$RELEASE_DIR/.env.production" \
    --env NODE_ENV=production \
    --env PORT=3310 \
    --env FRONTEND_ORIGIN=https://fluxradar.net \
    --entrypoint node \
    "fluxradar-api:$PREVIOUS_RELEASE_ID" \
    -e "setInterval(() => {}, 1 << 30)" >/dev/null
  # fluxradar:end-rollback-probe-container
  probe_running=0
  for attempt in $(seq 1 10); do
    if [ "$(docker inspect -f '{{.State.Running}}' "$ROLLBACK_PROBE" 2>/dev/null)" = "true" ]; then
      probe_running=1
      break
    fi
    sleep 1
  done
  if [ "$probe_running" -ne 1 ]; then
    echo "ERROR: the rollback probe container ($PREVIOUS_RELEASE_ID) did not stay running." >&2
    dump_container_diagnostics "$ROLLBACK_PROBE"
    docker rm -f "$ROLLBACK_PROBE" >/dev/null 2>&1 || true
    exit 1
  fi
  for probe_script in rollback-readonly-probe.cjs rollback-schema-probe.cjs; do
    if ! docker cp "$RELEASE_DIR/deploy/$probe_script" \
      "$ROLLBACK_PROBE:/tmp/$probe_script" >/dev/null; then
      echo "ERROR: could not copy $probe_script into the rollback container." >&2
      docker rm -f "$ROLLBACK_PROBE" >/dev/null 2>&1 || true
      exit 1
    fi
  done
  # 1. Would the previous release accept this environment file, and can
  #    it reach the database with it? Its own boot-time validators are
  #    called, and the query runs in a READ ONLY transaction.
  if ! docker exec "$ROLLBACK_PROBE" node /tmp/rollback-readonly-probe.cjs; then
    echo "ERROR: the previous release ($PREVIOUS_RELEASE_ID) would NOT start against the environment and database this deploy produced." >&2
    echo "An automatic rollback would therefore restore a broken production, so this deploy is stopped before any traffic is switched." >&2
    echo "Most likely cause: a production variable the previous release still requires, or a database it cannot reach with this env file." >&2
    dump_container_diagnostics "$ROLLBACK_PROBE"
    docker rm -f "$ROLLBACK_PROBE" >/dev/null 2>&1 || true
    exit 1
  fi
  # 2. Reachability only proves the database answers. Now prove the old
  #    release can still READ it, using its own generated Prisma client.
  if ! docker exec "$ROLLBACK_PROBE" node /tmp/rollback-schema-probe.cjs; then
    echo "ERROR: the previous release ($PREVIOUS_RELEASE_ID) cannot READ the migrated schema with its own Prisma client." >&2
    echo "An automatic rollback would restore a release that fails on every query to the models listed above, so this deploy is stopped before any traffic is switched." >&2
    echo "Most likely cause: a contract-phase migration (a dropped or renamed column, a removed table) shipped before every container that reads the old shape was retired." >&2
    dump_container_diagnostics "$ROLLBACK_PROBE"
    docker rm -f "$ROLLBACK_PROBE" >/dev/null 2>&1 || true
    exit 1
  fi
  echo "OK: the previous release accepts this environment and can read every model it knows about; an automatic rollback is safe."
  docker rm -f "$ROLLBACK_PROBE" >/dev/null 2>&1 || true
fi
# -----------------------------------------------------------------

docker rm -f "$API_CONTAINER" "$WEB_CONTAINER" >/dev/null 2>&1 || true
docker run -d \
  --name "$API_CONTAINER" \
  --restart unless-stopped \
  --network "$FLUXRADAR_NETWORK" \
  --network-alias "$API_CONTAINER" \
  --env-file "$RELEASE_DIR/.env.production" \
  --env NODE_ENV=production \
  --env PORT=3310 \
  --env FRONTEND_ORIGIN=https://fluxradar.net \
  "$API_IMAGE"
docker run -d \
  --name "$WEB_CONTAINER" \
  --restart unless-stopped \
  --network "$FLUXRADAR_NETWORK" \
  --network-alias "$WEB_CONTAINER" \
  "$WEB_IMAGE"
ensure_network_attachment "$API_CONTAINER"
ensure_network_attachment "$WEB_CONTAINER"
# Resolve through Docker's user-defined network instead of freezing
# ephemeral container IPs into Caddy. The names are stable for this
# release and the explicit aliases remain resolvable after Caddy is
# recreated or old release containers are removed.
NEW_API_UPSTREAM="$API_CONTAINER:3310"
NEW_WEB_UPSTREAM="$WEB_CONTAINER:80"

ready=0
for attempt in $(seq 1 30); do
  if docker exec "$API_CONTAINER" node -e "fetch('http://127.0.0.1:3310/health/ready').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))" \
    && docker exec "$WEB_CONTAINER" wget -q -O /dev/null http://127.0.0.1/health; then
    ready=1
    break
  fi
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  echo "API/web readiness never became true after $((30 * 2))s; collecting sanitized diagnostics" >&2
  docker ps --filter "name=$API_CONTAINER" --filter "name=$WEB_CONTAINER"
  dump_container_diagnostics "$API_CONTAINER"
  dump_container_diagnostics "$WEB_CONTAINER"
  exit 1
fi

# ---- The traffic switch ---------------------------------------
# Everything below serves production from this release: the runtime
# Caddyfile is rewritten in place and Caddy is recreated on it. The
# flag is set BEFORE the first of those writes, so a failure anywhere
# in the switch itself is rolled back rather than left half-applied.
record_rollback_target
TRAFFIC_SWITCHED=1
render_caddyfile "$NEW_API_UPSTREAM" "$NEW_WEB_UPSTREAM" "$RELEASE_DIR/deploy/Caddyfile"
cd "$RELEASE_DIR"
# Always recreate Caddy with the generated runtime file. Reloading an
# existing container is unsafe here because it may still mount the
# previous release's deploy/Caddyfile and upstream names.
export FLUXRADAR_CADDYFILE="$RUNTIME_DIR/Caddyfile"
export FLUXRADAR_API_UPSTREAM="$NEW_API_UPSTREAM"
export FLUXRADAR_WEB_UPSTREAM="$NEW_WEB_UPSTREAM"
docker compose --env-file .env.production -p fluxradar up -d --no-deps --force-recreate caddy

caddy_ready=0
for attempt in $(seq 1 15); do
  CADDY_CONTAINER="$(docker compose --env-file .env.production -p fluxradar ps -q caddy)"
  if [ -n "$CADDY_CONTAINER" ] && [ "$(docker inspect -f '{{.State.Running}}' "$CADDY_CONTAINER")" = "true" ]; then
    caddy_ready=1
    break
  fi
  sleep 2
done
if [ "$caddy_ready" -ne 1 ]; then
  echo "Caddy did not come up after the traffic switch" >&2
  exit 1
fi
ensure_network_attachment "$CADDY_CONTAINER"
if ! grep -Fq "$NEW_API_UPSTREAM" "$RUNTIME_DIR/Caddyfile" \
  || ! grep -Fq "$NEW_WEB_UPSTREAM" "$RUNTIME_DIR/Caddyfile"; then
  echo "Generated Caddyfile does not reference the new release upstreams" >&2
  exit 1
fi
if ! docker exec "$CADDY_CONTAINER" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; then
  echo "Caddy configuration validation failed" >&2
  docker logs --tail 80 "$CADDY_CONTAINER" 2>&1 || true
  exit 1
fi
# LOOPBACK WIRING CHECK — deliberately not a certificate check.
# It asks one question: does Caddy, on this host, route /api/* to the
# new API container? The certificate is validated by the public smoke
# test at the end of this workflow, from outside the server, where a
# wrong or expired certificate is actually visible. Verifying it here
# instead would fail the deploy while ACME is still issuing on a fresh
# host — a state the public check reports correctly a minute later.
# Use the production hostname for both SNI and Host. Sending only a
# Host header to 127.0.0.1 makes Caddy's automatic HTTPS listener
# reject the TLS handshake before the request reaches the proxy.
if ! curl --fail --silent --show-error --retry 20 --retry-all-errors --retry-delay 1 --retry-connrefused \
  --location --insecure --resolve fluxradar.net:443:127.0.0.1 \
  https://fluxradar.net/api/health | grep -q '"status":"ok"'; then
  echo "Caddy local smoke failed; collecting sanitized diagnostics" >&2
  docker logs --tail 80 "$CADDY_CONTAINER" 2>&1 || true
  # The exit handler performs the rollback. Calling it here as well
  # would recreate Caddy twice for one failure.
  exit 1
fi

atomic_switch "$RELEASE_DIR"
cat > "$STATE_FILE" <<STATE
FLUXRADAR_ACTIVE_RELEASE=$RELEASE_DIR
FLUXRADAR_API_UPSTREAM=$NEW_API_UPSTREAM
FLUXRADAR_WEB_UPSTREAM=$NEW_WEB_UPSTREAM
FLUXRADAR_API_CONTAINER=$API_CONTAINER
FLUXRADAR_WEB_CONTAINER=$WEB_CONTAINER
STATE
chmod 600 "$STATE_FILE"
if [ -n "$PREVIOUS_API_CONTAINER" ] || [ -n "$PREVIOUS_WEB_CONTAINER" ]; then
  docker rm -f "$PREVIOUS_API_CONTAINER" "$PREVIOUS_WEB_CONTAINER" >/dev/null 2>&1 || true
fi
if [ -n "$LEGACY_API_CONTAINER" ] || [ -n "$LEGACY_WEB_CONTAINER" ]; then
  docker rm -f "$LEGACY_API_CONTAINER" "$LEGACY_WEB_CONTAINER" >/dev/null 2>&1 || true
fi
# Verify the exact post-cleanup state. The first smoke test runs
# before old containers are removed; this one catches a stale Docker
# route or DNS binding that only appears once cleanup has completed.
if ! curl --fail --silent --show-error --retry 20 --retry-all-errors --retry-delay 1 --retry-connrefused \
  --location --insecure --resolve fluxradar.net:443:127.0.0.1 \
  https://fluxradar.net/api/health | grep -q '"status":"ok"' \
  || ! curl --fail --silent --show-error --retry 20 --retry-all-errors --retry-delay 1 --retry-connrefused \
  --location --insecure --resolve fluxradar.net:443:127.0.0.1 \
  --output /dev/null https://fluxradar.net/; then
  echo "Post-cleanup local smoke failed; collecting sanitized diagnostics" >&2
  docker logs --tail 80 "$CADDY_CONTAINER" 2>&1 || true
  docker logs --tail 80 "$API_CONTAINER" 2>&1 || true
  docker logs --tail 80 "$WEB_CONTAINER" 2>&1 || true
  exit 1
fi
# The release is live and recorded. Everything below is bookkeeping,
# and the exit handler above honours this flag: from here a failure is
# reported and NOTHING is rolled back.
DEPLOY_COMPLETED=1
# Keep the active release plus two rollback candidates to bound disk use.
find "$APP_DIR/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
  | sort -nr | tail -n +4 | cut -d' ' -f2- \
  | while IFS= read -r old_release; do
      case "$old_release" in
        "$APP_DIR/releases/"*) ;;
        *) continue ;;
      esac
      old_id="${old_release##*/}"
      rm -rf -- "$old_release"
      docker image rm "fluxradar-api:$old_id" "fluxradar-web:$old_id" >/dev/null 2>&1 || true
    done || true
# fluxradar:end-release-script
