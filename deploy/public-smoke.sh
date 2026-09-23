#!/usr/bin/env bash
#
# Public smoke test: is FluxRadar actually reachable, over a valid certificate,
# from outside the server?
#
# This is the last gate of a deploy and the only one that looks at the
# deployment the way a customer's browser does. It therefore runs from the
# GitHub runner, not over SSH on the host: a check that curls the site from the
# machine that serves it cannot see a DNS record that was never published, a
# certificate that was never issued, or a proxy in front that is refusing
# traffic.
#
# Every one of those used to pass silently. The old check ran `curl --insecure`,
# which accepts an expired, self-signed or wrong-host certificate, asserted
# nothing about the status code or the body, and exited 0 when the hostname did
# not resolve at all. So this script:
#
#   * resolves the hostname explicitly and fails when it does not resolve;
#   * validates the certificate (no --insecure, ever) and checks curl's own
#     verification result;
#   * requires https to the end, so a redirect to http is a failure;
#   * asserts the HTTP status, the response body and, for the SPA document, the
#     security headers the Caddyfile is supposed to be setting — including the
#     Content-Security-Policy, which is what keeps the paid checkout working and
#     inline script out, and which nothing else looks at after a deploy.
#
# Usage:
#   public-smoke.sh [--host HOST] [--attempts N] [--delay SECONDS]
#                   [--base-url URL] [--cacert PATH]
#
#   --base-url  target something other than https://HOST (a staging host).
#   --cacert    verify against this CA bundle instead of the system store. For
#               a staging certificate and for this repository's own tests; it
#               makes verification stricter, never weaker.

set -Eeuo pipefail

HOST="${FLUXRADAR_PUBLIC_HOST:-fluxradar.net}"
BASE_URL=""
CACERT=""
ATTEMPTS="${FLUXRADAR_PUBLIC_SMOKE_ATTEMPTS:-8}"
DELAY="${FLUXRADAR_PUBLIC_SMOKE_DELAY:-5}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    --cacert) CACERT="$2"; shift 2 ;;
    --attempts) ATTEMPTS="$2"; shift 2 ;;
    --delay) DELAY="$2"; shift 2 ;;
    -h|--help) sed -n '3,33p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf 'public-smoke: unknown argument "%s"\n' "$1" >&2; exit 64 ;;
  esac
done

: "${BASE_URL:=https://$HOST}"

log() { printf '[smoke] %s\n' "$*"; }
fail() { printf '[smoke] FAIL: %s\n' "$*" >&2; exit 1; }

case "$BASE_URL" in
  https://*) ;;
  *) fail "base URL must be https:// (got \"$BASE_URL\"); a plaintext public check proves nothing" ;;
esac

# ---- DNS -------------------------------------------------------------------
# A hostname that does not resolve is the failure the previous version reported
# as a success. It is a hard failure here: without DNS there is no public
# deployment, whatever the containers on the server are doing.
resolve_host() {
  if command -v getent >/dev/null 2>&1; then
    getent ahosts "$1" 2>/dev/null | awk 'NF { print $1 }' | sort -u
  elif command -v dig >/dev/null 2>&1; then
    dig +short "$1" A; dig +short "$1" AAAA
  elif command -v host >/dev/null 2>&1; then
    host "$1" 2>/dev/null | awk '/has (IPv6 )?address/ { print $NF }'
  else
    return 2
  fi
}

# Prints nothing when the hostname resolves, and the reason when it does not.
# It reports rather than exits so that it can be retried with the rest of the
# checks: a record published moments ago may still be propagating, and a deploy
# should not fail on the first lookup — only on the last one.
dns_failure() {
  local addresses status
  set +e
  addresses="$(resolve_host "$HOST")"
  status=$?
  set -e
  # STDOUT of this function is the failure text and nothing else — the caller
  # captures it. Everything informational goes to stderr, or it would be read as
  # a failure that is not one.
  if [ "$status" -eq 2 ]; then
    # No resolver tool at all. Do not pass on that: curl below still resolves
    # the name, and its exit code 6 is reported as a DNS failure.
    log 'WARNING: no getent/dig/host available; DNS is checked through curl only' >&2
    return 0
  fi
  if [ -z "$addresses" ]; then
    printf '%s\n' "DNS: $HOST does not resolve; publish an A/AAAA record for it at the registrar before deploying"
    return 0
  fi
  log "DNS: $HOST resolves to $(printf '%s' "$addresses" | tr '\n' ' ')" >&2
}

# ---- HTTP ------------------------------------------------------------------
# curl exit codes, translated into what an operator has to fix. Anything TLS is
# reported as TLS: the certificate is the thing this script exists to stop
# ignoring.
describe_curl_failure() {
  case "$1" in
    6) printf 'DNS: the hostname could not be resolved' ;;
    7) printf 'connection refused or unreachable' ;;
    28) printf 'timed out' ;;
    35|53|54|58|59|60|66|77|80|82|83|91)
      printf 'TLS: the certificate could not be verified (expired, self-signed, or issued for another host)' ;;
    *) printf 'curl exit code %s' "$1" ;;
  esac
}

