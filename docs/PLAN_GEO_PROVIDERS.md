# GEO providers implementation plan

> Status: shipped in PR #30 on 2026-09-22 (D-233). The PR lists the deviations from this plan;
> the econ fixtures turned out to have no AI cost line, so that follow-up was dropped.

## Goal

The AI SEO / GEO module asks its visibility questions of **two** AI providers instead of one, and
both answer with **provider web search** turned on: the report shows what a search-enabled
ChatGPT-class model (OpenAI) and a search-enabled Claude-class model (Anthropic) say about the
site, with the sources each one used. Today only Anthropic answers, without search, so every
answer is training-data recall, the `citations` list is always empty and the site-link rule
(GEO-VIS-004) can practically never pass.

This is not a new product decision: FluxRadar-Feature-Plan.md §5 already makes OpenAI part of the
mandatory scope and D-008 only deferred the adapter for lack of credentials and an AI-001 sign-off.
The FAQ and the Privacy Policy already tell customers that "OpenAI may be added only after the
notice is updated". Vocabulary: [`CONTEXT.md`](CONTEXT.md). Record the decisions below as **D-233**
in [`DECISIONS.md`](DECISIONS.md) when the first PR opens.

## Before you start

- **No database migration.** `AiResponseRecord` already stores `provider`/`modelId` per answer,
  `AiConsent.providersJson` already stores a provider list, and the module ledger is JSON in
  `ScanModule.metadataJson`. Merging to `main` still deploys to production.
- **Deploy order matters.** The code fails closed: without `OPENAI_API_KEY` every OpenAI request
  is `ProviderUnavailable` and every paid scan's GEO module reports Partial. The owner sets
  `PRODUCTION_OPENAI_API_KEY` (phase 5) **before** merging the PR that ships the notice bump.
- Line numbers below were read on 2026-09-22 and are approximate; find code by symbol.
- Packages are consumed by `apps/*` through their `dist`. Rebuild a package after changing it.
- `apps/web` has **no workspace dependencies on purpose**. Anything the API and the web must agree
  on is declared twice and pinned by an API-side contract test that reads the web file
  (`apps/api/src/billing/checkout-metadata.test.ts` reads `apps/web/src/ai-processing-notice.ts`).
- `.env` holds a live Anthropic key. Every provider factory must refuse to build a real adapter
  under Vitest (`NODE_ENV === 'test' || VITEST === 'true'`), exactly as `createDefaultAiProvider`
  does today. The same rule applies to the OpenAI adapter. Tests never call a provider.
- The Anthropic adapter is raw `fetch` (`packages/ai/src/anthropic-provider.ts`). The OpenAI
  adapter is raw `fetch` too. No provider SDK enters the repo.
- **Longer GEO runs are safe for the job lease.** The worker refreshes the 5-minute lease every
  ~100 s while an attempt runs (`orchestrator/worker.ts:117-128`, `claim.ts:17`), so 13
  sequential search-enabled requests do not let another worker re-claim the job.
- **The Action Plan feature** (`docs/PLAN_ACTION_PLAN.md`, not merged yet) edits the same files:
  `anthropic-provider.ts`, `response-contract.ts`, `faq-copy.ts`, `PrivacyPolicy.tsx`. Whichever
  lands second rebases; neither changes the other's behaviour.
- The owner's main checkout carries **uncommitted edits** to `docs/DECISIONS.md` and
  `FluxRadar-Feature-Plan.md`. D-233 is appended at the end of DECISIONS.md; the owner resolves
  the merge if their edits touch the same lines.

### Provider facts this plan relies on (verified 2026-09-22)

