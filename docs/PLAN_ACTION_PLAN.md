# Action Plan implementation plan

## Goal

On a Complete scan report the owner presses a button and Claude writes an **Action Plan**: a
short, prioritized list of changes for whoever fixes the site, with a jargon-free **Overview** on
top that can be forwarded to a client. Vocabulary: [`CONTEXT.md`](CONTEXT.md). Why the design
looks the way it does: **D-232** in [`DECISIONS.md`](DECISIONS.md).

## Before you start

- **The migration in phase 3 deploys on merge.** Merging to `main` is the production deploy, and
  the deploy takes a pre-migration snapshot first. Production took its first verified snapshot
  on 2026-09-21 (`backup-verify` green), so the gate passes; only the server backup cron is
  still unconfirmed. Whether to merge a migration-bearing PR is the owner's call. Phases 1 and 2
  need no migration and can land first.
- Line numbers below were read on 2026-09-21 and are approximate; find code by symbol.
- Packages are consumed by `apps/*` through their `dist`. Rebuild a package after changing it.
- `apps/web` has **no workspace dependencies on purpose**. Anything the API and the web must agree
  on is declared twice and pinned by a contract test that reads the web file, the same way
  `AI_PROCESSING_NOTICE_VERSION` is (`apps/web/src/ai-processing-notice.ts`).

## Agreed behaviour

- Complete scans only. Eligible when the scan's status is Completed, Partial, Failed or
  Cancelled **and** its `Job` is done, and there is at least one Open Issue outside Analytics.
  The worker writes Analytics after `resolveScanOutcome` (`orchestrator/worker.ts:168-183`), so
  the status alone is not enough.
- **Plan Window:** generation is allowed for 3 days after the scan's latest run finished, and
  only while `assertPaidWorkAllowed` passes (D-194). Written plans stay readable for as long as
  the report is (`assertPaidReportAccess`).
- The owner picks the plan's language from the target-languages list (default: the UI
  language; the site profile's target languages first). There is one plan per (scan,
  language), and plans in different languages coexist.
- **Limits:** per scan snapshot, 3 successful generations and 6 attempts in total across all
  languages, and only one generation in flight per scan. Per account, 10 starts per hour. Across
  the product, 100 generations per day; above that the API answers "AI temporarily
  unavailable". A new generation in a language replaces that language's plan; no history.
- **Re-running the scan** (module retry or platform retry) deletes the scan's plans and resets
  both per-scan counters.
- **Plan content:**
  - an Overview and at most 7 Actions, ordered by impact over effort; the model explains in
    `why` whenever a Low rule outranks a High one;
  - an Action resolves the issues of one or more rules from this scan's input, and a rule sits
    in at most one Action;
  - the model never writes issue counts.
- **Live overlay:** per-Action open/total counts, settled Actions (no open issue left on any of
  their rules) and **Reach** are computed on read from current issue statuses. Within one scan
  they only move when the owner marks issues Ignored or False Positive; the UI never calls a
  settled Action "fixed".
- **Caveats:** the server adds one line above the plan for each module that is not Completed
  ("Performance was only partly checked — the plan may be incomplete").
- **Sent to Anthropic:**
  - included: rule id, owner-facing rule title, module, highest open severity, open issue
    count, up to 3 sample URLs with query and fragment removed, the rule's distinct
    recommendations, module status/score/coverage, and the domain;
  - never sent: `evidence_excerpt`, screenshots and traces, or anything from the Analytics
    module.
- **Consent:** one line under the Generate and Regenerate buttons; the click is the consent,
  and `noticeVersion` is stored with the plan. The pre-purchase notice is unchanged.
- **Model:** `claude-opus-5`, a code constant next to `DEFAULT_ANTHROPIC_MODEL`, with no new
  deploy variable. Confirm the choice with the quality gate (phase 6).
- **Report placement:** a ready plan in the selected language takes `FixFirst`'s place. If a
  plan exists only in another language, `FixFirst` stays and a line offers to open it.
- **Print report:** it includes the plan after the scan summary. JSON/CSV export never includes
  it.

## Phase 1 — shared declarations (no DB)

