# FluxRadar

Pay-per-scan website audit platform; audit ruleset v0.1. This file and the code describe what
ships. `FluxRadar-Feature-Plan.md` is the **target specification** — it states where the product
is going, not what runs today; read its status header before quoting it. Day-to-day process notes
are kept outside the repository.

Two one-time packages are on sale: **Basic** ($39 — SEO and AI SEO / GEO) and **Complete** ($87
— all ten modules). The earlier Website Audit package was removed on 2026-10-19; rows stored
with that plan are read through `packages/contracts/src/stored-plan.ts` and render as an archived,
read-only report. A free one-off homepage check (four SEO rules, no
score) is available to anyone with an account; it is not a prerequisite for buying a scan. The
tariff matrix in `packages/contracts/src/tariffs.ts` is the one place that defines them: prices,
module lists, URL and AI-request limits, retention (30 days for Free and Basic, 365 for
Complete) and the capabilities each package carries — scan history, issue history,
export and the AI Action Plan.

## Structure

```
packages/
  contracts/     types, enums, zod schemas, tariff matrix, audit-rule registry
  fingerprint/   URL normalization v1 + fingerprint-v1
  scoring/       module/overall score, coverage, statuses
  safe-fetch/    SSRF-guarded fetch layer
  crawler/       scope, robots.txt, sitemap, dedup, tariff limits
  rules/         rule engine + the deterministic SEO, security, accessibility,
                 reliability, content and privacy rules
  ai/            AiProvider contract, the Anthropic/OpenAI/Gemini/Perplexity
                 adapters, the GEO and UX AI modules, and a mock provider
  export/        canonical records, JSON Schema, semantic validator, CSV
apps/
  api/           Express + Prisma (PostgreSQL): auth, billing, scan orchestrator
  web/           React + Vite UI (Mac OS 8/9 design system), English and Ukrainian
```

Cloudflare and WordPress are intentionally deferred; report artifacts use Hetzner S3.

The deterministic audit modules are public-only: they inspect public HTTP responses and DOM, with passive TLS and DNS observations in Security, and
no customer API token is required. This includes JSON-LD/social preview, the OWASP ASVS public
security profile, Privacy & Consent signals and the WCAG 2.2 AA accessibility rules in
`packages/rules/src/accessibility/`, where each rule states what it can decide from the page and
what it leaves to manual review. Two parts of a paid scan are not public-only:

- **AI SEO / GEO** sends public page content and a FluxRadar prompt to AI providers FluxLab pays
  for. Claude (Anthropic) and ChatGPT (OpenAI) are asked by default; Gemini (Google) and
  Perplexity receive data only when a scan names them and the stored notice covers them
  (`packages/ai/src/types.ts`, `packages/ai/src/consent.ts`).
- **Analytics** reads Google Search Console, Google Analytics and Bing Webmaster data over an
  OAuth connection the owner makes. Without one the module is `Unavailable`, which costs no score.

## What a scan actually runs

| Module          | What ships today                                                                                          | Source                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| SEO             | 27 deterministic rules (technical, on-page, JSON-LD, social preview, local observations)                                      | `packages/rules/src/seo/`                                |
| AI SEO / GEO    | AI-crawler readiness read from `robots.txt` and the crawl, plus per-provider visibility questions         | `packages/rules/src/ai-readiness.ts`, `packages/ai/`     |
| Security        | 8 passive rules: TLS, SPF/DMARC, security headers, HSTS, cookie attributes, CSP, Permissions-Policy, CORS | `packages/rules/src/security/`                           |
| Performance     | PageSpeed Insights (Lighthouse lab) + CrUX field data; up to 5 URLs × 2 devices × 2 runs, median reported | `apps/api/src/integrations/performance/`                 |
| Accessibility   | 12 static-DOM accessibility rules                                                                         | `packages/rules/src/accessibility/`                      |
| Reliability     | 5 rules: URL availability, 4xx/5xx verdict, response time, API expected status, API no-credentials policy | `packages/rules/src/reliability/`                        |
| Content Quality | 7 rules: duplicates, low-value pages, broken media, readability, placeholders, article/medical transparency            | `packages/rules/src/content/`                            |
| Privacy         | 4 rules: cookies, consent signal, third-party scripts, privacy-policy discoverability                     | `packages/rules/src/privacy/`                            |
| UX/Conversion   | 3 static rules plus 3 AI readings of the page; a side score, outside the overall score                    | `packages/rules/src/ux/`, `packages/ai/src/ux-module.ts` |
| Analytics       | Search Console, Google Analytics and Bing Webmaster checks, when connected                                | `apps/api/src/integrations/`                             |

