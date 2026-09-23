# FluxRadar

Pay-per-scan website audit platform (v0.1 — local MVP). Plan and process notes are kept
outside the repository; what ships is described here and in the code.

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

FastSpring cannot complete a checkout from localhost — its test mode needs the storefront to be
reached over a public https origin — so a local Basic or Complete scan runs through the internal
allowlist, the only way to a paid plan without a signed FastSpring order, in every environment
(D-229):

1. In `.env`, set `FLUXRADAR_INTERNAL_FREE_EMAILS` to the email you register with locally
   (comma-separated for several; matching ignores case).
2. Restart the API, then register or sign in with that email.
3. The new-scan screen now offers **Basic · internal free** and **Complete · internal free**.
   Launching one calls `POST /billing/internal-checkout`, which queues the scan straight away.

Such a scan writes no `Purchase` or `Entitlement` (the response says
`billing: "internal-free"`), so refunds, receipts and the reachability gate in front of a sale are
not exercised this way — the tests cover those (`apps/api/src/billing/fastspring`). Any account
not on the list gets `402` from that route.
