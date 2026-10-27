# Docker image shipping capacity

`deploy.yml` finishes the package upload before the image matrix, sets
`max-parallel: 1`, and keeps the `production-deploy` concurrency group with
`cancel-in-progress: false`. This serializes this workflow's artifact writers.

Before SCP, `remote-upload` reads the actual uncompressed `docker save` archive
with `image-space.py`. The required free space is the sum of:

- archive apparent length, rounded up to 4 KiB (SCP can materialize sparse files);
- all regular outer archive entries, individually rounded, plus metadata blocks
  (containerd retains imported content; no credit for existing shared layers);
- every unpacked file, individually rounded, plus implicit parent directories,
  links, xattr bytes and a metadata block per entry;
- a separate 1 GiB free-space reserve and 16,384 free-inode reserve.

The same checks run again after SCP, immediately before `docker load`, with the
already staged archive subtracted. The full budget is checked independently at
APP_DIR, DockerRootDir, containerd root, content ingest/blobs and overlayfs
snapshots. Because the deployment user cannot traverse private store directories,
`findmnt` reads the kernel mount table and selects the longest component-prefix
covering mount. Its device identity is checked against `stat` at the accessible
mountpoint before reading capacity. Nested mounts below either data root or inside incoming are rejected, except
the audited Docker running-container overlay views at
`/var/lib/docker/rootfs/overlayfs/<64-hex-id>`. These are views of existing backing
layers, not the content-ingest or snapshot allocation locations. Accessible
APP_DIR/incoming/stage paths are resolved live and aliases/symlinks are rejected. Charging the entire peak to every covering mount
is conservative for separately mounted data roots. A failed/ambiguous query,
non-ext4 filesystem or unsupported allocation block size stops upload/load.

The reviewed layout is Linux Docker **29.1.3**, containerd **2.2.2** started as
`/usr/bin/containerd`, default containerd root `/var/lib/containerd`, Docker root
`/var/lib/docker`, and the containerd `overlayfs` snapshotter. Each affected
filesystem must be ext4 with an allocation block of 1, 2 or 4 KiB. Docker must
use the local Unix socket with no DOCKER_HOST/DOCKER_CONTEXT override.

**Audited topology prerequisite:** root-owned private store path components must
be real directories, with no symlinks, and the deployment shell and daemon must
share the same mount namespace. These prerequisites were checked read-only on the
current host. The unprivileged live guard cannot re-resolve private symlinks or
prove the daemon's mount namespace. An administrator changing private paths,
symlinks, service mount namespaces or daemon configuration must stop deployments
and re-audit this layout before using the guard again. Review this accounting
and update its checks before a daemon/storage upgrade; the guard fails closed on
unknown versions or backends and detected unsupported mount layouts. Private
symlink or namespace changes are covered by the prerequisite above, not detected
by the live guard. The current server has a separate `/tmp`
tmpfs, but this containerd import path streams data into its content store rather
than extracting the entire outer archive there.

Supported archives contain one Docker manifest. Any OCI manifests present must
have the same ordered layers and config, because containerd prefers OCI metadata.
JSON objects reject exact duplicate keys and case-fold collisions recursively.
Known authoritative fields must use canonical spelling in their typed context
(Docker manifest `Config`/`Layers` differ from OCI `config`/`layers`). Descriptor
media types must be supported for their role, and index/manifest shape must match;
optional body media types must agree when present. Embedded `data` or remote
`urls` descriptors are outside this local-archive contract and are rejected.
Every referenced OCI index/manifest/config/layer blob must be present, with an
exact descriptor size and a SHA-256 verified by streaming its actual archived
bytes. Blob filenames alone cannot establish identity: a false name could resolve
previously stored content with a larger unpacked footprint.
Gzip layers are read without extracting files to disk. Unsupported compression,
sparse layer entries, unresolved or cross-layer hardlinks, malformed metadata,
unknown binary blobs and budgets above 64 GiB / one million counted entries stop
shipping. Resolved same-layer hardlinks are charged another full target allocation.
This may reject archives that Docker could load; resolve such a failure by
reviewing the format/accounting, not by lowering the reserve.

`docker load` can print `Error unpacking image` while returning success. Shipping
captures output and treats that message as failure before accepting the image tag.
Only the staging directory carrying this invocation's ownership marker is cleaned
on success, error, INT or TERM. Existing stages and sibling artifacts are retained.
SIGKILL or a lost SSH connection may leave an owned stage for preflight cleanup;
no automatic Docker image/cache pruning was added.

This is a conservative admission check, not a filesystem quota or disk reservation.
The reserve absorbs bounded metadata/log growth. Unrelated processes, manual
Docker operations, daemon work continuing after cancellation, unusual filesystem
metadata or writes after the final capacity check can still consume it. Do not run
another deployment or manual image import while an interrupted load remains active.

Sources reviewed for the storage model:

- [Docker containerd image store](https://docs.docker.com/engine/storage/containerd/)
- [Docker 29.1.3 LoadImage](https://github.com/moby/moby/blob/docker-v29.1.3/daemon/containerd/image_exporter.go)
- [containerd import](https://github.com/containerd/containerd/blob/v2.2.2/core/images/archive/importer.go)
- [containerd content commit](https://github.com/containerd/containerd/blob/v2.2.2/plugins/content/local/writer.go)

Run `python3 -m unittest discover -s deploy/tests -v`. The suite executes the
actual action and workflow install body against bounded CLI fixtures; it never
loads a real image or writes to a deployment server.
