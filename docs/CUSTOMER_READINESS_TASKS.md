# Customer readiness tasks

Основание: независимый аудит четырьмя Claude Opus-агентами и последующая
проверка кода. Цель этого набора — поднять качество продукта вокруг уже
работающего public-only audit engine.

## Scope этой итерации

| ID | Задача | Приоритет | Статус |
|---|---|---:|---|
| CR-01 | Исправить полное удаление аккаунта и связанных данных | P0 | DONE |
| CR-02 | Добавить Resend: email verification, password reset, transactional email | P0 | DONE |
| CR-03 | Сделать deploy rollback-safe | P0 | DONE |
| CR-04 | Добавить DB-aware readiness/health check | P1 | DONE |
| CR-05 | Расширить rate limiting на регистрацию и дорогие операции | P1 | DONE |
| CR-06 | Добавить CSP и сделать `INTEGRATION_ENCRYPTION_KEY` обязательным в production | P1 | DONE |
| CR-07 | Добавить onboarding для первого пользователя | P1 | DONE |
| CR-08 | Доделать SEO homepage и добавить блог | P1 | DONE |
| CR-09 | Добавить E2E coverage критических customer journeys | P1 | PARTIAL |

## CR-01 — Account deletion

Удаление аккаунта должно быть транзакционным и удалять `IntegrationConnection`,
`IntegrationOAuthState`, `ExportArtifact`, scans, jobs, issues, AI records,
consents, purchases, entitlements, sessions и site profiles. Для S3-объектов
нужен безопасный cleanup после удаления DB-связи или явная retryable-очередь,
чтобы не оставить приватные отчёты orphaned. `AccountDeletionAudit` остаётся
content-free.

Критерии: пользователь с OAuth connection и JSON/CSV artifact удаляется без FK
ошибки; повторная операция идемпотентна; чужие данные не затрагиваются; тест
проверяет отсутствие секретов и артефактов после завершения.

## CR-02 — Resend email lifecycle

Использовать Resend Email API через server-side adapter, не передавая API key в
frontend. API отправки использует `Authorization: Bearer`, `from`, `to`,
`subject` и HTML/text body согласно официальной документации Resend.

Добавить env-конфигурацию без значений в репозиторий:

- `RESEND_API_KEY`;
- `RESEND_FROM_EMAIL`;
- `RESEND_REPLY_TO` (optional).

Потоки: email verification после регистрации; password reset с одноразовым
короткоживущим token; transactional email для подтверждения покупки, запуска
скана, завершения отчёта и refund/failure. Токены хранить только в hashed
виде, ограничить TTL и попытки, не раскрывать существование email. В dev/test
использовать mock mailer, в production — Resend. UI должен иметь состояния
sent, expired, already-used, invalid и provider failure.

## CR-03 — Rollback-safe deploy

CI должен собирать и проверять versioned release artifact/image. Production не
должен переключать `current` до успешной проверки новой версии. Нужны:

1. staging directory/release;
2. migrations с понятным failure path;
3. DB-aware readiness check;
4. atomic traffic switch;
5. автоматический возврат на предыдущий release при неуспешном smoke test;
6. сохранение предыдущей версии и documented one-command rollback.

Не удалять старые release до подтверждения стабильности новой версии.

## CR-04 — DB-aware health

Разделить liveness и readiness либо добавить DB probe. Readiness должен
проверять `SELECT 1` через Prisma с коротким timeout и возвращать безопасный
503 при недоступной БД. Docker, deploy smoke test и reverse proxy должны
использовать readiness для deploy gate; liveness остаётся healthcheck для
контейнера и reverse proxy, чтобы transient DB outage не вызвал restart loop.

## CR-05 — Rate limiting

Добавить ограничения для регистрации, восстановления пароля, запуска scan,
retry, дорогих external checks и webhook abuse protection. Лимиты должны быть
на IP и account где применимо, а для single-server v0.1 явно задокументировать
in-memory границу; для нескольких replicas нужен Postgres/Redis-backed вариант.
Ошибки — дружелюбный 429 без технических деталей.

## CR-06 — CSP и encryption key