| | OpenAI Responses API | Anthropic Messages API |
| --- | --- | --- |
| Endpoint | `POST https://api.openai.com/v1/responses` | `POST https://api.anthropic.com/v1/messages` |
| Web search tool | `tools: [{ type: "web_search" }]` (`web_search_preview` is legacy) | `tools: [{ type: "web_search_20250305", name: "web_search", max_uses }]` |
| Search cap | `max_tool_calls` on the request (adapter sends it; a rejection is `Unavailable`, never silently dropped — plan §5) | `max_uses` on the tool; over the cap the result block carries `error_code: "max_uses_exceeded"` inside a 200 |
| Citations | `url_citation` annotations on `output_text` content: `url`, `title`, `start_index`, `end_index` (a full source list exists via `include: ["web_search_call.action.sources"]`; not used in v1) | `citations[]` on text blocks, `type: "web_search_result_location"`: `url`, `title`, `cited_text`, `encrypted_index` |
| Search count | number of `web_search_call` output items | `usage.server_tool_use.web_search_requests` |
| Price | $10 per 1,000 calls plus search content tokens at the model rate | $10 per 1,000 searches plus search content as input tokens |
| Storage | `store: false` on every request (default is 30-day response storage); API data is not used for training by default; abuse-monitoring copy kept up to 30 days; **web search is not ZDR-eligible** | Basic web search is ZDR-eligible; dynamic filtering (`web_search_20260209+`) is not; retained data is never used for training without permission |
| Other | `instructions` = system text, `input` = prompt, `max_output_tokens`, `reasoning: { effort }`, `text.format` for JSON schema; response `status: completed | incomplete`, `incomplete_details.reason: max_output_tokens`, `usage.output_tokens_details.reasoning_tokens` | `stop_reason: pause_turn` can end a long search turn; tool errors arrive as an error object in `content` of `web_search_tool_result`, never as a thrown 4xx |

Model IDs listed by OpenAI on 2026-09-22: `gpt-6-astra` ($10/$50 per MTok), `gpt-5.6-sol`
($4/$20), `gpt-5.6-terra` ($2/$12), `gpt-5.6-luna` ($0.20/$1.20); the pricing page still serves
the `gpt-5.x`/`gpt-5-mini` family. Registry v1 in the feature plan named `gpt-5-mini`; that entry
predates this lineup. Phase 6 confirms the choice against the live API before merge.

## Agreed behaviour

- **Visibility providers** are a registry constant, `GEO_VISIBILITY_PROVIDERS = ['anthropic',
  'openai']`, in `apps/api/src/orchestrator/geo.ts`. Execution order is the constant's order; the
  report shows OpenAI first (it is what customers ask about).
- **Discovery-question generation stays one Anthropic request without search** (its neutrality
  contract, D-176, is untouched). The **UX/Conversion review stays Anthropic without search**
  (D-217). The Action Plan (D-232) is unaffected.
- **Per provider:** the 2 awareness questions plus the 2–4 generated discovery questions, so 4–6
  visibility requests per provider and 9–13 AI requests per scan including generation. Sequence
  numbers restart at 1 for each provider; `ai_request_key` already contains the provider (D-015)
  and GEO findings already carry it in `normalized_resource`, so quota, idempotency and
  fingerprints stay distinct without any change to `packages/ai/src/geo-rules.ts`.
- **Web search only on visibility requests**, marked by a new optional `AiRequest.webSearch`
  flag, bounded by `AI_REQUEST_CAPS.maxSearchUnits` (8): `max_uses` at Anthropic, `max_tool_calls`
  at OpenAI. Generation and UX requests never carry the flag and never get tools.
- **Citations** = the URLs the model actually cited inline (OpenAI `url_citation`, Anthropic
  `web_search_result_location`), in order of first appearance, de-duplicated, at most
  `AI_REQUEST_CAPS.maxCitationUnits` (32). The wider source list OpenAI can return through
  `include` is not requested in v1: it is not a citation and has no field in the contract.
  GEO-VIS-004 already reads `citations`; nothing changes in the rules.
- **Usage is provider truth.** Adapters report the provider's `input_tokens` as-is and drop the
  input clamp the Anthropic adapter has today (`Math.min(inputTokens, cap)` hides spend). Search
  content arrives as input tokens, so the normalized-response validator allows
  `inputTokens <= maxInputTokens + searchUnits × maxSearchContentTokens` with a new cap constant
  `maxSearchContentTokens = 16000` per search unit (raised from 8000 after the first real scan
  measured 10–13k input tokens per Anthropic search). The output cap (2000) is unchanged: it is the
  `max_tokens` / `max_output_tokens` sent, and the visibility requests keep the whole budget for
  the answer by sending `thinking: { type: "disabled" }` to Anthropic (Sonnet 5 accepts it; the
  generation request already does this) and `reasoning: { effort: "low" }` to OpenAI. The search
  count lands in `usage.searchUnits` (already an optional field of `NormalizedAiUsage`) and flows
  to the export `search_units` column through `apps/api/src/export/build-records.ts:179`.
