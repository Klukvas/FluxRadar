# FluxRadar

Pay-per-scan website audit platform (v0.1 — local MVP). Plan and process docs live in `docs/`.

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
  api/           Express + Prisma (SQLite): auth, billing, scan orchestrator
  web/           React + Vite UI (Mac OS 8/9 design system)

Current integrations are documented in `docs/INTEGRATIONS.md`. Cloudflare and
WordPress are intentionally deferred; report artifacts use Hetzner S3. All current audit
profiles are public-only: no customer API tokens are required. This includes JSON-LD/social
preview, OWASP ASVS Public Security Profile, Privacy & Consent signals, EN 301 549/Section 508
mapping, and AI crawler readiness. The WCAG 2.2 AA Accessibility module and its
automated/manual-review boundary are documented in `docs/WCAG_AUDIT.md`.
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
