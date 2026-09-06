# Agent checkpoints and orchestration policy

This repository uses explicit progress checkpoints so an orchestrator can distinguish a running agent from a failed or blocked one. The multi-agent batch contract, shared artifacts, and cancellation rules are defined in [`AGENT_ORCHESTRATION.md`](./AGENT_ORCHESTRATION.md).

## Required lifecycle

| Checkpoint | When it is required | Minimum content |
|---|---|---|
| `STARTED` | Before reading or changing files | Task and current phase |
| `PLAN_READY` | After initial inspection, before edits | Short plan and likely files |
| `CODE_READY` | After implementation, before long verification | Changed files and behavior |
| `TESTING` | Immediately before verification | Exact commands or browser checks |
| `PROGRESS` | During investigation or any long-running command | Current observable phase, command/surface, and next step |
| `DONE` | Only after all requested work is verified | Result, checks, remaining concerns |
| `BLOCKED` | When user input or external state is required | Concrete blocker and next action |
| `FAILED` | When recovery did not work | Failure, attempted recovery, next action |

Agents must emit each checkpoint immediately, not accumulate them for the final answer. During investigation they must emit concise operational `PROGRESS` updates; private chain-of-thought is not required or exposed. Long-running commands require a progress update at least every 90 seconds. A quiet terminal is not itself evidence that an agent is stuck.

## Stop policy

Do not stop an agent solely because there is no terminal output. First check:

1. whether the agent process is alive;
2. whether the repository or its worktree is changing;
3. whether a test, build, browser, or network subprocess is running;
4. whether the agent emitted a checkpoint or requested input.

Stop only after a hard time limit (normally 30 minutes), a process failure, an explicit `BLOCKED`/`FAILED` state, or three consecutive checks showing that the process is gone and no checkpoint or repository progress exists. A polling timeout alone is never a reason to cancel. If the agent is alive and making progress, extend the wait instead of launching a conflicting duplicate.

## Launch wrapper

Use [`scripts/run-claude-agent.sh`](../scripts/run-claude-agent.sh) for Claude CLI coding tasks. It injects the checkpoint protocol, enables stream output, mirrors output to the terminal, and keeps a JSONL run log under `/tmp/fluxradar-agent-runs` (or `$FLUXRADAR_AGENT_RUN_DIR`).

Example:

```bash
scripts/run-claude-agent.sh "Fix the report completion state and add regression tests"
```

The default model is Opus. Override it only when needed:

```bash
CLAUDE_MODEL=sonnet scripts/run-claude-agent.sh "Run a focused code review"
```

Run logs can contain agent output and must not be committed. They may be removed after the run when no longer needed.