1. **Owner-facing rule titles for the API.**
   - `RULE_TITLES` (en/uk) lives only in `apps/web/src/rule-titles.ts:19`, and the API can reach
     only the English engineer labels in `@fluxradar/contracts`.
   - Add a server-side copy in `packages/rules`, plus a contract test in `apps/api` that fails
     when it drifts from the web file.
2. **Plan language codes.**
   - Export `LANGUAGE_CODES` from `apps/web/src/target-languages.ts:13` and declare the same list
     in `packages/contracts` (`ACTION_PLAN_LANGUAGES`), pinned by a contract test.
   - The API validates `language` with `z.enum` on both POST and GET; anything else is a 400.
3. Rebuild the touched packages.

## Phase 2 — `packages/ai` action-plan module (no DB)

1. **`action-plan-module.ts`**, following `ux-module.ts` and `geo-module.ts`:
   - plain input type (no Prisma): domain, language, modules
     `{ module, status, score, coverage }[]`, and rules
     `{ ruleId, title, module, severity, openIssues, sampleUrls, recommendations }[]`;
   - assert that no rule belongs to the Analytics module;
   - system instructions: reader is whoever fixes the site; Overview without jargon; at most 7
     Actions; ordering rule; one rule per Action; no issue counts in text; write in `language`
     and translate the English inputs when needed;
   - `promptVersion` constant;
   - JSON schema for `output_config.format`, plus zod parsing of
     `{ overview, actions: [{ title, why, steps (1–5), effort: small|medium|large, ruleIds (≥1) }] }`;
   - post-processing:
     - drop unknown `ruleIds`;
     - keep a rule only in the first Action that names it;
     - drop Actions left without rules;
     - zero Actions left makes the attempt invalid.
2. **Per-request caps.** The 8000/2000 caps from `AI_REQUEST_CAPS` are enforced in five places.
   Add optional `caps` to `AiRequest` and read them in each:
   - `prompt-builder.ts:44-51` (`enforceInputCap`, re-run after redaction at
     `run-request.ts:114`);
   - `anthropic-provider.ts:98` (`max_tokens`), `:136-140` (text truncation), `:157-162` (usage
     clamps, which also under-report spend);
   - `response-contract.ts:92-99` (usage above the cap is rejected);
   - `mock-provider.ts:83,141` (4000-char truncation);
   - defaults stay `AI_REQUEST_CAPS`.
3. **Thinking and output budget.**
   - Opus 5 runs adaptive thinking when `thinking` is omitted, so leave `reasoningMode` unset.
     Its type only allows `'disabled'` (`types.ts:63`).
   - Give the plan `max_tokens` ≈ 16000 so thinking plus the answer fit.
   - Pass a timeout of ≈ 120 s through the existing constructor option
     (`anthropic-provider.ts:11,78`).
4. **Refusals.**
   - Send `fallbacks: "default"` with the `anthropic-beta: server-side-fallback-2026-07-01`
     header, and store the model that actually served the answer (`payload.model`).
   - A final `refusal` stop reason (mapped to `safety` today) is a failed attempt.
5. **Wiring.** Run the request through `runAiRequest` with `AiQuotaTracker.withLimit(1)`, so
   redaction and the envelope contract apply.

## Phase 3 — `apps/api` (needs the migration)

1. **Schema.** Add real relations to `Scan`; with Prisma's default Restrict, a missed delete
   breaks the retention sweep.
   - `ActionPlan`: `scanId`, `language`, `contentJson`, `promptText`, `promptVersion`,
     `modelId`, `requestId`, `usageJson`, `noticeVersion`, `generatedAt`;
     `@@unique([scanId, language])`. Only ready content lives here, so a running or failed
     regeneration never hides or loses the current plan.
   - `ActionPlanAttempt` (the spend log): `scanId`, `accountId`, `language`,
     `status` (Running/Succeeded/Failed), `failureCode`, `usageJson`, `createdAt`,
     `finishedAt`, `@@index([createdAt])` for the daily cap.
   - `Scan`: `actionPlanAttempts`, `actionPlanSuccesses`, `actionPlanRunStartedAt`,
     `actionPlanRunLanguage`.
