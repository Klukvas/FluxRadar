# Agent task: OpenAI as a second GEO provider, web search on both

How to launch (for the person, not the agent): from a worktree that contains this file,

```bash
scripts/run-claude-agent.sh "$(cat docs/AGENT_TASK_GEO_PROVIDERS.md)"
```

Everything below is the task text.

---

## Task

Implement `docs/PLAN_GEO_PROVIDERS.md` in FluxRadar as **one pull request**: the AI SEO / GEO
module asks its visibility questions of OpenAI as well as Anthropic, both providers answer with
provider web search enabled, the answers are shown per provider in the report, and the
pre-purchase AI notice, the FAQ and the Privacy Policy say so.

Read, in this order, before touching code:

1. `docs/PLAN_GEO_PROVIDERS.md` — the spec. Follow it phase by phase; "Agreed behaviour" is
   settled unless "Deviations and blocking" below says otherwise.
2. `docs/CONTEXT.md` — the vocabulary.
3. `docs/DECISIONS.md`, entries **D-008**, **D-015**, **D-171 … D-179** and **D-217** — how the AI
   layer is built and why. Do not re-litigate them. You will append **D-233** (see phase 5).
4. `CLAUDE.md` — the checkpoint protocol (`STARTED`, `PLAN_READY`, `CODE_READY`, `TESTING`,
   `DONE` / `BLOCKED` / `FAILED`). Emit checkpoints as you reach them, never at the end.

## Scope

One branch, one PR: branch `feat/geo-openai-web-search` from `origin/main`, PR title
`feat: ask OpenAI and Claude with web search in the GEO module`. The plan's phases 1–5 are all in
scope; phase 6 is in scope only as the **tool** (`apps/api/src/orchestrator/geo-smoke.ts`), which
you write and typecheck but never run.

This task is re-runnable. Before planning, check what already exists on the branch
(`packages/ai/src/openai-provider.ts`, `packages/ai/src/routing-provider.ts`,
`apps/api/src/integrations/openai-config.ts`, `AI_PROCESSING_PROVIDERS` in
`apps/web/src/ai-processing-notice.ts`, the `geo-smoke.ts` tool, the D-233 entry) and continue
from the first unfinished step instead of redoing finished ones.

**Not in this task:**

- Calling any provider for real. `.env` holds a live `ANTHROPIC_API_KEY`; do not use it, and do
  not add an `OPENAI_API_KEY` to any file. Every test uses `MockAiProvider` through the
  `mockRoutingProvider` helper you add. `geo-smoke.ts` is written, typechecked and never executed.
- Secret **values** anywhere. You do edit `.env.example`, `.github/workflows/deploy.yml` and
  `docs/DEPLOYMENT.md` exactly as phase 5 lists (this task explicitly requires those deploy
  configuration edits); you never touch `deploy/*.sh`, GitHub secrets or variables.
- A database migration. There is none in this feature; do not add tables or columns.
- Perplexity or Google adapters, new GEO rules, parallel provider execution, `pause_turn`
  continuation, localised search, the §5 cost guard, the econ fixtures (the owner updates them
  after the live smoke).
- `FluxRadar-Feature-Plan.md` (the owner has uncommitted edits there) and the pricing page.
- Merging. The owner merges; you push and open the PR.
- Adding `openai`, `@anthropic-ai/sdk` or any workspace dependency to `apps/web`.

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
  Docker). The vitest global setup runs `prisma migrate deploy` against the **shared**
  `fluxradar_test` database used by every checkout on this machine. This feature adds no
  migration, so nothing to add to the `TRUNCATE` list in `apps/api/src/test-utils/test-db.ts`.
- The provider factory `createDefaultAiProvider` (`apps/api/src/orchestrator/geo.ts`) returns
  mocks when `NODE_ENV === 'test'` or `VITEST === 'true'`. Keep that guard for the routing
  provider you build, and add the same guard to `geo-smoke.ts` (it refuses to run under Vitest).
- Full parallel API runs occasionally fail with `deadlock detected` or a spurious 401. Re-run
  the failing file alone before believing it.
