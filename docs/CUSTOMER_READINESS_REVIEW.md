# Customer-readiness review

Дата: 2026-09-05. Объект: CR-01–CR-09 из
[`CUSTOMER_READINESS_TASKS.md`](CUSTOMER_READINESS_TASKS.md).

## Независимое ревью

Два независимых Claude Opus review прошли по backend/security и
DevOps/reliability. После первого раунда были исправлены найденные P1/P2:

- account deletion: полный FK-safe порядок, идемпотентность, batch cleanup,
  S3 cleanup после commit и агрегированный warning при ошибке;
- migration: dedup старых `AccountDeletionAudit` перед unique index;
- Resend: server-side adapter, timeout, production fail-fast для env,
  hashed single-use tokens, non-enumerating reset/verification;
- rate limits: registration, email actions, scans, checkout, webhooks,
  bounded limiter storage and token-attempt guard;
- deploy: immutable images from CI, first-run Postgres bootstrap,
  isolated release containers, readiness gate, concrete durable Caddy
  upstreams, atomic symlink/state update, rollback and old-container cleanup;
- CSP, dedicated integration encryption secret, onboarding and homepage/blog
  SEO remain covered by the implementation described in the task document.

Финальный DevOps review подтвердил остаточные deployment-риски до их
исправления; после этого локальная проверка актуального дерева не выявила
новых P0/P1. Последний отдельный Opus control-run не вернул результат за
несколько минут и был остановлен; его вывод не используется как evidence.

## Quality gates

Пройдено в текущем working tree:

- `pnpm test`: все workspace tests, включая 20 API test files / 75 API tests,
  13 web tests и package tests;
- `pnpm typecheck`;
- `pnpm lint`;
- `pnpm build`;
- Prettier check для изменённых поддерживаемых форматов;
- `actionlint .github/workflows/deploy.yml`;
- `docker compose config --quiet`;
- `git diff --check`.

## Что ещё не считается закрытым

- CR-09 остаётся `PARTIAL`: есть API/frontend coverage, refresh/resume и
  mocked email flows, но настоящий browser-runner E2E suite ещё не добавлен.
- Live Paddle, automated PostgreSQL backups/restore, monitoring/error
  tracking/alerts остаются deferred по решению владельца проекта.
- Production не запускался и не пушился из этого раунда. Перед merge/deploy
  нужно проверить private production env: `INTEGRATION_ENCRYPTION_KEY`,
  Postgres credentials и `FLUXRADAR_INTERNAL_FREE_EMAILS`. Resend
  (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`) опционален: пока не подключён, API
  стартует, а email-флоу отдают `not-configured`.
- Перед первым новым deploy нужно подтвердить, что существующие production
  integration secrets не были зашифрованы только старым fallback на
  `SESSION_SECRET`; иначе подключения нужно перепривязать.
