#!/usr/bin/env bash
# Runs on the destination, before SCP and immediately before docker load.
set -euo pipefail
need_kb="$1"
need_inodes="$2"
app_dir="$3"
stage_dir="${4:-$app_dir/incoming}"
fail() { echo "ERROR: $*" >&2; exit 1; }
for accessible_path in "$app_dir" "$app_dir/incoming" "$stage_dir"; do
  [ "$(readlink -e "$accessible_path")" = "$accessible_path" ] || fail 'staging path must contain no symlinks or aliases'
done
[ -z "${DOCKER_HOST:-}" ] && [ -z "${DOCKER_CONTEXT:-}" ] || fail 'remote Docker environment is unsupported'
[ "$(docker context inspect "$(docker context show)" --format '{{.Endpoints.docker.Host}}')" = unix:///var/run/docker.sock ] || fail 'Docker must use the local daemon socket'
case "$(docker version --format '{{.Server.Version}}')" in
  29.1.3) ;; *) fail 'unsupported Docker version: review and update deploy/image-space.md before upgrading' ;;
esac
case "$(containerd --version)" in
  'containerd github.com/containerd/containerd/v2 2.2.2'|'containerd github.com/containerd/containerd/v2 2.2.2 '*) ;;
  *) fail 'unsupported containerd version: review and update deploy/image-space.md before upgrading' ;;
esac
# A custom invocation could select a different config than config dump reads.
[ "$(ps -C containerd -o args= | xargs)" = /usr/bin/containerd ] || fail 'custom containerd invocation requires review'
[ "$(containerd config dump | sed -n 's/^root = ["\x27]\([^"\x27]*\)["\x27]$/\1/p')" = /var/lib/containerd ] || fail 'custom containerd root requires review'
info="$(docker info --format '{{.DockerRootDir}}|{{.Driver}}|{{json .DriverStatus}}')"
[ "$info" = '/var/lib/docker|overlayfs|[["driver-type","io.containerd.snapshotter.v1"]]' ] || fail 'unsupported Docker image store layout'
# Private store directories are mode 0700. Read the kernel mount table instead
# of stat'ing through them as the unprivileged deployment user. The root-owned,
# nonsymlink default topology is an audited prerequisite (see image-space.md).
mounts="$(findmnt --kernel --raw --noheadings --output TARGET,MAJ:MIN,FSTYPE)"
[ -n "$mounts" ] || fail 'could not read filesystem mount table'
while read -r mount device filesystem; do
  # Docker's running-container overlay views are not the backing content or
  # snapshot store. The observed default rootfs views are the sole exception.
  if [[ "$mount" =~ ^/var/lib/docker/rootfs/overlayfs/[a-f0-9]{64}$ && "$filesystem" = overlay ]]; then
    continue
  fi
  case "$mount" in
    /var/lib/containerd/*|/var/lib/docker/*|"$app_dir/incoming"|"$app_dir/incoming"/*)
      fail 'nested data mount requires a reviewed storage layout' ;;
  esac
done <<< "$mounts"
for path in "$app_dir" /var/lib/docker /var/lib/containerd \
  /var/lib/containerd/io.containerd.content.v1.content/ingest \
  /var/lib/containerd/io.containerd.content.v1.content/blobs \
  /var/lib/containerd/io.containerd.snapshotter.v1.overlayfs/snapshots; do
  covering_mount=''
  covering_device=''
  covering_filesystem=''
  while read -r mount device filesystem; do
    if [[ "$path/" == "$mount/"* || "$mount" = / ]]; then
      if [ "$mount" = "$covering_mount" ]; then
        fail 'ambiguous covering mount metadata'
      fi
      if [ "${#mount}" -gt "${#covering_mount}" ]; then
        covering_mount="$mount"
        covering_device="$device"
        covering_filesystem="$filesystem"
      fi
    fi
  done <<< "$mounts"
  [ "$covering_filesystem" = ext4 ] || fail 'unsupported filesystem family'
  [[ "$covering_mount" = /* && "$covering_mount" != *\\* ]] || fail 'unsupported mount metadata'
  [[ "$covering_device" =~ ^([0-9]{1,5}):([0-9]{1,5})$ ]] || fail 'invalid mount device metadata'
  major=$((10#${BASH_REMATCH[1]}))
  minor=$((10#${BASH_REMATCH[2]}))
  expected_device=$(( ((major & 4095) << 8) | (minor & 255) | ((minor & ~255) << 12) | ((major & ~4095) << 32) ))
  [ "$(stat -c %d "$covering_mount")" = "$expected_device" ] || fail 'mount device changed during capacity check'
  [ "$(stat -f -c %T "$covering_mount")" = ext2/ext3 ] || fail 'unsupported filesystem type'
  block="$(stat -f -c %S "$covering_mount")"
  case "$block" in 1024|2048|4096) ;; *) fail 'unsupported filesystem allocation block size' ;; esac
  available="$(df -P -k "$covering_mount" | awk 'NR==2 {print $4}')"
  free_inodes="$(df -P -i "$covering_mount" | awk 'NR==2 {print $4}')"
  for number in "$available" "$free_inodes"; do
    [[ "$number" =~ ^[0-9]{1,12}$ ]] || fail 'invalid filesystem capacity metadata'
  done
  # Charge the entire peak to every covering filesystem, independently.
  (( 10#$available >= need_kb )) || fail "insufficient free space for Docker image: $available KiB free, $need_kb KiB required (includes 1 GiB reserve)"
  (( 10#$free_inodes >= need_inodes )) || fail 'insufficient free inodes for Docker image'
done
echo "OK: Docker image capacity checked: $need_kb KiB and $need_inodes inodes required."
