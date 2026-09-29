# FluxRadar

Pay-per-scan website audit platform (v0.1 — local MVP). Plan and process notes are kept
outside the repository; what ships is described here and in the code.

Three one-time packages: **Basic** ($55 — SEO and AI SEO / GEO), **Website Audit** ($79 — the
eight non-search modules), and **Complete** ($120 — all ten). Basic and Website Audit are
siblings; Complete is both of them together. The tariff matrix in
`packages/contracts/src/tariffs.ts` is the one place that defines them.

## Structure

```
packages/
  contracts/     types, enums, zod schemas, tariff matrix, audit-rule registry
  fingerprint/   URL normalization v1 + fingerprint-v1
  scoring/       module/overall score, coverage, statuses
  safe-fetch/    SSRF-guarded fetch layer
  crawler/       scope, robots.txt, sitemap, dedup, tariff limits
  rules/         rule engine + SEO/security/accessibility and other audit rules
  ai/            AiProvider contract + MockAiProvider
  export/        canonical records, JSON Schema, semantic validator, CSV
apps/
  api/           Express + Prisma (PostgreSQL): auth, billing, scan orchestrator
  web/           React + Vite UI (Mac OS 8/9 design system)

Cloudflare and WordPress are intentionally deferred; report artifacts use Hetzner S3. All current audit
profiles are public-only: no customer API tokens are required. This includes JSON-LD/social
preview, OWASP ASVS Public Security Profile, Privacy & Consent signals, EN 301 549/Section 508
mapping, and AI crawler readiness. The WCAG 2.2 AA Accessibility module lives in
`packages/rules/src/accessibility/`, where each rule states what it can decide from the
page and what it leaves to manual review.
```

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
3. The new-scan screen now offers **Basic · internal free**, **Website Audit · internal free**
   and **Complete · internal free**. Launching one calls `POST /billing/internal-checkout`,
   which queues the scan straight away.

Such a scan writes no `Purchase` or `Entitlement` (the response says
`billing: "internal-free"`), so refunds, receipts and the reachability gate in front of a sale are
not exercised this way — the Creem tests (`apps/api/src/billing/creem`) cover the webhook, refunds
and disputes without an account. Any account not on the list gets `402` from that route.
