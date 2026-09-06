#!/usr/bin/env bash

set -Eeuo pipefail

if [[ $# -eq 0 ]]; then
  printf 'Usage: %s "task for the coding agent"\n' "$0" >&2
  exit 64
fi

if ! command -v claude >/dev/null 2>&1; then
  printf 'claude CLI is not installed or is not on PATH\n' >&2
  exit 127
fi

agent_task="$*"
agent_model="${CLAUDE_MODEL:-opus}"
agent_run_root="${FLUXRADAR_AGENT_RUN_DIR:-${TMPDIR:-/tmp}/fluxradar-agent-runs}"
agent_run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
agent_log_file="$agent_run_root/$agent_run_id.jsonl"

mkdir -p -- "$agent_run_root"

agent_protocol=$'Before doing any repository work, emit:\nCHECKPOINT STARTED | <what you are doing>\n\nAfter inspection and before edits, emit:\nCHECKPOINT PLAN_READY | <short plan and files likely involved>\n\nWhile investigating or running a long command, emit concise operational updates (not private chain-of-thought) in this form:\nPROGRESS | <phase> | <observable files, command, or check> | <next step>\nEmit one at least every 90 seconds for commands expected to take more than 60 seconds.\n\nImmediately after implementation and before long verification, emit:\nCHECKPOINT CODE_READY | <files changed and what was implemented>\n\nImmediately before tests, lint, typecheck, build, browser checks, or deployment checks, emit:\nCHECKPOINT TESTING | <commands currently running>\n\nAfter all requested work and verification is complete, emit:\nCHECKPOINT DONE | <result, tests passed, and remaining concerns>\n\nIf you cannot continue, emit immediately:\nCHECKPOINT BLOCKED | <specific reason and what is needed>\nor\nCHECKPOINT FAILED | <specific failure and attempted recovery>\n\nEmit checkpoints as soon as they are reached; never wait until the final response. A quiet terminal is not evidence that you are stuck. Do not claim checks passed without running them.'

agent_prompt="${agent_protocol}"$'\n\nTask:\n'"${agent_task}"

printf 'CHECKPOINT LAUNCHED | run=%s model=%s log=%s\n' "$agent_run_id" "$agent_model" "$agent_log_file"

set +e
claude \
  --model "$agent_model" \
      --dangerously-skip-permissions \
      --print \
      --verbose \
      --output-format stream-json \
  --include-partial-messages \
  "$agent_prompt" \
  | tee "$agent_log_file"
agent_exit=${PIPESTATUS[0]}
set -e

printf 'CHECKPOINT PROCESS_EXIT | run=%s exit=%s\n' "$agent_run_id" "$agent_exit"
exit "$agent_exit"