- Prettier is red at baseline (about 80 pre-existing violations). Check only files you changed;
  never run `pnpm format`. A PostToolUse hook runs Prettier over any file you edit with the Edit
  tool — if that file was already non-compliant, revert the unrelated reformatting so the diff
  stays yours.
- Web tests mock `fetch` with path switches whose fallback answers any `/scans/...` path with a
  scan or dashboard object. Shape-check every field you read; a `provider` on an unavailable
  observation may be missing or null for reports written before this release.
- `App.test.tsx` and `Faq.test.tsx` assert the exact list of API paths a public page requests
  on mount. Nothing you add may fetch at the `App` root.
- `apps/web` has no workspace dependencies on purpose. Anything the API and the web must agree
  on is declared twice and pinned by an API-side contract test that reads the web source file —
  precedent: `apps/api/src/billing/checkout-metadata.test.ts` reading
  `apps/web/src/ai-processing-notice.ts`. Extend that test for `AI_PROCESSING_PROVIDERS`.
- `apps/web/src/workspace-i18n.test.tsx` pins en/uk key parity; every new copy key lands in
  both languages.
- `packages/ai` exports only `src/index.ts` (`testing/harness.ts` is not reachable from the
  apps), so `mockRoutingProvider` lives in `mock-provider.ts` and is exported from the index.
- The worker refreshes the job lease every ~100 s while an attempt runs
  (`apps/api/src/orchestrator/worker.ts`), so the longer GEO step needs no lease change.

## Verification

Run the relevant part before every commit, and all of it before opening the PR:

```bash
# packages
pnpm --filter @fluxradar/ai test
pnpm --filter @fluxradar/contracts test
pnpm -r --filter './packages/*' build && pnpm -r --filter './packages/*' typecheck

# api (from apps/api; a path argument narrows the run while iterating)
NODE_ENV=test node --env-file-if-exists=../../.env ../../node_modules/vitest/vitest.mjs run
npx prisma generate && npx tsc --noEmit
npx tsc --noEmit -p tsconfig.build.json   # geo-smoke.ts must typecheck with the build config

# web (from apps/web)
npx vitest run
npx tsc --noEmit

# only your files, from the repo root
npx eslint <changed .ts/.tsx files>
npx prettier --check <changed .ts/.tsx/.css/.md/.yml files>
```

Report the test counts you saw, and any failure you could not explain, verbatim. Do not claim a
check passed without running it.

## Provider API rules

- Keep both adapters raw `fetch` in `packages/ai`. No SDK.
- **Anthropic** (`anthropic-provider.ts`): the web search tool is the basic
  `web_search_20250305` with `name: 'web_search'` and `max_uses: AI_REQUEST_CAPS.maxSearchUnits`,
  added only when `request.webSearch` is set; never `web_search_20260209` or later (dynamic
  filtering adds code-execution blocks and is not ZDR-eligible). Visibility requests send
  `thinking: { type: 'disabled' }` through the existing `reasoningMode`. Citations come from
  `web_search_result_location` entries on text blocks; the search count from
  `usage.server_tool_use.web_search_requests`. A `web_search_tool_result` whose `content` is an
  error object is not fatal. `stop_reason: 'pause_turn'` keeps the text and maps to `'length'`.
  Remove the input-token clamp; keep the output clamp.
- **OpenAI** (`openai-provider.ts`): `POST https://api.openai.com/v1/responses` with
  `authorization: Bearer <key>`; body `model`, `instructions`, `input`, `max_output_tokens: 2000`,
  `store: false`, `reasoning: { effort: 'low' }`, and with `webSearch`:
  `tools: [{ type: 'web_search' }]` and `max_tool_calls: AI_REQUEST_CAPS.maxSearchUnits`. Nothing
  else (no `search_context_size`, `include`, `tool_choice`, `temperature`, `user`). With
  `responseSchema`: `text: { format: { type: 'json_schema', name, schema, strict: true } }`.
  Parse `output[]`: `web_search_call` items → `searchUnits`; `message` items' `output_text`
  parts → `rawText`, their `url_citation` annotations → `citations` (first appearance, unique,
  at most `maxCitationUnits`); `refusal` → `'safety'`; `status: 'incomplete'` with
  `incomplete_details.reason: 'max_output_tokens'` → `'length'`;
  `usage.output_tokens_details.reasoning_tokens` → `reasoningUnits`; `id` → `requestId`
  (`provider`), `created_at` seconds → `createdAt`.
