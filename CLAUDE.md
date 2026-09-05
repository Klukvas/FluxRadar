# FluxRadar agent protocol

Every coding agent working in this repository must emit progress checkpoints as soon as each phase is reached. Checkpoints are separate progress events, not part of the final summary.

Use these exact prefixes:

```text
CHECKPOINT STARTED | <what you are doing>
CHECKPOINT PLAN_READY | <short plan and files likely involved>
CHECKPOINT CODE_READY | <files changed and what was implemented>
CHECKPOINT TESTING | <commands currently running>
CHECKPOINT DONE | <result, tests passed, and remaining concerns>
```

If work cannot continue, emit one of these immediately:

```text
CHECKPOINT BLOCKED | <specific reason and what is needed>
CHECKPOINT FAILED | <specific failure and attempted recovery>
```

Rules:

- Emit `STARTED` before repository exploration.
- Emit `PLAN_READY` before the first edit.
- Emit `CODE_READY` immediately after implementation, before a long test/build command.
- Emit `TESTING` immediately before tests, lint, typecheck, build, browser checks, or deployment checks.
- Emit `DONE` only after the requested work and verification are actually complete.
- For commands expected to take more than 60 seconds, emit a short progress update at least every 90 seconds.
- Never wait until the final response to report a checkpoint.
- Do not claim a test passed without running it, and do not hide a failed or skipped check.
- Do not edit secrets or deployment configuration unless the task explicitly requires it.

For the reusable launch wrapper and the full orchestration policy, see [`docs/AGENT_CHECKPOINTS.md`](docs/AGENT_CHECKPOINTS.md).
