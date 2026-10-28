#!/usr/bin/env bash
# Frees disk on the production host BEFORE a deploy uploads two images and a
# release bundle to it. Runs on the server, fed over SSH by the `reclaim` stage
# of deploy.yml:
#
#   ssh "$SSH_USER@$SSH_HOST" bash -s -- "$APP_DIR" < deploy/reclaim-disk.sh
#
# Why it exists. release.sh keeps the live release plus two rollback candidates
# and removes the images of everything older, but only for the release
# directories it finds. An image whose directory is already gone (pruned by an
# older version of that script, or by hand), the layers a `docker load` leaves
# dangling, and stale build cache all stay for good. On a 38 GB disk that
# turned into "4 GB free, 5.6 GB needed" and a refused upload.
#
# Then the upload was refused again at "8.5 GB free, 12.9 GB required" with this
# script reclaiming one image: SIX fluxradar-web containers and one
# crash-looping fluxradar-api container of releases whose directories were long
# gone were still RUNNING, each pinning its image. Nothing routed traffic to
# them — Caddy proxies exactly the two containers release.sh records in
# runtime/active.env — they had simply never been stopped. So a running
# container of a vanished release is removable too now, but only against proof
# of what is live.
#
# What it removes, and ONLY this:
#   1. fluxradar-api / fluxradar-web containers of a release with no directory
#      under APP_DIR/releases:
#        - state exited, created or dead: always. The release they belong to is
#          gone, so nothing can ever start them again, yet they hold their
#          image down and made every `docker image rm` below fail.
#        - state running, restarting or paused: only when ALL of the live
#          evidence can be read AND none of it points at the container, by name,
#          by image tag, by the image ID the container actually runs, or by the
#          release its tag names:
#            * runtime/active.env — every FLUXRADAR_*_CONTAINER,
#              FLUXRADAR_*_UPSTREAM and FLUXRADAR_*_IMAGE value, which is what
#              release.sh and rollback-release.sh record as live,
#            * runtime/rollback.env — the same values for the recorded
#              rollback target, whenever that file exists,
#            * runtime/Caddyfile — the generated upstreams traffic goes to,
#            * FLUXRADAR_ACTIVE_RELEASE and the APP_DIR/current symlink —
#              neither may name the container's release.
#          If any of that is missing or unreadable, or active.env and the
#          generated Caddyfile disagree about the upstreams, then NO running
#          container is touched and the reason is logged. A container docker is
#          already deleting (state removing) and anything named
#          *rollback-probe* are never forced either, and neither is a running
#          container whose image ID docker refuses to report, since nothing then
#          proves it is not the rollback target.
#   2. fluxradar-api / fluxradar-web images with no directory under
#      APP_DIR/releases that no container — running or stopped — uses, whose
#      image ID none of the live evidence records, and whose repository:tag
#      string none of it names. The deploy tags releases with their commit id,
#      but an orphan image tagged by hand — `google-login-20261026-v1`,
#      `latest` — is the same dead weight on a 38 GB disk, so the tag shape is
#      no longer a reason to keep it; every one of the three proofs above
#      still must clear first. When the live evidence cannot be read at all,
#      or `docker ps -a` will not answer, the image sweep stops entirely: only
#      the stopped-container sweep, the dangling prune and the build-cache
#      prune still run — removing an image nothing could be checked against is
#      a rollback risk no amount of freed space is worth.
#
# Why image IDs and not only tags. release.sh resolves the rollback target's
# images with `docker inspect --format '{{.Image}}'` and records them as
# `sha256:<64 hex>` IDs, never as repository:tag, because a host patched by hand
# runs an image the release tag no longer names. rollback-release.sh then refuses
# to roll back unless those exact IDs still exist. So a candidate is matched
# against the evidence by ID as well, both for the container holding it and for
# the `docker image rm` that would delete the digest a rollback needs.
#   3. Dangling images (untagged layers nothing references).
#   4. The whole build cache. This host never builds: deploy.yml builds both
#      images on the GitHub runner and ships them with `docker load`, so every
#      byte of cache here is dead weight, however fresh.
#
# What it never touches: the live release's containers and images; any container
# of a release that still has a directory, because those are the rollback
# candidates; caddy; postgres; a rollback probe; volumes (PostgreSQL lives in
# one); networks; images and containers of any other project; APP_DIR/releases,
# APP_DIR/current, the runtime directory. There is no `system prune`, no
# `container prune` and no `volume prune` here, on purpose. `docker system df`
# and the image list with sizes are printed before and after, so the next log
# shows what actually occupies the disk. Every removal is best-effort and logged
# with the container's state; the free-space gate in
# .github/actions/remote-upload stays the judge of whether there is now enough.
#
# Usage: reclaim-disk.sh <app-dir>