Добавить минимальную CSP в Caddy, совместимую с текущей SPA, без `unsafe-eval`;
проверить production assets, API и OAuth callback. `INTEGRATION_ENCRYPTION_KEY`
должен быть отдельным обязательным production secret; fallback на
`SESSION_SECRET` оставить только для явно обозначенного dev/test режима либо
удалить. Startup validation должна сообщать только имя отсутствующей
настройки, никогда не её значение.

## CR-07 — Onboarding

После регистрации показать короткий first-run flow: создать первый site
profile, объяснить public-only scope, выбрать бесплатную homepage check или
план, показать consent перед AI/GEO и ссылку на privacy/terms. Добавить
progressive empty states, skip/revisit и не блокировать существующих
пользователей.

## CR-08 — Homepage SEO и blog

Для homepage добавить уникальные title, meta description, canonical, OG/Twitter
preview, favicon, Organization/WebSite JSON-LD, `robots.txt` и `sitemap.xml`.
Публичные страницы `/blog` и `/blog/:slug` должны иметь indexable semantic
HTML, уникальные metadata, Article JSON-LD и descriptive internal links.
Контент блога не генерировать фиктивным placeholder-текстом: сначала добавить
небольшой реестр реальных статей/черновиков и честные даты.

## CR-09 — E2E

Добавить browser-level tests для: register → profile → free scan → report;
refresh active scan; refresh completed report; free abuse block; auth errors;
paid checkout boundary (пока live Paddle deferred); Complete export; account
deletion; Resend verification/reset через mock mailer. Реальные payment,
Resend и AI requests в CI не выполнять.

## Deferred / не входит в реализацию сейчас

- Live Paddle checkout — ждём отдельного подключения и проверки merchant flow.
- Automated PostgreSQL backups/restore — отдельный infrastructure track.
- Monitoring, error tracking and alerting — отдельный operations track.

## Implementation notes

- CR-01 now deletes all account-owned rows in FK-safe order, removes private
  object keys after commit, logs an aggregate cleanup warning when S3 deletion
  fails, and is idempotent. `AccountDeletionAudit.accountIdHash` is unique.
- CR-02 uses a server-side Resend adapter in production and a mock mailer in
  development/test. Production startup now fails fast unless both
  `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are configured.
- CR-03 builds immutable API/web images in GitHub Actions, transfers them to
  Hetzner, probes isolated release containers through `/health/ready`, switches
  Caddy only after the probes pass, and updates the `current` symlink/state
  only after the local Caddy smoke succeeds. The GitHub public smoke runs
  immediately afterward. The previous release is retained and can be restored
  with the documented command; older release directories and images are pruned
  after two rollback candidates remain.
- CR-04 keeps `/health` as a DB-free liveness probe and `/health/ready` as the
  database-aware readiness probe. Deploy uses readiness; container health uses
  liveness to avoid restart loops during a transient DB outage.
- The Caddy container is switched only after the new API and web containers
  pass their direct probes. Releases share the existing `fluxradar_default`
  network, while Caddy routes to release-specific container names; this makes
  `current` a rollback/source-of-truth pointer instead of the traffic switch.
- CR-05 is bounded in-memory protection for the single-server deployment:
  registration, email actions, scans/retries, checkout and webhook requests are
  limited. Expired limiter keys are evicted at a fixed cap; multi-replica use
  still requires a shared store.
- CR-09 has API integration and frontend route/component coverage, including
  refresh/resume logic and mocked email flows. A real browser-runner suite is
  still pending and must be added before calling the customer journey coverage
  complete.

## Decision required: domain ownership

Ownership verification не является обязательной частью public-only бесплатной
проверки, но снижает abuse/legal риск для платных глубоких проверок. До
отдельного решения не внедрять silently. Варианты:

1. **Строго:** DNS TXT/meta/GSC proof перед любым paid scan — сильная защита,
   больше friction.
2. **Мягко:** paid scan без proof, но с ToS, abuse-report каналом и лимитами —
   лучший conversion, выше abuse риск.
3. **Баланс:** free homepage check без proof; proof разблокирует глубокие или
   дорогие модули — рекомендуется для FluxRadar.