- **Prompt version** becomes `geo-questions-v5-awareness` / `-discovery`. The system instructions
  add: use web search before answering, cite the pages you rely on, answer in at most 200 words,
  do not narrate the searches, say what you could not verify. The `-awareness`/`-discovery`
  suffixes stay: `questionParameter` in `geo-rules.ts` and `persistGeoModule` key off them.
- **What is sent to OpenAI** is exactly what is sent to Anthropic today for the same question:
  the system instructions and the question (brand and domain in awareness questions, neutral
  text in discovery questions). `brandFacts` and `pageTitles` stay empty. No profile free text,
  no page evidence, no account or payment data, no Google/Bing tokens.
- **Unconfigured or failing provider:** every request of that provider is a `ProviderUnavailable`
  outcome, the module is Partial with the reason string `runGeoModule` already builds, and the
  score does not move (GEO-METHOD-005). No provider is skipped silently, which is the behaviour
  `UnconfiguredAnthropicProvider` implements for Anthropic today.
- **Consent.** The pre-purchase notice becomes `core-ai-processing-notice-v4`, names Anthropic and
  OpenAI, says both use web search, and the web submits `providers: ['anthropic', 'openai']`.
  **Transition:** a scan bought under v3 may be retried for 30 days (its entitlement). The worker
  accepts `ACCEPTED_AI_PROCESSING_NOTICE_VERSIONS = ['…-v3', '…-v4']` instead of one version:
  a v3 record lists only `anthropic`, so on such a retry the Anthropic requests run and the OpenAI
  requests are `ConsentMissing` (module Partial, reason shown). Web search does not change what a
  v3 customer agreed to send. Remove v3 from the list 30 days after the release date.
- **Report.** Observations are grouped by provider with a display name ("ChatGPT · OpenAI · model",
  "Claude · Anthropic · model") and per-provider mention counts (brand mentioned in n of m answers,
  domain referenced in n of m). Unavailable observations carry their provider, which requires
  `provider` on every `providerVisibility.requests[]` entry. The `method` and `interpretation`
  strings in the ledger say that answers were produced with provider web search and that citations
  are the sources the model used. JSON/CSV export shapes are unchanged; there are simply more
  `ai_response` rows per scan, now with `search_units`.
