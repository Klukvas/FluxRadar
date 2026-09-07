# FluxRadar PostgreSQL backups

Operational reference for the scripts in this directory. The narrative version —
what has to be configured, what the failure modes are, and how a real restore is
performed — lives in [`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md#database-backup-and-restore).

| File                    | Purpose                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `pg-backup.sh`          | Dump the live database inside its container, encrypt, upload, prune.                         |
| `pg-restore.sh`         | Verify a snapshot by restoring it into a throwaway database; the destructive path is opt-in. |
| `backup-cli.cjs`        | `upload` / `download` / `list` / `latest-key` / `prune` against Hetzner Object Storage.      |
| `archive-crypto.cjs`    | AES-256-GCM archive format (`FRBK1`), key parsing, checksums.                                |
| `s3-client.cjs`         | Dependency-free SigV4 client (path-style, Ceph-compatible).                                  |
| `retention-policy.cjs`  | Pure planner deciding which snapshots may be deleted.                                        |
| `fluxradar-backup.cron` | The schedule, installed by hand into `/etc/cron.d`.                                          |

Everything is covered by `DEPLOY-004` and `DEPLOY-005` in
`apps/api/src/deploy/`, which run the real scripts against a stub bucket.