set -u

APP_DIR="${1:-}"
if [ -z "$APP_DIR" ] || [ ! -d "$APP_DIR" ]; then
  echo "ERROR: reclaim-disk.sh needs the application directory as its first argument" >&2
  exit 2
fi
RELEASES_DIR="$APP_DIR/releases"
# The same three paths release.sh and rollback-release.sh write; they are
# derived from APP_DIR there too, which is why this script still needs no
# argument of its own.
RUNTIME_DIR="$APP_DIR/runtime"
STATE_FILE="$RUNTIME_DIR/active.env"
ROLLBACK_FILE="$RUNTIME_DIR/rollback.env"
CADDYFILE="$RUNTIME_DIR/Caddyfile"
CURRENT_LINK="$APP_DIR/current"

echo "----- remote disk usage (before reclaiming) -----"
df -P -h "$APP_DIR" || true

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not installed here; nothing to reclaim"
  exit 0
fi

# What occupies the disk, in the log, before and after: `system df` for the
# totals and what docker itself considers reclaimable, then every image with
# its size, because one stale release image is ~1 GB of this 38 GB disk.
show_docker_usage() {
  echo "----- docker disk usage ($1) -----"
  docker system df || echo "docker system df failed; continuing" >&2
  echo "----- docker images with sizes ($1) -----"
  docker image ls --format '{{.Size}}	{{.Repository}}:{{.Tag}}' \
    || echo "docker image ls failed; continuing" >&2
}

show_docker_usage "before reclaiming"

# Value of a KEY=VALUE line, last occurrence wins and surrounding quotes are
# stripped — the same way contract-phase-gate.sh reads runtime/rollback.env.
env_value() {
  printf '%s\n' "$2" | sed -n "s/^$1=//p" | tail -n 1 | sed -e 's/^"//' -e 's/"$//'
}

# Every container name, upstream and image id one of the runtime env files
# records. A rollback needs all of them, so none of them may be removed.
reference_lines() {
  printf '%s\n' "$1" | grep -E '^FLUXRADAR_[A-Z0-9_]*_(CONTAINER|UPSTREAM|IMAGE)=' || true
}

REMOVE_LIVE_ORPHANS=0
LIVE_REFS=""
ACTIVE_RELEASE_ID=""
CURRENT_RELEASE_ID=""
KEEP_REASON=""
FALLBACK_REASON=""

# Collects into LIVE_REFS everything the host says is live, and the release ids
# of the active release and the `current` symlink. Returns 1 — with the reason
# in FALLBACK_REASON — when any of that evidence is missing, unreadable or
# self-contradictory, which keeps the sweep below to stopped containers only.
collect_live_evidence() {
  local state caddy rollback="" api_container web_container api_upstream web_upstream
  if [ ! -r "$STATE_FILE" ]; then
    FALLBACK_REASON="the release state file $STATE_FILE is missing or unreadable"
    return 1
  fi
  if [ ! -r "$CADDYFILE" ]; then
    FALLBACK_REASON="the generated $CADDYFILE is missing or unreadable"
    return 1
  fi
  if [ -e "$ROLLBACK_FILE" ] && [ ! -r "$ROLLBACK_FILE" ]; then
    FALLBACK_REASON="the recorded rollback target $ROLLBACK_FILE is unreadable"
    return 1
  fi
  if [ ! -L "$CURRENT_LINK" ] && [ ! -e "$CURRENT_LINK" ]; then
    FALLBACK_REASON="$CURRENT_LINK does not exist, so no release is provably live"
    return 1
  fi
  state="$(cat "$STATE_FILE" 2>/dev/null)" || {
    FALLBACK_REASON="the release state file $STATE_FILE could not be read"
    return 1
  }
  caddy="$(cat "$CADDYFILE" 2>/dev/null)" || {
    FALLBACK_REASON="the generated $CADDYFILE could not be read"
    return 1
  }
  [ -r "$ROLLBACK_FILE" ] && rollback="$(cat "$ROLLBACK_FILE" 2>/dev/null)"

  api_container="$(env_value FLUXRADAR_API_CONTAINER "$state")"
  web_container="$(env_value FLUXRADAR_WEB_CONTAINER "$state")"
  api_upstream="$(env_value FLUXRADAR_API_UPSTREAM "$state")"
  web_upstream="$(env_value FLUXRADAR_WEB_UPSTREAM "$state")"
  ACTIVE_RELEASE_ID="$(env_value FLUXRADAR_ACTIVE_RELEASE "$state")"
  ACTIVE_RELEASE_ID="${ACTIVE_RELEASE_ID##*/}"
  if [ -z "$api_container" ] || [ -z "$web_container" ] \
    || [ -z "$api_upstream" ] || [ -z "$web_upstream" ] || [ -z "$ACTIVE_RELEASE_ID" ]; then
    FALLBACK_REASON="$STATE_FILE names no live release, api/web container and upstream"
    return 1
  fi
  # release.sh refuses to switch traffic unless the Caddyfile it generated names
  # both upstreams. If they disagree here, one of the two files is stale and
  # neither can be trusted to say what is serving.
  if ! printf '%s\n' "$caddy" | grep -Fq -- "$api_upstream" \
    || ! printf '%s\n' "$caddy" | grep -Fq -- "$web_upstream"; then
    FALLBACK_REASON="$CADDYFILE does not name the upstreams $STATE_FILE records"
    return 1
  fi

  CURRENT_RELEASE_ID="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
  CURRENT_RELEASE_ID="${CURRENT_RELEASE_ID##*/}"
  LIVE_REFS="$(reference_lines "$state")
$(reference_lines "$rollback")
$caddy"
  return 0
}