2. **Claim atomically** with one conditional `updateMany`, the same pattern as
   `moduleRetryCount`:
   - condition: no run in flight, or its `actionPlanRunStartedAt` is older than 5 minutes;
     attempts < 6; successes < 3;
   - on a match: set the run fields and increment the attempts;
   - no row updated: re-read the scan and answer `409 ACTION_PLAN_IN_PROGRESS` or
     `429 ACTION_PLAN_LIMIT`.
   - On success, in one transaction: upsert the `ActionPlan`, increment the successes, clear the
     run fields, and mark the attempt Succeeded.
   - On failure: clear the run fields and store a failure **code**, never provider text.
3. **Routes** in a new `action-plan/routes.ts`, mounted like the issues and export routers.
   Reuse `requireAuth`, `accountIdFrom`, `requiredParam`, `findOwnReportScan`, `parseInput`,
   `forbidden`/`conflict`, `ApiError` and `sendOk`.
   - `POST /scans/:scanId/action-plan { language }`, checks in this order:
     1. `findOwnReportScan` (includes `assertPaidReportAccess`);
     2. `assertPaidWorkAllowed`;
     3. plan Complete (`403 ACTION_PLAN_COMPLETE_ONLY`);
     4. status and Job done (`409 ACTION_PLAN_NOT_READY`);
     5. Plan Window (`409 ACTION_PLAN_WINDOW_CLOSED`);
     6. an open issue outside Analytics (`409 ACTION_PLAN_NOTHING_TO_PLAN`);
     7. `readAnthropicConfig().state === 'configured'` (otherwise 503);
     8. `accountAndIpRules`, 10 per hour;
     9. the daily cap, counted from `ActionPlanAttempt` (`503 ACTION_PLAN_BUSY`);
     10. the claim.

     Then answer `202`, and run the generation detached behind a top-level `catch`, so a
     rejection can never crash the process.
   - `GET /scans/:scanId/action-plan?language=`, with `findOwnReportScan` and **no** rate limiter
     (the web polls it). It returns:
     - the languages with a plan;
     - the run in flight;
     - the last failure code;
     - the remaining successes and attempts;
     - `windowEndsAt`;
     - the plan with its live overlay (per-Action open/total and settled, Reach), the caveats,
       the generation time and the model.
4. **Input builder.**
   - Rules: `summarizeIssues` groups by rule, module and severity together (`summary.ts:26-32,
     63-66`). Merge by rule id and keep the highest open severity, because UX severity comes
     from the model per issue.
   - Sample URLs: add a query for up to 3 targets per rule (for example `ROW_NUMBER()` in
     `$queryRaw`), with query and fragment removed.
   - Recommendations are stored per issue as a message code plus values
     (`issues/localized-text.ts:34`), in en/uk only. A rule can have several variants
     (`seo-tech-004` has 3), and UX findings carry English free text, so send each rule's
     distinct rendered texts.
   - Module status, score and coverage come from the scan's modules.
   - Exclude the Analytics module.
5. **Provider.**
   - Add `createActionPlanProvider` to `CreateAppOptions` (`index.ts:56-87`), because
     `createDefaultAiProvider` returns the GEO fixtures under Vitest (`geo.ts:407-430`).
   - Add `ACTION_PLAN_ANTHROPIC_MODEL = 'claude-opus-5'` next to `DEFAULT_ANTHROPIC_MODEL`
     (`integrations/anthropic-config.ts:11`), with a test that it is not in
     `RETIRED_ANTHROPIC_MODELS`.
6. **Re-run.** In `run-attempt.ts:384-396`, where the snapshot is replaced for both module and
   full retries, delete the scan's `ActionPlan` rows and reset the four `Scan` fields.
7. **Deletion.** `data-retention.ts`: `deleteScanResult` (before `tx.scan.delete`, ~line 84) and
   `deleteScanRows` (before ~line 387). Account deletion (~457) and profile deletion
   (`profile-deletion.ts:117`) go through `deleteScanRows`. Add both tables to the `TRUNCATE`
   list in `test-utils/test-db.ts:26`.
8. **Dry-run tool.** `apps/api/src/action-plan/print-prompt.ts`, run from `apps/api` as
   `node --env-file-if-exists=../../.env src/action-plan/print-prompt.ts <scanId> <language>`,
   builds the input for a stored scan and prints the exact system instructions and prompt text
   without calling the provider. It is how the owner checks what leaves for Anthropic and how
   phase 6 starts.