BODY_FILE="$(mktemp)"
trap 'rm -f -- "$BODY_FILE" "$BODY_FILE.headers"' EXIT

# Checks one endpoint. `expected_body` is an extended regular expression the body
# must match; `expected_headers` (optional) is a COMMA-separated list of extended
# regular expressions, each of which the response headers must match.
check_endpoint() {
  local path="$1" expected_status="$2" expected_body="$3" expected_headers="${4:-}"
  local url="$BASE_URL$path"
  local -a curl_args=(
    --silent --show-error --location
    --proto '=https' --proto-redir '=https'
    --tlsv1.2
    --max-time 15
    --dump-header "$BODY_FILE.headers"
    --output "$BODY_FILE"
    --write-out '%{http_code} %{ssl_verify_result} %{url_effective}'
  )
  # NOTE: --insecure/-k must never appear here. It is what let a broken
  # certificate ship unnoticed; DEPLOY-007 asserts this file contains neither.
  if [ -n "$CACERT" ]; then curl_args+=(--cacert "$CACERT"); fi

  local output status
  set +e
  output="$(curl "${curl_args[@]}" "$url" 2>&1)"
  status=$?
  set -e
  if [ "$status" -ne 0 ]; then
    printf '%s\n' "$path: $(describe_curl_failure "$status")"
    return 1
  fi

  local http_code verify_result effective_url
  http_code="$(printf '%s' "$output" | awk '{ print $1 }')"
  verify_result="$(printf '%s' "$output" | awk '{ print $2 }')"
  effective_url="$(printf '%s' "$output" | awk '{ print $3 }')"

  if [ "$verify_result" != "0" ]; then
    printf '%s\n' "$path: TLS certificate verification returned $verify_result"
    return 1
  fi
  case "$effective_url" in
    https://*) ;;
    *) printf '%s\n' "$path: ended at $effective_url — the request was downgraded off https"; return 1 ;;
  esac
  if [ "$http_code" != "$expected_status" ]; then
    printf '%s\n' "$path: HTTP $http_code (expected $expected_status)"
    return 1
  fi
  if ! grep -Eq "$expected_body" "$BODY_FILE"; then
    printf '%s\n' "$path: HTTP $http_code but the body does not match /$expected_body/"
    return 1
  fi
  if [ -n "$expected_headers" ]; then
    local -a header_patterns=()
    local header_pattern
    IFS=',' read -r -a header_patterns <<< "$expected_headers"
    for header_pattern in "${header_patterns[@]}"; do
      if ! grep -Eiq "$header_pattern" "$BODY_FILE.headers"; then
        printf '%s\n' "$path: response is missing the header /$header_pattern/"
        return 1
      fi
    done
  fi
  return 0
}

# What "the site is up" means, stated as checks rather than as a 200:
#   /api/health        the API process answers through Caddy;
#   /api/health/ready  it can reach PostgreSQL (the readiness contract, CR-04);
#   /                  the SPA document is served, with the security headers
#                      deploy/Caddyfile is responsible for.
run_checks() {
  local failures=() check path expected body headers result ok dns
  # A hostname that does not resolve makes every endpoint check report the same
  # thing less clearly, so it is answered first and on its own.
  dns="$(dns_failure)"
  if [ -n "$dns" ]; then
    printf '%s\n' "$dns"
    return 1
  fi
  for check in \
    '/api/health|200|"status":"ok"|' \
    '/api/health/ready|200|"status":"ready"|' \
    '/|200|<title>FluxRadar|^strict-transport-security:,^content-security-policy:.*default-src'
  do
    IFS='|' read -r path expected body headers <<< "$check"
    set +e
    result="$(check_endpoint "$path" "$expected" "$body" "$headers")"
    ok=$?
    set -e
    if [ "$ok" -ne 0 ]; then failures+=("$result"); fi
  done
  if [ "${#failures[@]}" -gt 0 ]; then
    printf '%s\n' "${failures[@]}"
    return 1
  fi
  return 0
}

attempt=1
while :; do
  set +e
  report="$(run_checks)"
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    log "public smoke passed for $BASE_URL (DNS, certificate, status, body, headers)"
    exit 0
  fi
  if [ "$attempt" -ge "$ATTEMPTS" ]; then
    printf '%s\n' "$report" >&2
    fail "public smoke failed for $BASE_URL after $attempt attempt(s)"
  fi
  log "attempt $attempt/$ATTEMPTS did not pass yet:"
  printf '%s\n' "$report"
  attempt=$((attempt + 1))
  sleep "$DELAY"
done
