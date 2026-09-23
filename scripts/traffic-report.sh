#!/usr/bin/env bash
# A cookieless traffic report for fluxradar.net, built from Caddy's access log.
#
#   scripts/traffic-report.sh <user@host> [days]
#
# GA4 counts only the visitors who accept analytics cookies, and never a
# crawler. Caddy logs every request, privacy-filtered before it is written
# (masked IPs, no one-time secrets — see the `log` block in deploy/Caddyfile).
# This script reads the live and rotated logs out of the
# production caddy container over SSH, keeps the last [days] days, and renders
# them with a local GoAccess into traffic-reports/, which git ignores.
#
# Read-only on the server: it finds one container and reads files in it.
# <user@host> is anything `ssh` accepts that reaches the production host as a
# user allowed to run `docker` — the PRODUCTION_SSH_USER@PRODUCTION_SSH_HOST the
# deploy uses, or an alias from ~/.ssh/config. Nothing here stores it.
#
# TRAFFIC_REPORT_DIR overrides where the report is written.

set -euo pipefail

# `-p fluxradar` in deploy/release.sh; `name: fluxradar` in docker-compose.yml.
readonly COMPOSE_PROJECT='fluxradar'
# Where `output file` in deploy/Caddyfile writes, on the caddy_data volume.
readonly LOG_DIR='/data/logs'
readonly DEFAULT_DAYS=7
# The Privacy Policy keeps these logs for at most 30 days, so a longer window
# has nothing to show — and an entry older than this is a retention bug.
readonly MAX_DAYS=30
readonly SECONDS_PER_DAY=86400
# A leading "-" would reach ssh as an option; `-oProxyCommand=…` runs a command.
readonly TARGET_PATTERN='^[A-Za-z0-9_][A-Za-z0-9_.@:-]*$'
readonly DAYS_PATTERN='^[1-9][0-9]?$'

# User-agent tokens GoAccess files under "AI Crawlers" in its Browsers panel.
# GoAccess 1.12 has that group built in, older releases lump these bots into
# "Crawlers" or "Unknown"; handing it this list makes the grouping the same on
# every version. It covers every agent the AI-readiness audit checks
# (packages/rules/src/ai-readiness.ts) that sends a user agent at all —
# Google-Extended is a robots.txt token only — which DEPLOY-018 pins.
readonly AI_CRAWLERS=(
  GPTBot
  ChatGPT-User
  OAI-SearchBot
  ClaudeBot
  Claude-User
  Claude-SearchBot
  anthropic-ai
  PerplexityBot
  Perplexity-User
  Bytespider
  CCBot
  meta-externalagent
  meta-externalfetcher
  Amazonbot
  MistralAI-User
  DuckAssistBot
  cohere-ai
)

usage() {
  cat >&2 <<USAGE
Usage: scripts/traffic-report.sh <user@host> [days]

  <user@host>  SSH target of the production server, as a user that can run
               docker (the deploy's PRODUCTION_SSH_USER@PRODUCTION_SSH_HOST),
               or a host alias from ~/.ssh/config.
  [days]       How many days back to report: 1-$MAX_DAYS, default $DEFAULT_DAYS.
USAGE
}

fail() {
  printf 'traffic-report: %s\n' "$*" >&2
  exit 1
}

# Streams every access log line on the server to stdout: rotated files first,
# oldest first (their names carry the roll time), then the live file. Rotated
# files are gzipped by Caddy; one caught mid-compression is still plain text.
fetch_logs() {
  ssh -o ConnectTimeout=15 -- "$1" sh -s -- "$COMPOSE_PROJECT" "$LOG_DIR" <<'REMOTE'
set -eu
project="$1"
log_dir="$2"
container="$(docker ps -q \
  --filter "label=com.docker.compose.project=$project" \
  --filter "label=com.docker.compose.service=caddy" | head -n 1)"
if [ -z "$container" ]; then
  echo "No running caddy container in the '$project' compose project on this host." >&2
  exit 3
fi
docker exec "$container" sh -c '
  cd "$1" || exit 4
  for file in access-*.log.gz access-*.log access.log; do
    [ -f "$file" ] || continue
    case "$file" in
      *.gz) gzip -dc "$file" ;;
      *) cat "$file" ;;
    esac
  done
