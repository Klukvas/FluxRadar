# FluxRadar

Pay-per-scan website audit platform (v0.1 — local MVP). Plan and process docs live in `docs/`.

## Structure

```
packages/
  contracts/     types, enums, zod schemas, tariff matrix, rules-mvp-0.1 registry
  fingerprint/   URL normalization v1 + fingerprint-v1
  scoring/       module/overall score, coverage, statuses
  safe-fetch/    SSRF-guarded fetch layer
  crawler/       scope, robots.txt, sitemap, dedup, tariff limits
  rules/         rule engine + rules-mvp-0.1 implementations
  ai/            AiProvider contract + MockAiProvider
  export/        canonical records, JSON Schema, semantic validator, CSV
apps/
  api/           Express + Prisma (SQLite): auth, billing, scan orchestrator
  web/           React + Vite UI (Mac OS 8/9 design system)
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