# Does the live evidence record this image ID? release.sh writes it with the
# `sha256:` prefix docker reports, so the bare digest is what both spellings
# have in common; the length floor keeps a junk value from matching broadly.
is_live_image_id() {
  local digest="${1#sha256:}"
  [ "${#digest}" -ge 12 ] || return 1
  printf '%s\n' "$LIVE_REFS" | grep -Fq -- "$digest"
}

# The image ID docker resolves a container to, which is the spelling the runtime
# env files record. Best-effort: prints nothing and fails when docker will not
# answer about this container.
container_image_id() {
  local image_id
  image_id="$(docker inspect --format '{{.Image}}' "$1" 2>/dev/null)" || return 1
  [ -n "$image_id" ] || return 1
  printf '%s\n' "$image_id"
}

# The ID of an image, in the same best-effort way.
image_id() {
  local image_id
  image_id="$(docker image inspect --format '{{.Id}}' "$1" 2>/dev/null)" || return 1
  [ -n "$image_id" ] || return 1
  printf '%s\n' "$image_id"
}

# Is this container, by any of its names, by its image tag, by the image ID it
# actually runs, or by the release its image tag names, part of what the host
# says is live?
is_live_reference() {
  local names="$1" image="$2" release_id="$3" image_id="$4" name
  if [ -n "$ACTIVE_RELEASE_ID" ] && [ "$release_id" = "$ACTIVE_RELEASE_ID" ]; then return 0; fi
  if [ -n "$CURRENT_RELEASE_ID" ] && [ "$release_id" = "$CURRENT_RELEASE_ID" ]; then return 0; fi
  if printf '%s\n' "$LIVE_REFS" | grep -Fq -- "$image"; then return 0; fi
  if is_live_image_id "$image_id"; then return 0; fi
  # `docker ps --format '{{.Names}}'` joins several names with commas.
  local IFS=','
  for name in $names; do
    [ -n "$name" ] || continue
    if printf '%s\n' "$LIVE_REFS" | grep -Fq -- "$name"; then return 0; fi
  done
  return 1
}

# Decides one container of a release that has no directory left, where an empty
# image_id means docker would not say which image it runs. Sets KEEP_REASON and
# returns 1 when it has to stay.
may_remove_container() {
  local names="$1" image="$2" state="$3" release_id="$4" image_id="$5"
  KEEP_REASON=""
  case "$state" in
    exited|created|dead) return 0 ;;
  esac
  if [ "$REMOVE_LIVE_ORPHANS" -ne 1 ]; then
    KEEP_REASON="it is $state and $FALLBACK_REASON"
    return 1
  fi
  case "$state" in
    running|restarting|paused) ;;
    *)
      KEEP_REASON="it is $state, which docker is already resolving"
      return 1
      ;;
  esac
  case "$names" in
    *rollback-probe*)
      KEEP_REASON="it is a rollback probe of a deploy that may still be running"
      return 1
      ;;
  esac
  if [ -z "$image_id" ]; then
    KEEP_REASON="it is $state and docker would not report the image it runs, so nothing proves it is not the recorded rollback target"
    return 1
  fi
  if is_live_reference "$names" "$image" "$release_id" "$image_id"; then
    KEEP_REASON="it is $state and the live release still points at it"
    return 1
  fi
  return 0
}

