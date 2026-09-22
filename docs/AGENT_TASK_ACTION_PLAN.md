# Agent task: implement the Action Plan feature

How to launch (for the person, not the agent): from a worktree that contains this file,

```bash
scripts/run-claude-agent.sh "$(cat docs/AGENT_TASK_ACTION_PLAN.md) Scope: A"
```

The last words of the task select the scope (see "Scope"). Everything below is the task text.

---

## Task

Implement the Action Plan feature of FluxRadar as specified in `docs/PLAN_ACTION_PLAN.md`. On a
Complete scan report the owner presses a button and Claude writes a prioritized plan of fixes; the
API stores it per (scan, language) and the web app shows it in the report and in the print view.

Read, in this order, before touching code:

1. `docs/PLAN_ACTION_PLAN.md` — the spec. Follow it phase by phase.
2. `docs/CONTEXT.md` — the vocabulary. Use these terms in identifiers, copy and comments
   (`ActionPlan`, `Overview`, `Action`, `Reach`, `Plan Window`, `Open Issue`); never call the
   plan a "summary".
3. `docs/DECISIONS.md`, entry **D-232** — why the design is the way it is. These decisions are
   settled; do not re-litigate them.
4. `CLAUDE.md` — the checkpoint protocol (`STARTED`, `PLAN_READY`, `PROGRESS`, `CODE_READY`,
   `TESTING`, `DONE` / `BLOCKED` / `FAILED`). Emit checkpoints as you reach them, never at the
   end.

## Scope

The plan has six phases. This task covers phases 1–5 as two pull requests:

- **Scope A** — phases 1 and 2: shared declarations and the `packages/ai` module. No database
  change. Branch `feat/action-plan-packages`, PR title
  `feat: Action Plan prompt module and shared declarations`.
- **Scope B** — phases 3, 4 and 5: API with its migration, web, legal copy. Branch
  `feat/action-plan`, PR title `feat: Action Plan on the Complete report`. Branch it from
  `feat/action-plan-packages` while that PR is open, otherwise from `origin/main`.

If the task text ends with `Scope: A` or `Scope: B`, do only that scope. Otherwise do A, open
its PR, then continue with B on top of it.

This task is re-runnable. Before planning, check what already exists on the branch
(`packages/ai/src/action-plan-module.ts`, `ACTION_PLAN_LANGUAGES` in `packages/contracts`, the
`ActionPlan` Prisma model, `apps/api/src/action-plan/`, `apps/web/src/ActionPlan.tsx`) and
continue from the first unfinished step instead of redoing finished ones.

**Not in this task:**

- Phase 6 (the quality gate). Never call Anthropic for real and never scan a third-party site.
  All tests use the mock provider. If `ANTHROPIC_API_KEY` is present in `.env`, do not use it.
- The pricing-page row (after release), the pre-purchase notice version, `ENTITLEMENT_DAYS`,
  anything under `deploy/` or `.github/`, secrets, and `.env*` files.
- Merging. The owner merges; you push and open the PR.
- Adding `@anthropic-ai/sdk`, or any workspace dependency to `apps/web`.

## Environment

The shell's default `node` is v18 and the repo needs 24. Before every `pnpm`, `npx`, `node`,
`vitest` or `tsc` command:

```bash
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
```

Shells do not keep exports between tool calls; put the prefix in each command.

Fresh-worktree bootstrap (run once; everything is idempotent). `.env` is gitignored and lives in
the main checkout:

```bash
cp /Users/andreypavlenko/Desktop/Projects/FluxRadar/.env .env
pnpm install --frozen-lockfile
pnpm -r --filter './packages/*' build
(cd apps/api && npx prisma generate && npx tsc -p tsconfig.build.json)
```

Facts you would otherwise learn the hard way:

- `apps/api` and `apps/web` import workspace packages through each package's `dist`. After any
  change under `packages/*/src`, rebuild (`pnpm -r --filter './packages/*' build`) before
  typechecking or testing an app; otherwise `tsc` reports a missing export that plainly exists,
  or fifteen unrelated API tests fail at once.
- API tests need `TEST_DATABASE_URL` from `.env` (local Postgres on `localhost:5432`, no
  Docker). The vitest global setup runs `prisma migrate deploy` against that database — the
  **shared** `fluxradar_test` used by every checkout on this machine. Your migration must be
  purely additive (new tables, new nullable or defaulted columns); never drop or rename anything
  in this task.
- `apps/api/src/test-utils/test-db.ts` isolates test files with a hand-maintained `TRUNCATE`
  list. Add every new table to it in the same change.
- Full parallel API runs occasionally fail with `deadlock detected` or a spurious 401. Re-run
  the failing file alone before believing it.
- Prettier is red at baseline (about 80 pre-existing violations). Check only files you changed;
  never run `pnpm format`. A PostToolUse hook runs Prettier over any file you edit with the Edit
  tool — if that file was already non-compliant, revert the unrelated reformatting so the diff
  stays yours.