## Phase 4 — `apps/web`

1. **New `ActionPlan.tsx`** (`Report.tsx` is already 618 lines). States:
   - **locked** (Basic, only when it has open issues): no AI call; "AI Action Plan — in a
     Complete scan of this site", using the existing `onUpgrade` (it buys a new scan);
   - **nothing to plan**;
   - **window closed**;
   - **idle**: language picker, button, consent line;
   - **running**: poll GET every 3 s while a run is in flight; survives a reload;
   - **ready**:
     - Overview, then Actions with live counts and "→ N issues" links through
       `onOpenProblem(ruleId)`;
     - settled Actions collapsed;
     - the Reach line and the caveats;
     - the "AI-generated" label;
     - the language switcher;
     - "Regenerate (N left)" with the consent line;
   - **failed**: retry, while attempts remain.
2. **`ReportNextSteps`:** a ready plan in the selected language replaces `FixFirst`.
3. **Shape-check every response.** Report test mocks answer any `/scans/` path with a dashboard
   (`Report.checks.test.tsx:206`), so on a mismatch render nothing, not the idle button.
4. **`PrintReport`:**
   - the `/scans/:id/report` route gains a plan-language query (`App.tsx:223-239, 909-914`);
   - the new fetch in its `Promise.all` (`PrintReport.tsx:56-62`) gets `.catch(() => null)`;
   - add a section after the scan summary with the AI label.
5. **Upsell and pricing:** one `FreeUpsell` bullet now; the pricing-page row only after release.
6. **Copy:** en/uk in the `findings-copy` style.

## Phase 5 — legal copy

- **Privacy Policy** (uk and en, the paid-AI paragraph near `PrivacyPolicy.tsx:148`): name the
  Action Plan as an AI purpose and say what it sends.
- **FAQ:** add the same purpose to the AI-provider answers (`faq-copy.ts:202, 344` and the uk
  counterparts at `:526, 668`).
- No change to the pre-purchase notice or its version.

## Phase 6 — quality gate, then the model choice

- **What to scan:** local Complete scans (never production) of 8 random Ukrainian nail-salon and
  dental-clinic sites, plus 1–2 own sites and 2–3 synthetic edge cases (one rule only, a Partial
  scan, many High rules).
- **Scan settings:** about 100 URLs per site; robots.txt respected (the default). Active
  Security stays off for third-party domains; it is gated by domain proof and must stay that way.
- **Plans:** generate each in uk and en. Results stay in a local scratch folder and are never
  committed.
- **Pass criteria:**
  - fewer than 20% of AI Actions dropped for unknown `ruleIds`;
  - no step contradicts its rule's recommendation;
  - the owner would follow the order in at least 4 of 5 reports;
  - the Overview is readable by a non-technical person.
- **Model choice:** run Opus 5 and Sonnet 5 on the same inputs, then decide.

## Tests

- **ai:**
  - no evidence and no Analytics data in the prompt;
  - unknown `ruleIds` dropped;
  - a rule named twice is kept once;
  - empty result is invalid;
  - caps honoured in all five places.
- **api** (with a mock provider):
  - Basic 403; not ready 409; refunded 403; expired entitlement 403;
  - window closed 409; nothing to plan 409;
  - invalid language 400;
  - concurrent POSTs (same or different language) produce one provider call;
  - stale run recovery;
  - the limits of 3 successes and 6 attempts;
  - daily cap;
  - re-run deletes plans and resets counters;
  - live overlay after Ignored / False Positive;
  - retention and deletion remove both tables.
- **web:**
  - every state renders;
  - Basic locked;
  - `FixFirst` replaced only by a ready plan in the selected language;
  - a mocked dashboard response renders nothing;
  - print includes the plan.
- **contracts:** rule titles and language codes match the web declarations.

## Out of scope for v1

- A guarantee that Critical rules make the plan: the ruleset has no Critical rule yet.
- Analytics (Google) data in the prompt.
- A separate executive view, plan history, share links, and the plan in JSON/CSV.

## Follow-up

- FluxRadar-Feature-Plan.md §5 describes a cost guard that reserves spend before every AI
  request. The code only counts requests in memory (`packages/ai/src/quota.ts`). This is
  tracked separately from this feature.
