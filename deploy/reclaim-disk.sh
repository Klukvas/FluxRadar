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
# What it removes, and ONLY this:
#   1. STOPPED containers (state exited, created or dead) whose image is a
#      fluxradar-api / fluxradar-web release tag that has no directory under
#      APP_DIR/releases. Such a container can never be rolled back to — the
#      release it belongs to is gone — but it holds its image down, so every
#      `docker image rm` below used to fail and the layers stayed for good.
#      That is how the 38 GB disk reached "8.5 GB free, 12.9 GB required".
#   2. fluxradar-api / fluxradar-web images whose tag is a release id (strict
#      hex, like the tags the deploy writes) that has no directory under
#      APP_DIR/releases and that no container — running or stopped — uses.
#   3. Dangling images (untagged layers nothing references).
#   4. Build cache untouched for more than a day.
#
# What it never touches: a RUNNING (or paused, restarting, removing) container,
# whatever its release; any container of a release that still has a directory,
# because those are the rollback candidates; volumes (PostgreSQL lives in one);
# networks; images and containers of any other project; APP_DIR/releases,
# APP_DIR/current, the runtime directory. There is no `system prune`, no
# `container prune` and no `volume prune` here, on purpose. Every removal is
# best-effort and logged; the free-space gate in .github/actions/remote-upload
# stays the judge of whether there is now enough.
#
# Usage: reclaim-disk.sh <app-dir>

set -u

APP_DIR="${1:-}"
if [ -z "$APP_DIR" ] || [ ! -d "$APP_DIR" ]; then
  echo "ERROR: reclaim-disk.sh needs the application directory as its first argument" >&2
  exit 2
fi
RELEASES_DIR="$APP_DIR/releases"

echo "----- remote disk usage (before reclaiming) -----"
df -P -h "$APP_DIR" || true

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not installed here; nothing to reclaim"
  exit 0
fi

# A tag is only ours to remove when it looks like a release id.
is_release_tag() {
  case "$1" in
    ''|*[!0-9a-f]*) return 1 ;;
  esac
  [ "${#1}" -ge 7 ] && [ "${#1}" -le 64 ]
}

# A container of a release whose directory is gone cannot be rolled back to,
# and while it exists its image cannot be removed. Only a container that is
# not running is touched, and only when its own release directory is gone.
echo "----- removing stopped containers of releases that are gone -----"
removed_containers=0
while IFS=$'\t' read -r container_id container_image container_state; do
  case "$container_image" in
    fluxradar-api:*|fluxradar-web:*) ;;
    *) continue ;;
  esac
  release_id="${container_image#*:}"
  is_release_tag "$release_id" || continue
  [ -d "$RELEASES_DIR/$release_id" ] && continue
  case "$container_state" in
    exited|created|dead) ;;
    *)
      echo "keeping container $container_id ($container_image): it is $container_state"
      continue
      ;;
  esac
  echo "removing stopped container $container_id ($container_image)"
  if docker rm "$container_id" >/dev/null 2>&1; then
    removed_containers=$((removed_containers + 1))
  else
    echo "could not remove container $container_id; leaving it" >&2
  fi
done < <(docker ps -a --format '{{.ID}}\t{{.Image}}\t{{.State}}' 2>/dev/null || true)
echo "removed $removed_containers stopped container(s)"

# Everything a container references, by image name:tag, AFTER the sweep above.
# `ps -a` on purpose: a stopped container of a release that still has its
# directory is how a rollback gets its images.
in_use="$(docker ps -a --format '{{.Image}}' 2>/dev/null || true)"

echo "----- removing release images with no release directory -----"
removed=0
while IFS= read -r image; do
  case "$image" in
    fluxradar-api:*|fluxradar-web:*) ;;
    *) continue ;;
  esac
  release_id="${image#*:}"
  is_release_tag "$release_id" || continue
  [ -d "$RELEASES_DIR/$release_id" ] && continue
  if printf '%s\n' "$in_use" | grep -Fxq -- "$image"; then
    echo "keeping $image (a container uses it)"
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

echo "----- pruning dangling images and stale build cache -----"
docker image prune --force || echo "dangling image prune failed; continuing" >&2
docker builder prune --force --filter 'until=24h' || echo "build cache prune failed; continuing" >&2

echo "----- remote disk usage (after reclaiming) -----"
df -P -h "$APP_DIR" || true