- Web tests mock `fetch` with path switches whose fallback answers any `/scans/...` path with a
  scan or dashboard object. A hook that trusts its response shape crashes about forty unrelated
  tests. Shape-check every response; treat a mismatch as "unavailable" and render nothing.
- `App.test.tsx` and `Faq.test.tsx` assert the exact list of API paths a public page requests
  on mount. Nothing you add may fetch at the `App` root; the Action Plan block lives inside the
  report screens only.
- `apps/web` has no workspace dependencies on purpose. Anything the API and the web must agree
  on is declared twice and pinned by an API-side contract test that reads the web source file —
  precedent: `apps/api/src/billing/checkout-metadata.test.ts` reading
  `apps/web/src/ai-processing-notice.ts`. Use the same pattern for the rule titles and the
  language list.
- Name the migration with a timestamp later than the newest directory in
  `apps/api/prisma/migrations/` (on 2026-09-21 that was `20260923100000_…`).

## Verification

Run the relevant part before every commit, and all of it before opening a PR:

```bash
# packages
pnpm --filter @fluxradar/ai test
pnpm --filter @fluxradar/rules test
pnpm --filter @fluxradar/contracts test
pnpm -r --filter './packages/*' build && pnpm -r --filter './packages/*' typecheck

# api (from apps/api; a path argument narrows the run while iterating)
NODE_ENV=test node --env-file-if-exists=../../.env ../../node_modules/vitest/vitest.mjs run
npx prisma generate && npx tsc --noEmit

# web (from apps/web)
npx vitest run
npx tsc --noEmit

# only your files, from the repo root
npx eslint <changed .ts/.tsx files>
npx prettier --check <changed .ts/.tsx/.css/.md files>
```

Report the test counts you saw, and any failure you could not explain, verbatim. Do not claim a
check passed without running it.

## Claude API rules (phase 2)

- Keep the raw-`fetch` `AnthropicProvider` in `packages/ai`. Do not introduce the SDK.
- Model constant `claude-opus-5`. Omit `thinking` (Opus 5 thinks adaptively by default); never
  send `budget_tokens`, `temperature`, `top_p` or an assistant prefill. `max_tokens` of about
  16000 for the plan request, so thinking plus the answer fit.
- Structured output stays `output_config.format` with the JSON schema, as the provider already
  does; still parse the result with zod, because the schema cannot express the cross-field rules.
- Refusal fallbacks: body `"fallbacks": "default"` plus the header
  `anthropic-beta: server-side-fallback-2026-07-01`. Store `payload.model` as the model that
  served the answer. A final `stop_reason` of `refusal` is a failed attempt.
- Every AI test uses `MockAiProvider`; extend it for the larger caps rather than bypassing it.

## Deviations and blocking

You run unattended; nobody answers questions. When the plan and the code disagree:

- If the fix keeps every D-232 decision (what is sent to Anthropic, the limits, the consent
  line, the Plan Window, no Analytics data, no export, one rule per Action), take the smallest
  deviation, keep going, and list it under "Deviations from the plan" in the PR.
- If it would change a D-232 decision, or the shared test database refuses to migrate
  (`P3009`), or the worktree cannot bootstrap: commit what is verified, push, and emit
  `CHECKPOINT BLOCKED` with the exact conflict and the options.

Do not widen the task. Anything you notice outside it goes into a "Noticed, not done" list in
the final report.

## Git and pull requests

- Start from a fresh `git fetch origin`; branch names are above.
- One commit per plan phase, or smaller. Message: `<type>: <description>`, and a body that says
  why, written for someone reading `git log` in six months. Follow the attribution rules in
  effect for your session.
- Never `push --force`, never commit `.env`, never rewrite history that is already pushed.
- Push with `-u` and open the PR with `gh pr create` against `main`. Body sections, in this
  order: **What changed**, **Notes**, **Deviations from the plan**, **How to verify** (exact
  commands and the counts you saw). Scope B's body starts with one bold line:
  **Contains a migration — merging deploys it to production after the pre-migration snapshot.**
- Leave the PR open and report its URL.

## Definition of done

Scope A is done when the phase 1–2 files exist with their tests, `packages/*` build and
typecheck, both apps typecheck against the rebuilt `dist`, the API and web suites are still
green, and the PR is open.

Scope B is done when the migration applies through the test run, every test in the plan's
"Tests" section exists and passes, the full API and web suites are green, eslint and prettier
are clean on your files, the legal copy is updated in both languages, the dry-run tool prints a
prompt with no `evidence_excerpt` and no Analytics rule, and the PR is open with the migration
warning.

If you reach two hours of wall-clock time inside a scope, finish the phase you are in, commit,
push, open a draft PR and emit `CHECKPOINT DONE` with what remains; the task will be relaunched.

## Final report

`CHECKPOINT DONE |` followed by: changed files by phase; every verification command with its
result; PR URL(s); deviations; "Noticed, not done"; and the three things the owner does next —
merge A, decide when to merge B (it carries the migration), and run phase 6 starting from the
dry-run tool.
