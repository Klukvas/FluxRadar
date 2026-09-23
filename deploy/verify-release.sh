#!/usr/bin/env bash
# Looks at a release from OUTSIDE the server, and rolls it back when it fails.
#
# Runs on the GitHub runner, never over SSH on the server itself: a check that
# curls the site from the machine that serves it cannot see a DNS record that was
# never published, a certificate that was never issued, or a proxy in front
# refusing traffic. SSH is used only after the verdict is in — for diagnostics,
# and for the rollback, which runs deploy/rollback-release.sh on the server
# against the target the release script recorded before it switched traffic.
#
# Two callers in deploy.yml, and the second is why this is a file:
#
#   verify   the stage after `release`: the release is live, and this is the
#            last word on whether it stays.
#   recover  runs when `release` succeeded but `verify` did not finish green —
#            it failed before its smoke test ran (checkout, SSH setup, a lost
#            runner), was cancelled, or timed out. Splitting the deploy into
#            stages put a job boundary between the traffic switch and this
#            check, and without `recover` any of those left a switched,
#            never-verified release in front of traffic.
#
# Running it twice is safe by construction: it asks the site FIRST. After a
# `verify` that already rolled back, the previous release answers, and this
# exits 0 having changed nothing. A rollback it does start is refused by
# rollback-release.sh (exit 4) when the live release is already the target.
#
# Exit status: 0 ONLY when the site passes the public smoke test on the first
# ask. Every other path — including a successful rollback — exits non-zero,
# because the release under test failed.
#
# Usage: verify-release.sh --host <hostname>
# Environment: SSH_HOST, SSH_USER, APP_DIR, RELEASE_ID (the release under test).

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
HOST=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --host) HOST="${2:-}"; shift 2 ;;
    *) echo "verify-release: unknown argument '$1' (usage: verify-release.sh --host <hostname>)" >&2; exit 2 ;;
  esac
done
if [ -z "$HOST" ]; then
  echo 'verify-release: --host is required (usage: verify-release.sh --host <hostname>)' >&2
  exit 2
fi
for required in SSH_HOST SSH_USER APP_DIR RELEASE_ID; do
  if [ -z "${!required:-}" ]; then
    echo "verify-release: $required is not set" >&2
    exit 2
  fi
done

# fluxradar:public-smoke-invocation (regression-tested by
# apps/api/src/deploy/deploy-007-public-smoke.test.ts — keep the
# markers, the test extracts and asserts exactly these lines)
#
# deploy/public-smoke.sh validates the certificate, requires https end
# to end, and asserts the status, the body and the security header of
# every endpoint it checks. A hostname that does not resolve is a
# failure, not a pass: the old check exited 0 on missing DNS and used
# `curl --insecure`, so a wrong, expired or self-signed certificate
# deployed silently.
if bash "$SCRIPT_DIR/public-smoke.sh" --host "$HOST"; then
  exit 0
fi
# fluxradar:end-public-smoke-invocation

echo 'Public smoke failed; collecting sanitized Caddy diagnostics from the server.' >&2
ssh "$SSH_USER@$SSH_HOST" bash -s -- "$APP_DIR" <<'REMOTE' || true
set -eu
APP_DIR="$1"
cd "$APP_DIR/current"
docker compose --env-file .env.production -p fluxradar ps caddy 2>&1 || true
CADDY_CONTAINER="$(docker compose --env-file .env.production -p fluxradar ps -q caddy 2>/dev/null || true)"
if [ -n "$CADDY_CONTAINER" ]; then
  docker inspect --format 'status={{.State.Status}} running={{.State.Running}} restarting={{.State.Restarting}} exitCode={{.State.ExitCode}} error={{.State.Error}}' "$CADDY_CONTAINER" 2>&1 || true
  docker logs --tail 80 "$CADDY_CONTAINER" 2>&1 || true
fi
REMOTE

# fluxradar:public-smoke-rollback (regression-tested by
# apps/api/src/deploy/deploy-012-public-smoke-rollback.test.ts — keep
# the markers, the test extracts and RUNS exactly these lines)
#
# This is the ONE failure the release script's exit handler cannot
# reach: that script has already exited 0, so the new release is live,
# recorded, and serving a site that just failed a check from outside.
# docs/DEPLOYMENT.md promises a failed rollout does not leave a broken
# release in front of traffic, and this is what keeps that true.
#
# It is the same rollback the release script uses, run on the server
# against the target that script recorded before it switched traffic.
# The certificate/DNS conditions the local checks deliberately do not
# test are exactly the ones this catches, and a rollback is the right
# answer to them too: the previous release held a working certificate
# for the same hostname.
#
# The rollback's exit code is the whole verdict, so it is captured
# rather than collapsed into if/else: 3 means there was no earlier
# release and the script therefore touched NOTHING — on a first deploy
# the unconditional version removed the only API and web containers on
# the host and exited 1, so a failed smoke test became a host serving
# nothing at all. None of the three outcomes is hidden, and none of
# them passes the step.
echo 'Rolling back: a release that fails the public smoke test must not stay live.' >&2
rollback_status=0
ssh "$SSH_USER@$SSH_HOST" bash -s -- "$APP_DIR" "$RELEASE_ID" <<'REMOTE' || rollback_status=$?
set -eu
APP_DIR="$1"
RELEASE_ID="$2"
bash "$APP_DIR/releases/$RELEASE_ID/deploy/rollback-release.sh" "$APP_DIR" "$APP_DIR/releases/$RELEASE_ID"
REMOTE
if [ "$rollback_status" -eq 0 ]; then
  # Ask the same question that failed, from the same place, about the
  # release that is now serving.
  if bash "$SCRIPT_DIR/public-smoke.sh" --host "$HOST"; then
    echo "Rolled back: the previous release is serving $HOST again." >&2
  else
    echo "CRITICAL: the rollback ran but $HOST still fails the public smoke test. Production needs manual recovery (docs/DEPLOYMENT.md, \"Release rollback\")." >&2
  fi
elif [ "$rollback_status" -eq 3 ]; then
  echo 'CRITICAL: there is no earlier release on this host to roll back to (first deploy), so nothing was torn down and the release that failed the public smoke test is still live. Production needs manual attention: deploy a working release (docs/DEPLOYMENT.md, "Release rollback").' >&2
elif [ "$rollback_status" -eq 4 ]; then
  echo 'CRITICAL: the release that failed the public smoke test is also the recorded rollback target (a redeploy of the live commit), so there is no different release to go back to and nothing was changed. Production needs manual attention: deploy a known-good commit (docs/DEPLOYMENT.md, "Release rollback").' >&2
else
  echo 'CRITICAL: the rollback failed; the release that failed the public smoke test may still be live. Production needs manual recovery (docs/DEPLOYMENT.md, "Release rollback").' >&2
fi
# fluxradar:end-public-smoke-rollback
exit 1