- **Model registry v2** (code constants, not user settings): `DEFAULT_OPENAI_MODEL` is
  `gpt-5.6-luna` (owner's choice, 2026-09-22): the cheapest current OpenAI model that supports
  the `web_search` tool. A GEO request's cost is dominated by the $10-per-1,000 search calls, not
  by tokens, so the dearer `gpt-5.6-terra` (Sonnet 5's price class) or `gpt-6-astra` (closest to
  what ChatGPT serves) would buy little; phase 6 may still move to one of them. The
  `OPENAI_MODEL` env variable overrides it; `RETIRED_OPENAI_MODELS` seeds with
  `gpt-4o-search-preview` and `gpt-4o-mini-search-preview`; with a key present, a retired model
  fails the production boot by name, mirroring `anthropic-config.ts`.
- **Data protection (AI-001 row for OpenAI):** `store: false` on every request; API inputs are not
  used for training by default; an abuse-monitoring copy may be kept up to 30 days; no zero
  retention is claimed (web search is not ZDR-eligible at OpenAI, and the Policy already says "we
  do not promise zero provider retention" for Anthropic). The Privacy Policy names OpenAI as an
  active recipient and links its data-controls page.

### Cost per scan (estimates; phase 6 measures the real numbers)

| Case | Requests | AI cost |
| --- | --- | --- |
| Today (Anthropic, no search) | 5–7 | ≈ $0.03 |
| Typical after this change (2 providers, ~3 searches each, `gpt-5.6-luna`) | 9–13 | ≈ $0.55 |
| Worst case (8 searches per request, 8k search tokens each, both providers) | 13 | ≈ $3 |

The p95 provider-invoice ceilings ($24.25 Basic / $53.50 Complete, D-187) are not threatened.
Update the AI cost line of the econ fixtures (`packages/export/fixtures/econ/*.json`) and run
`econ-validate` so the recorded p95 stays honest.

## Phase 1 — `packages/contracts` and `packages/ai` (no DB)

1. **Caps.** `packages/contracts/src/limits.ts`: add `maxSearchContentTokens: 16000` to
   `AI_REQUEST_CAPS`; `maxSearchUnits` and `maxCitationUnits` already exist.
2. **Request flag.** `packages/ai/src/types.ts`: `readonly webSearch?: true` on `AiRequest`, with a
   doc comment that only visibility requests set it.
3. **Validator.** `packages/ai/src/response-contract.ts`: the input-cap check becomes
   `inputTokens <= maxInputTokens + (searchUnits ?? 0) × maxSearchContentTokens`; reject
   `searchUnits > maxSearchUnits` and `citations.length > maxCitationUnits`.
4. **Anthropic web search.** `packages/ai/src/anthropic-provider.ts`:
   - when `request.webSearch` is set, add `tools: [{ type: 'web_search_20250305', name:
     'web_search', max_uses: AI_REQUEST_CAPS.maxSearchUnits }]` (the basic variant: direct calls,
     ZDR-eligible, no code-execution blocks in the response; do not use `web_search_20260209`);
   - `rawText` stays the join of all `text` blocks; `citations` = `web_search_result_location`
     URLs from those blocks, de-duplicated, capped at 32; `usage.searchUnits` from
     `usage.server_tool_use.web_search_requests` when present;
   - a `web_search_tool_result` whose `content` is an error object (`max_uses_exceeded`,
     `too_many_requests`, …) is not fatal: keep the text; only "no text at all" is
     `UnavailableError`, as today;
   - `stop_reason: 'pause_turn'` keeps the text received and maps to `finishReason: 'length'`
     (a continuation loop is out of scope; log it);
   - drop the input clamp; keep the output clamp and truncation; timeout 60 s when `webSearch` is
     set, 45 s otherwise (constructor option stays for tests).
5. **OpenAI adapter.** New `packages/ai/src/openai-provider.ts`, same shape as the Anthropic
   file (`OpenAiProviderOptions { apiKey, modelId?, apiVersion?, timeoutMs?, fetcher?, now? }`,
   `config.provider = 'openai'`, `config.apiVersion = 'v1'`, refuses a request whose `provider`
   is not `openai` the way the mock does):
   - body: `model`, `instructions: request.systemInstructions`, `input: promptText`,
     `max_output_tokens: AI_REQUEST_CAPS.maxOutputTokens`, `store: false`,
     `reasoning: { effort: 'low' }` when `reasoningMode === 'disabled'` or `webSearch` is set,
     and when `webSearch` is set: `tools: [{ type: 'web_search' }]` and
     `max_tool_calls: AI_REQUEST_CAPS.maxSearchUnits` (no `search_context_size`, no `include`,
     no `tool_choice`: the fewer parameters, the fewer ways for a model to reject the request;
     phase 6 may add `search_context_size: 'low'` if search tokens run high); when
     `responseSchema` is set:
     `text: { format: { type: 'json_schema', name: 'fluxradar_response', schema, strict: true } }`
     (not used by this feature, but the adapter honours the contract);
   - headers: `authorization: Bearer <key>`, `content-type: application/json`;
   - parse: `output[]` items — `web_search_call` items counted into `searchUnits`, `message`
     items' `output_text` parts joined into `rawText` with their `url_citation` annotations
     collected into `citations`; a `refusal` part → `finishReason: 'safety'`; `status: 'incomplete'` with
     `incomplete_details.reason: 'max_output_tokens'` → `'length'`; `usage.input_tokens`,
     `usage.output_tokens`, `usage.output_tokens_details.reasoning_tokens` → `reasoningUnits`;
     `id` (`resp_…`) → `requestId` with source `provider`, `created_at` (unix seconds) →
     `createdAt`; `model` → `modelId`;
   - errors: transport/timeout, 408/429/5xx → `UnavailableError('OpenAI HTTP <status>')`; any other
     non-2xx → `UnavailableError('OpenAI rejected the request')`; no text → `UnavailableError`.
6. **Routing provider.** New `packages/ai/src/routing-provider.ts`: `RoutingAiProvider implements
   AiProvider`, built from a non-empty list of providers with distinct `config.provider`; `send`
   dispatches on `request.provider`; an unknown provider is an `AiModuleError` (a wiring bug, not
   an `Unavailable` branch); `config` is the first entry's config; `providers` lists the names.
   `runAiRequest`, `runGeoModule` and the UX module keep taking one `AiProvider`.
7. **Mock.** `packages/ai/src/mock-provider.ts`: ignore `webSearch`; fixtures gain an optional
   `web_search_calls?: number` that becomes `usage.searchUnits`. Add
   `mockRoutingProvider(fixtures, providers)` to the same file (it must be reachable from
   `@fluxradar/ai`; `testing/harness.ts` is not exported by the package): a `RoutingAiProvider`
   over one `MockAiProvider` per name you pass, all sharing the fixtures, each with the model id
   of its provider's registry default.
8. `packages/ai/src/index.ts` exports the new modules. Rebuild the packages.

## Phase 2 — `apps/api`

1. **Config.** New `apps/api/src/integrations/openai-config.ts` mirroring `anthropic-config.ts`:
   `DEFAULT_OPENAI_MODEL`, `RETIRED_OPENAI_MODELS`, `OPENAI_ENV_VARS { apiKey: 'OPENAI_API_KEY',
   model: 'OPENAI_MODEL' }`, `readOpenAiConfig` returning configured / not_configured / invalid.
   `integrations/config.ts`: `openAiApiKey`, `openAiModel` on `IntegrationConfig`; add the reader
   to `partialIntegrationFailures`. `integrations/diagnostics.ts`: `status('openai', …)` after the
   Anthropic line.
2. **Factory.** `orchestrator/geo.ts`: `createDefaultAiProvider(brand, host)` keeps its signature
   and returns a `RoutingAiProvider`: under Vitest, `mockRoutingProvider(defaultGeoFixtures(…),
   GEO_VISIBILITY_PROVIDERS)`; in production, `AnthropicProvider` / `OpenAiProvider` when the key exists, else an
   `UnconfiguredProvider(name, model)` (generalise `UnconfiguredAnthropicProvider`; message
   `"<name> API key is not configured"`).
3. **Requests.** `orchestrator/geo.ts`: `GEO_VISIBILITY_PROVIDERS`, `GEO_PROMPT_VERSION =
   'geo-questions-v5'`, the v5 system instructions; `buildGeoRequests(scanId, brand, host,
   discoveryQuestions, providers = GEO_VISIBILITY_PROVIDERS)` returns the question list once per
   provider with `webSearch: true`, `reasoningMode: 'disabled'` and sequence restarting at 1.
   Existing callers that pass a single Anthropic mock must pass `['anthropic']` explicitly.
   `generateGeoDiscoveryQuestions` is unchanged.
4. **Consent.** `packages/ai/src/consent.ts`: `ACCEPTED_AI_PROCESSING_NOTICE_VERSIONS` next to
   `CURRENT_AI_PROCESSING_NOTICE_VERSION` (`'core-ai-processing-notice-v4'`), with a comment naming
   the removal date for v3. `run-attempt.ts` `loadConsent` and `ux-module.ts` (~line 263) check
   membership in the list instead of equality with the current version.
5. **Ledger.** `run-attempt.ts` `persistGeoModule`: `providers: GEO_VISIBILITY_PROVIDERS` and
   `webSearch: true` under `providerVisibility`; `provider: outcome.request.provider` on every
   `requests[]` entry; new `method` / `interpretation` strings. `persistAiResponse` is unchanged
   (`usageJson` already carries `searchUnits`).
6. **Report endpoint.** `scans/routes.ts` `geoObservationsFrom`: read `provider` from the request
   entry so `unavailableGeoObservation` can carry it (`provider` is no longer always null there);
   answered observations keep the provider from the `AiResponseRecord`.
7. **Export.** Nothing to change; confirm with the e2e export assertion that `ai_response` records
   now include an `openai` row with `search_units` set when the fixture declares
   `web_search_calls`.

## Phase 3 — `apps/web`

1. **Notice constants.** `apps/web/src/ai-processing-notice.ts`: version `v4` and a new
   `AI_PROCESSING_PROVIDERS = ['anthropic', 'openai'] as const`; `new-scan-form.ts:337` submits it
   instead of the literal. Extend `apps/api/src/billing/checkout-metadata.test.ts` to also read
   this list and compare it with `GEO_VISIBILITY_PROVIDERS`.
2. **Notice copy** (en/uk, `i18n.ts` keys `labelAiConsent`, `aiConsentTitle`, `aiConsentBody`,
   ~565–569 and ~1684–1688): name Anthropic and OpenAI, say that both use web search for the
   visibility questions, keep the three sentences on what is sent, on AI being wrong or
   unavailable, and on never sending account/payment data or Google/Bing tokens.
3. **Report grouping.** `ModuleChecks.tsx` `GeoChecksBody`: group `observations` by `provider`
   (OpenAI first, then Anthropic, then unknown names as they come), a heading per group with the
   display name and the model, and the two mention counts; `GeoObservationCard` keeps the
   model line and the citations list. New copy keys (en/uk) for the display names, the group
   heading and the counts; keep `geoObservationsLead` and the snapshot disclaimer.
   `workspace-i18n.test.tsx` pins en/uk key parity, so every new key lands in both languages.
4. **Descriptions and FAQ.** `checks-copy.ts` (~194 and ~531): the visibility answers come from
   ChatGPT (OpenAI) and Claude (Anthropic) with web search. `faq-copy.ts` (~199–202, ~344 and the
   uk counterparts ~523–526, ~668): replace "the current production adapter uses Anthropic, not
   ChatGPT or Perplexity" with the new truth; Perplexity and Gemini are still not queried.
5. **Shape-check** any new field read from the dashboard (`provider` on unavailable observations
   may still be null for reports written before this release).

## Phase 4 — legal copy

- **Privacy Policy** (`legal/PrivacyPolicy.tsx`, uk ~148–195 and en ~400–447): the paid-AI
  paragraph names both providers and web search; the OpenAI recipient bullet becomes active with
  a link to OpenAI's API data controls (`https://developers.openai.com/api/docs/guides/your-data`)
  and the statement that inputs are not used for training, may be retained up to 30 days for abuse
  monitoring, and that no zero retention is promised; bump the Policy's effective date if the page
  states one. `TermsOfService.tsx` does not name a provider; leave it.
- No other legal page changes.

## Phase 5 — deploy and docs (owner-gated; CLAUDE.md forbids touching these without the task)

- `.env.example`: `OPENAI_API_KEY=` and `OPENAI_MODEL=<DEFAULT_OPENAI_MODEL>` next to the Anthropic
  block (~131–133), with the same "retired model fails the boot" comment.
- `.github/workflows/deploy.yml`: `PRODUCTION_OPENAI_API_KEY: ${{ secrets.… }}` and
  `PRODUCTION_OPENAI_MODEL: ${{ vars.… }}` beside the Anthropic entries (~114–118), and
  `upsert_env OPENAI_API_KEY PRODUCTION_OPENAI_API_KEY` /
  `upsert_env OPENAI_MODEL PRODUCTION_OPENAI_MODEL` beside ~220–221.
  `apps/api/src/deploy/deploy-002-env-file-parity.test.ts:375` pins the Anthropic lines; add the
  parallel assertion.
- `docs/DEPLOYMENT.md` secrets table (~276) and the model-variable paragraph; `docs/INTEGRATIONS.md`
  row for OpenAI (~14); `docs/DECISIONS.md` **D-233** from "Agreed behaviour".
- The owner runs, before merging: `gh secret set PRODUCTION_OPENAI_API_KEY --env production`.
  FluxRadar-Feature-Plan.md §5 (registry v1 text) is the owner's to update; the working tree
  already carries uncommitted edits to it.

## Phase 6 — live smoke and cost check (owner runs; never in tests or CI)

- New `apps/api/src/orchestrator/geo-smoke.ts`, run from `apps/api` as
  `node --env-file=../../.env src/orchestrator/geo-smoke.ts <brand> <hostname>`; it refuses to run
  under Vitest, builds the production providers from the real keys, sends one awareness question
  to each configured provider through `runAiRequest` with a throw-away consent record, and prints
  per provider: model served, search count, citations, usage, finish reason, elapsed time and the
  cost from the price card above. It never writes to the database.
- **Pass criteria** on a site the models can find (use fluxradar's own domain and one customer
  domain the owner picks): both providers answer; at least one citation each; no
  `ProviderContract` violation; `finishReason: 'stop'`; under 60 s per request; no parameter
  rejected (`max_tool_calls`, `store`, `reasoning.effort`, the `web_search` tool).
- **Then confirm the OpenAI model** (`luna` default; `terra` if its answers are visibly weaker;
  `astra` if fidelity to ChatGPT matters more than cost) and, if needed, the Anthropic thinking setting
  (switch to adaptive thinking with `output_config.effort: 'low'` only if disabled thinking
  produces tool calls written into the text).
- Update the econ fixtures with the measured p95 AI cost and run `econ-validate`.

## Tests

- **ai:**
  - `openai-provider.test.ts`: body carries `store: false`, `max_output_tokens: 2000`,
    `max_tool_calls: 8` and the `web_search` tool only when `webSearch` is set, and no `tools`
    or `max_tool_calls` otherwise; citations and search count parsed from a fixture with two
    `web_search_call` items and three `url_citation` annotations (one duplicate); `incomplete` →
    `length`; `refusal` → `safety`; 429/5xx and transport errors → `UnavailableError`; 400 →
    `UnavailableError`; empty output → `UnavailableError`; a non-`openai` request →
    `AiModuleError`; the normalized response passes `validateNormalizedResponse`;
  - `anthropic-provider.test.ts`: tool present only with `webSearch`; citations from
    `web_search_result_location`; `searchUnits` from `server_tool_use`; an error result block does
    not fail the response; `pause_turn` → `length`; input tokens above 8000 are reported, not
    clamped, when a search ran;
  - `routing-provider.test.ts`: dispatch by provider; unknown provider is a bug;
  - `response-contract.test.ts`: the search allowance and the two new unit caps;
  - `mock-provider.test.ts`: `web_search_calls` → `searchUnits`.
- **api** (mock providers only):
  - `geo-provider.test.ts`: the factory returns a routing provider covering both names under
    Vitest; `buildGeoRequests` emits both providers with restarted sequences and `webSearch` only
    on visibility requests; the generation request is unchanged;
  - orchestrator: a scan consented for both providers ends Completed with `1 + 2 × N` responses
    and `ai_response` rows for both providers; a v3 consent gives Anthropic answers plus OpenAI
    `ConsentMissing` and a Partial module; an unconfigured OpenAI key gives Partial with
    `ProviderUnavailable`; the dashboard's `geoObservations` carry the provider on unavailable
    rows; retention/deletion still removes every `ai_response` row;
  - `checkout-metadata.test.ts`: version and provider list pinned to the web declaration;
  - `deploy-002-env-file-parity.test.ts`: the OpenAI workflow lines;
  - the four tests that inject `createAiProvider` (`api.integration.test.ts`, `api.e2e.test.ts`,
    `scans/free-scan-scope.test.ts`, `billing/billing-008-suspended-report-access.test.ts`) switch
    to `mockRoutingProvider`, and every consent payload in the API tests moves to v4 with both
    providers (`api.integration`, `api.e2e`, `profiles/profile-deletion`,
    `billing/fastspring/fastspring-003-webhook`, `fastspring-004-checkout-http`).
- **web:**
  - `Checkout.test.tsx` and `free-scan-controls.test.tsx`: v4 and both providers in the payload;
  - `Report.checks.test.tsx` / `Report.scope.test.tsx`: two provider groups, OpenAI first, the
    counts, an unavailable OpenAI observation under its own heading, a pre-release observation
    with a null provider still renders;
  - `Faq.test.tsx`: the mount request list is unchanged (nothing new fetches at the `App` root);
    any assertion on the old "uses Anthropic, not ChatGPT" sentence follows the copy;
  - `workspace-i18n.test.tsx`: en/uk parity for the new keys.
- **Unchanged on purpose:** `packages/ai/src/geo-rules.test.ts` uses the literal
  `geo-questions-v4-discovery` as fixture data; the rules only look at the suffix.

## Out of scope for v1

- Perplexity and Google (Gemini) adapters — the same `RoutingAiProvider` slot, separate tasks.
- New GEO rules (cited pages GEO-VIS-005, competitor mentions GEO-VIS-006): the ruleset carries
  only the five GEO rules (D-007); adding one is a ruleset version bump.
- Running the two providers in parallel: `AiQuotaTracker` is an immutable chain, so two chains
  need a merge step. Sequential execution adds roughly one to two minutes of search time per scan.
- A `pause_turn` continuation loop at Anthropic.
- Localised search (`user_location` from the profile's region) — the discovery questions already
  carry the region in their text.
- Per-provider toggles in the new-scan form.
- The §5 cost guard (still counted in memory only; tracked under D-232's follow-up).

## Open decisions (defaults chosen; say so if you want another)

1. `DEFAULT_OPENAI_MODEL`: `gpt-5.6-luna` (chosen 2026-09-22), `gpt-5.6-terra`, or `gpt-6-astra`.
2. v3 consents: accept for 30 days (default) or strict single-version check (retries of v3 scans
   then lose the whole GEO module).
3. Report order: OpenAI first (default) or registry order.
