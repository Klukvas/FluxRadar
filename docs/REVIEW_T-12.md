# REVIEW_T-12 — API, auth, billing, worker, issues и export HTTP API

**Дата:** 2026-09-03  
**Ревьювер:** Codex coordinator  
**Вердикт:** **APPROVED AFTER FIX**

## Что проверено

- `createApp` собирает middleware, raw Paddle webhook, JSON API, CORS, auth,
  profiles, billing, scans, issues и export routes.
- Все пользовательские чтения tenant-scoped по `accountId`; прямой доступ к
  чужому `profileId`/`scanId` возвращает not-found.
- Auth использует bcryptjs, httpOnly session cookie, TTL и login rate limit.
- Free check claim выполняется атомарно в одной транзакции через
  `Account.freeCheckUsedAt` и глобальный уникальный `FreeCheckClaim.origin`;
  повтор аккаунта даёт `FREE_CHECK_USED`, а повтор домена из другого аккаунта —
  `FREE_CHECK_DOMAIN_USED`.
- Paid checkout проходит через подписанный MockPaddle webhook и создаёт ровно
  один purchase, entitlement, scan и job.
- Worker выполняет atomic job claim, state machine, crawl → rules → GEO,
  сохраняет прогресс, module stubs, score и refund outcomes.
- Issue Center поддерживает фильтры и пользовательские статусы; Resolved и
  Reopened производятся только сравнением fingerprint между Complete-сканами.
- Complete export строит canonical records и прогоняет schema + semantic
  validation перед JSON/CSV ответом.

## Исправление во время ревью

Добавлена проверка active entitlement на `POST /scans/:scanId/retry`:
истёкший, suspended, не-paid или отсутствующий entitlement блокирует retry с
`ENTITLEMENT_INACTIVE`. Это закрывает риск запуска платной повторной попытки
после потери права доступа.

## Остаточные ограничения v0.1

Paddle и AI остаются mock-адаптерами, worker работает in-process, Google OAuth,
active security, Performance и Analytics не входят в этот локальный релиз — это
зафиксированный scope `IMPLEMENTATION_PLAN.md`, а не незакрытая ошибка API.
