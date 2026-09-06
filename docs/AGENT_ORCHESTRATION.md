# Claude agent orchestration contract

This document defines how multiple Claude coding or review agents are launched and observed. It is the operational companion to [`AGENT_CHECKPOINTS.md`](./AGENT_CHECKPOINTS.md).

## Core rule

The orchestrator reads each agent's stdout as a live event stream. A missing final answer is not a reason to cancel an agent.

The orchestrator must distinguish these states:

- `starting` — Claude, hooks, plugins, MCP, or authentication are initializing;
- `investigating` — the agent is reading code, reproducing a problem, or forming a plan;
- `editing` — the agent is changing files;
- `verifying` — the agent is running tests, builds, browser checks, or deployment checks;
- `blocked` — the agent explicitly reports a dependency or asks for input;
- `failed` — the process exited unsuccessfully or recovery failed;
- `completed` — the agent emitted `DONE` and returned a valid result;
- `timed_out` — the supervisor deadline expired after diagnostics and graceful shutdown.

`investigating` is a valid productive state. It must never be treated as a hang merely because no code has changed yet.

## What agents must print

Agents must emit concise operational updates to stdout. These are not private chain-of-thought and must not expose hidden reasoning. Every update must describe observable work:

```text
CHECKPOINT STARTED | task and current phase
CHECKPOINT PLAN_READY | files or surfaces to inspect and intended approach
PROGRESS | investigating | files/commands being inspected | next step
CHECKPOINT CODE_READY | changed files and implemented behavior
CHECKPOINT TESTING | exact commands or browser checks
PROGRESS | verifying | current check and its status | next step
CHECKPOINT DONE | result, checks passed, and remaining concerns
```

For a command expected to take more than 60 seconds, the agent must emit a `PROGRESS` update at least every 90 seconds. Before and after a long command, the update must name the command or check. If the agent cannot continue, it must emit `BLOCKED` or `FAILED` with the concrete reason.

## Batch artifacts

For a group of agents, the batch is the unit of persistence. Do not require one permanent JSON file per agent.

The orchestrator maintains only these shared artifacts:

```text
<batch-dir>/batch-state.json
<batch-dir>/batch-result.md
```

`batch-state.json` contains an `agents` map keyed by agent id. Each entry stores at least `status`, `last_event_at`, `last_checkpoint`, `active_command`, `changed_files`, `exit_code`, and `failure_reason` when applicable. Stdout events are parsed into this state in memory and flushed atomically.

`batch-result.md` contains one concise final section per agent and a batch summary. Raw per-agent JSONL is optional diagnostic data only: retain it on failure or timeout, and clean it up after a successful batch when no investigation is needed.

The live UI/terminal should prefix every line with the agent id, for example:

```text
[agent seo] PROGRESS | investigating | apps/api/src/orchestrator | checking scan phases | next: trace persistence
[agent ux] CHECKPOINT TESTING | pnpm --filter @fluxradar/web test
```

## Cancellation policy

The orchestrator must not cancel an agent solely because:

- the final response has not arrived;
- the terminal appears quiet;
- a polling call timed out;
- the agent is still in `investigating`;
- no file has changed yet;
- a long test, build, browser, or network command is running.

Before cancellation, the orchestrator checks, in order:

1. whether the Claude process is alive;
2. whether stdout events, checkpoints, or heartbeat timestamps are advancing;
3. whether the repository/worktree or active child command is changing;
4. whether the agent requested input or reported `BLOCKED`/`FAILED`;
5. whether the hard deadline has actually expired.

Only an explicit terminal state, a process failure, or an expired hard deadline after diagnostics permits cancellation. A polling timeout is an observer event, not an agent state.

## Launch requirements

All coding agents must be launched through the supervised runner or an equivalent batch runner. Direct ad-hoc Claude commands are allowed only for controlled diagnostics and must not be used to decide that a production task is stuck.

Each agent receives a unique id and a declared write scope. Coding agents use isolated worktrees or an exclusive repository lock; review agents are read-only or use a separate worktree. The orchestrator must not launch a conflicting duplicate while the original agent is alive and making progress.

## Completion requirements

An agent is complete only when all of the following are true:

- the process exits successfully;
- `CHECKPOINT DONE` was observed;
- the final output states changed files and verification results;
- the batch state was updated;
- the batch result contains the agent's summary.

If any of these is missing, the result is `failed`, `blocked`, or `timed_out`, not silently successful.