# `docker rm -f` kills and removes; a stopped container needs no force, so it
# does not get any.
remove_container() {
  case "$2" in
    exited|created|dead) docker rm "$1" >/dev/null 2>&1 ;;
    *) docker rm -f "$1" >/dev/null 2>&1 ;;
  esac
}

if collect_live_evidence; then
  REMOVE_LIVE_ORPHANS=1
  echo "live release ${ACTIVE_RELEASE_ID:-unknown} is recorded in $STATE_FILE and served through $CADDYFILE; a running container of a vanished release that neither names may be removed"
else
  REMOVE_LIVE_ORPHANS=0
  echo "keeping every running container: $FALLBACK_REASON"
fi

echo "----- removing containers of releases that are gone -----"
removed_containers=0
while IFS=$'\t' read -r container_id container_names container_image container_state; do
  case "$container_image" in
    fluxradar-api:*|fluxradar-web:*) ;;
    *) continue ;;
  esac
  release_id="${container_image#*:}"
  [ -d "$RELEASES_DIR/$release_id" ] && continue
  candidate_image_id="$(container_image_id "$container_id" || true)"
  if ! may_remove_container "$container_names" "$container_image" "$container_state" "$release_id" \
    "$candidate_image_id"; then
    echo "keeping container $container_id ($container_names, $container_image): $KEEP_REASON"
    continue
  fi
  echo "removing $container_state container $container_id ($container_names, $container_image): release $release_id has no directory"
  if remove_container "$container_id" "$container_state"; then
    removed_containers=$((removed_containers + 1))
  else
    echo "could not remove container $container_id; leaving it" >&2
  fi
done < <(docker ps -a --format '{{.ID}}	{{.Names}}	{{.Image}}	{{.State}}' 2>/dev/null || true)
echo "removed $removed_containers container(s) of releases that are gone"

# Everything a container references, by image name:tag, AFTER the sweep above.
# `ps -a` on purpose: a stopped container of a release that still has its
# directory is how a rollback gets its images. An answer that never comes is an
# answer of "unknown", and the image sweep below refuses to run on unknown.
IN_USE_UNKNOWN=0
if ! in_use="$(docker ps -a --format '{{.Image}}' 2>/dev/null)"; then
  in_use=""
  IN_USE_UNKNOWN=1
fi

echo "----- removing release images with no release directory -----"
removed=0
if [ "$REMOVE_LIVE_ORPHANS" -ne 1 ]; then
  echo "keeping every release image: $FALLBACK_REASON"
elif [ "$IN_USE_UNKNOWN" -eq 1 ]; then
  echo "keeping every release image: docker ps -a failed, so nothing proves an image is unused"
else
while IFS= read -r image; do
  case "$image" in
    fluxradar-api:*|fluxradar-web:*) ;;
    *) continue ;;
  esac
  release_id="${image#*:}"
  [ -d "$RELEASES_DIR/$release_id" ] && continue
  # A rollback target recorded by repository:tag rather than by image ID —
  # release.sh records IDs, but a hand-patched host may record a name.
  if printf '%s\n' "$LIVE_REFS" | grep -Fq -- "$image"; then
    echo "keeping $image (the live evidence references it)"
    continue
  fi
  if printf '%s\n' "$in_use" | grep -Fxq -- "$image"; then
    echo "keeping $image (a container uses it)"
    continue
  fi
  # Removing the tag of an image the evidence records by ID would delete the
  # digest rollback-release.sh refuses to roll back without, and the container
  # that pinned it may have been renamed by hand or removed above.
  if ! resolved_image_id="$(image_id "$image")"; then
    echo "keeping $image (docker would not report its image id)"
    continue
  fi
  if is_live_image_id "$resolved_image_id"; then
    echo "keeping $image (the live release or the recorded rollback target runs image $resolved_image_id)"
    continue
  fi
  echo "removing $image"
  if docker image rm "$image" >/dev/null 2>&1; then
    removed=$((removed + 1))
  else
    echo "could not remove $image; leaving it" >&2
  fi
done < <(docker image ls --format '{{.Repository}}:{{.Tag}}' 2>/dev/null || true)
echo "removed $removed release image(s)"
fi

echo "----- pruning dangling images and the build cache -----"
docker image prune --force || echo "dangling image prune failed; continuing" >&2
docker builder prune --force || echo "build cache prune failed; continuing" >&2

show_docker_usage "after reclaiming"

echo "----- remote disk usage (after reclaiming) -----"
df -P -h "$APP_DIR" || true