- A parameter the provider rejects is an `UnavailableError`, never silently dropped (plan §5).
  408/429/5xx and transport failures are `UnavailableError`; any other non-2xx is
  `UnavailableError('<Provider> rejected the request')`; no text is `UnavailableError`.
- Usage is provider truth: report `input_tokens` as-is; the validator's search allowance
  (`maxInputTokens + searchUnits × maxSearchContentTokens`) is what keeps it inside the contract.
- Every adapter test asserts the exact request body with `fetcher.mock.calls`, the way
  `anthropic-provider.test.ts` does today.

## Deviations and blocking

You run unattended; nobody answers questions. When the plan and the code disagree:

- If the fix keeps every "Agreed behaviour" decision (what is sent to each provider, the caps,
  fail-closed unconfigured providers, the v3/v4 consent list, mock-only tests, no new data in the
  prompts), take the smallest deviation, keep going, and list it under "Deviations from the
  plan" in the PR.
- If it would change one of those decisions, or the worktree cannot bootstrap, or the shared
  test database refuses to migrate (`P3009`): commit what is verified, push, and emit
  `CHECKPOINT BLOCKED` with the exact conflict and the options.
- The three "Open decisions" at the end of the plan use their defaults (`gpt-5.6-luna`, accept
  v3 consents for 30 days with the removal date written as 30 days after your PR date, OpenAI
  first in the report).

Do not widen the task. Anything you notice outside it goes into a "Noticed, not done" list in
the final report.

## Git and pull request

- Start from a fresh `git fetch origin`; branch name above.
- One commit per plan phase, or smaller. Message: `<type>: <description>`, and a body that says
  why, written for someone reading `git log` in six months. Follow the attribution rules in
  effect for your session.
- Never `push --force`, never commit `.env`, never rewrite history that is already pushed.
- **D-233** goes into `docs/DECISIONS.md`, appended after the last entry, in that file's
  language, written from the plan's "Agreed behaviour" (what is non-obvious: two providers per
  scan, search only on visibility requests, provider-truth usage with the search allowance, the
  v3 transition, fail-closed unconfigured providers, the model registry v2 constants).
- Push with `-u` and open the PR with `gh pr create` against `main`. The body starts with one
  bold line: **Bumps the pre-purchase AI notice to v4 and needs `PRODUCTION_OPENAI_API_KEY` set
  before merge; without it every paid scan's GEO module reports Partial.** Then, in this order:
  **What changed**, **Notes**, **Deviations from the plan**, **How to verify** (exact commands
  and the counts you saw), **Owner steps before merge** (set the secret; run
  `node --env-file=../../.env src/orchestrator/geo-smoke.ts <brand> <hostname>` from `apps/api`
  on this branch; confirm or change `DEFAULT_OPENAI_MODEL`; update the econ fixtures).
- Leave the PR open and report its URL.

## Definition of done

The new files and tests from the plan's "Tests" section exist and pass; `packages/*` build and
typecheck; both apps typecheck against the rebuilt `dist`, including `geo-smoke.ts` under the
API build config; the full API and web suites are green; eslint and prettier are clean on your
files; the notice, FAQ, checks copy and Privacy Policy are updated in both languages; the
deploy workflow, `.env.example` and `docs/DEPLOYMENT.md` carry the OpenAI variables with no
values; D-233 is in `docs/DECISIONS.md`; and the PR is open with the bold warning line.

If you reach two hours of wall-clock time, finish the phase you are in, commit, push, open a
draft PR and emit `CHECKPOINT DONE` with what remains; the task will be relaunched.

## Final report

`CHECKPOINT DONE |` followed by: changed files by phase; every verification command with its
result; the PR URL; deviations; "Noticed, not done"; and the owner's next steps in order — set
`PRODUCTION_OPENAI_API_KEY`, run the smoke tool on the branch and pick the model, update the
econ fixtures, merge.