Local observations (`SEO-ADV-001`, `SEO-STRUCT-003/004`) and transparency observations
(`CONTENT-008/012`) are informational and do not deduct score. NAP comparisons need an explicit
shared identity or a unique matching name/address in the same language; aliases, overlapping
phone sets and separate branches are preserved. They inspect this site's crawl, not external
business listings. Unreadable/partial crawls, script shells and bounded-out JSON-LD do not justify
site-wide absence findings or closing earlier cross-page observations. Available page-owned schema
properties can still be inspected.

Local markup distinguishes required name/physical address from recommended telephone/hours/geo,
and recommends the most specific applicable business subtype. Self-serving clinic ratings do not
qualify for Google review stars; missing ratings never fail. Article attribution accepts an author
OR medical reviewer plus a publication date; modification dates are optional. Medical observations
record on-site profiles, qualification descriptions, about/contact and license information, without
verifying credentials or legal validity. These checks promise no Google trust score, rankings or
GEO gains. References: [Google local business](https://developers.google.com/search/docs/appearance/structured-data/local-business),
[review snippets](https://developers.google.com/search/docs/appearance/structured-data/review-snippet),
[helpful content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content).

Not implemented, and not promised anywhere in the product UI: active security testing, scheduled
monitoring, notifications, team workspaces, and the deferred SEO/Privacy/Content rules the plan
document reserves IDs for. The public coverage page (`apps/web/src/checks-copy.en.ts` and
`.uk.ts`) is the customer-facing statement of the same list and is kept in step with these rules.

## Commands

Requires Node >= 24 and pnpm 10.

```
pnpm install        # install workspace dependencies
pnpm dev            # run dev servers (api + web) in parallel
pnpm build          # build all packages and apps
pnpm test           # run all tests
pnpm lint           # ESLint over the whole repo
pnpm typecheck      # tsc --noEmit in every package
```

Copy `.env.example` to `.env` and fill in values before running the API.

## Paid scans locally

Creem's test mode works from localhost for the checkout page itself: with the `CREEM_*`
test-environment values in `.env` (see `.env.example`), the API creates a checkout, the browser is
sent to Creem's hosted page, and after the test card (4111 1111 1111 1111) Creem redirects back to
`FRONTEND_ORIGIN/checkout/return`. What Creem cannot do is POST the `checkout.completed` webhook to
localhost, and the scan exists only once that signed webhook has been handled — so either forward
it with the Creem CLI, which listens in test mode by default:

```
creem listen --forward-to http://localhost:3310/webhooks/creem
```

(adjust the port to `PORT` in `.env`; the CLI prints the webhook secret it signs with, which goes
in `CREEM_WEBHOOK_SECRET`), or use the internal allowlist instead, the only way to a paid plan
without a signed Creem order, in every environment (D-229):

1. In `.env`, set `FLUXRADAR_INTERNAL_FREE_EMAILS` to the email you register with locally
   (comma-separated for several; matching ignores case).
2. Restart the API, then register or sign in with that email.
3. The new-scan screen now offers **Basic · internal free** and **Complete · internal free**
   Launching one calls `POST /billing/internal-checkout`,
   which queues the scan straight away.

Such a scan writes no `Purchase` or `Entitlement` (the response says
`billing: "internal-free"`), so refunds, receipts and the reachability gate in front of a sale are
not exercised this way — the Creem tests (`apps/api/src/billing/creem`) cover the webhook, refunds
and disputes without an account. Any account not on the list gets `402` from that route.