' sh "$log_dir"
REMOTE
}

line_count() {
  wc -l <"$1" | tr -d ' '
}

# The oldest `ts` (Unix seconds) in a Caddy JSON log, or nothing when it has none.
oldest_timestamp() {
  awk 'match($0, /"ts":[0-9.]+/) {
    ts = substr($0, RSTART + 5, RLENGTH - 5) + 0
    if (oldest == "" || ts < oldest) oldest = ts
  }
  END { if (oldest != "") printf "%.0f\n", oldest }' "$1"
}

warn_if_past_retention() {
  local oldest="$1" now="$2" age_days
  [[ -n "$oldest" ]] || return 0
  age_days=$(((now - oldest) / SECONDS_PER_DAY))
  if ((age_days > MAX_DAYS)); then
    printf 'WARNING: the oldest access log entry on the server is %s days old, past the %s days the Privacy Policy allows.\n' \
      "$age_days" "$MAX_DAYS" >&2
    printf 'Lower roll_size in the access log block of deploy/Caddyfile, then redeploy.\n' >&2
  fi
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage
  exit 64
fi
target="$1"
days="${2:-$DEFAULT_DAYS}"
if [[ ! "$target" =~ $TARGET_PATTERN ]]; then
  usage
  fail "'$target' is not an SSH target like deploy@203.0.113.10 or a ~/.ssh/config alias."
fi
if [[ ! "$days" =~ $DAYS_PATTERN ]] || ((days > MAX_DAYS)); then
  usage
  fail "days must be a whole number from 1 to $MAX_DAYS, not '$days'."
fi
if ! command -v goaccess >/dev/null 2>&1; then
  printf 'traffic-report: goaccess is not installed. Install it with: brew install goaccess\n' >&2
  exit 127
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
report_dir="${TRAFFIC_REPORT_DIR:-$script_dir/../traffic-reports}"
# The raw lines and the report hold masked IPs and user agents: owner-only.
umask 077
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/fluxradar-traffic.XXXXXX")"
trap 'rm -rf -- "$work_dir"' EXIT

raw_log="$work_dir/access.log"
window_log="$work_dir/window.log"
browsers_file="$work_dir/browsers.list"

printf 'Reading the access log from %s...\n' "$target" >&2
if ! fetch_logs "$target" >"$raw_log"; then
  fail "could not read the access log from $target (the ssh or docker error is above)."
fi
if [[ "$(line_count "$raw_log")" -eq 0 ]]; then
  fail "the access log on $target is empty. Has a release with the Caddyfile log block been deployed?"
fi

now="$(date +%s)"
warn_if_past_retention "$(oldest_timestamp "$raw_log")" "$now"

cutoff=$((now - days * SECONDS_PER_DAY))
awk -v cutoff="$cutoff" \
  'match($0, /"ts":[0-9.]+/) && substr($0, RSTART + 5, RLENGTH - 5) + 0 >= cutoff' \
  "$raw_log" >"$window_log"
requests="$(line_count "$window_log")"
if [[ "$requests" -eq 0 ]]; then
  fail "no requests in the last $days days; try a longer window."
fi

for agent in "${AI_CRAWLERS[@]}"; do
  printf '%s\t%s\n' "$agent" 'AI Crawlers'
done >"$browsers_file"

mkdir -p -- "$report_dir"
report_dir="$(cd -- "$report_dir" && pwd)"
report="$report_dir/fluxradar-traffic-$(date -u +%Y%m%dT%H%M%SZ)-${days}d.html"
goaccess "$window_log" \
  --log-format=CADDY \
  --browsers-file="$browsers_file" \
  --html-report-title="fluxradar.net, last $days days" \
  --output="$report" </dev/null

printf 'Traffic report (%s requests, last %s days): %s\n' "$requests" "$days" "$report"
if [[ -t 1 && "$(uname -s)" == Darwin ]]; then
  open "$report"
fi
