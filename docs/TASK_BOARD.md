# TASK_BOARD — FluxRadar v0.1

Статусы: `PENDING` → `IN PROGRESS` → `REVIEW` → `TESTING` → `DONE` (или `BLOCKED`).
Детали задач — ниже таблицы. Отчёты: `docs/REVIEW_<ID>.md`, `docs/TEST_<ID>.md`.

| ID | Задача | Зависимости | Агент | Статус | Изменённые файлы | Ревью | Тесты | Комментарии |
|---|---|---|---|---|---|---|---|---|
| T-01 | Скелет монорепо (pnpm, TS, Vitest, lint) | — | impl-агент | DONE | корень, packages/*, apps/* | ✅ approved-with-fixes | ✅ pass | TS 6.0, Vite 8, React 19 |
| T-02 | contracts: типы, enums, тарифы, реестр rules-mvp-0.1 | T-01 | impl-агент | DONE | packages/contracts | ✅ approved (2 фикса) | ✅ pass | реестр = 42 правила (D-107), не 37 |
| T-03 | fingerprint: URL-нормализация v1 + fingerprint-v1 | T-02 | impl-агент | DONE | packages/fingerprint | ✅ approved (1 фикс, D-118) | ✅ pass | golden vectors 6/6 ✅, независимый пересчёт ✅ |
| T-04 | scoring: score engine §15 | T-02, T-03 | impl-агент | DONE | packages/scoring | ✅ approved (0 фиксов, пересчёт 3 сценариев ✅) | ✅ pass | golden 96.50 ✅ (61 тест) |
| T-05 | safe-fetch: SSRF-guard fetch-слой | T-02 | — | PENDING | — | — | — | IPv4+IPv6, redirects, лимиты D-028/D-030 |
| T-06 | БД/биллинг: Prisma-схема, state machine, MockPaddle | T-02 | — | PENDING | — | — | — | идемпотентность BILLING-001..006 |
| T-07 | crawler: scope, robots, dedup, лимиты + fixture-сайт | T-03, T-05 | — | PENDING | — | — | — | |
| T-08 | rules: движок + SEO-правила (13) | T-02, T-03, T-07 | — | PENDING | — | — | — | fx-фикстуры по D-025 |
| T-09 | rules: passive-модули (SEC/REL/A11Y/CONTENT/PRIVACY, 14) | T-08 | — | PENDING | — | — | — | |
| T-10 | ai: adapter-контракт, MockAiProvider, caps/quota/consent | T-02, T-06 | — | PENDING | — | — | — | GEO-правила ×5 |
| T-11 | export: records, JSON Schema, semantic validator, CSV | T-02, T-03, T-04 | — | PENDING | — | — | — | EXPORT-001..003 + ECON-001 CLI |
| T-12 | api: auth, профили, scans, orchestrator/worker, issues, export API | T-04–T-11 | — | PENDING | — | — | — | |
| T-13 | web: дизайн-система (токены + компоненты) | T-01 | — | PENDING | — | — | — | по DESIGN_SYSTEM.md |
| T-14 | web: экраны (auth, профили, checkout, скан, дашборд, issues, export) | T-12, T-13 | — | PENDING | — | — | — | |
| T-15 | integration: pipeline на fixture-сайте, webhook-идемпотентность, гейтирование | T-12 | — | PENDING | — | — | — | |
| T-16 | Финальная проверка + FINAL_REPORT | все | координатор | PENDING | — | — | — | |

---

## Детали задач

### T-01 — Скелет монорепо
**Описание:** pnpm workspaces; `packages/{contracts,fingerprint,scoring,safe-fetch,crawler,rules,ai,export}`, `apps/{api,web}`; общий `tsconfig.base.json` (strict), Vitest workspace, ESLint+Prettier, корневые скрипты `dev/build/test/lint/typecheck`, `.gitignore`, `.env.example`.
**Критерии:** `pnpm install`, `pnpm -r build`, `pnpm test` (пустые тесты-плейсхолдеры), `pnpm lint`, `pnpm typecheck` проходят.
**Проверка:** перечисленные команды. **Риски:** несовместимость версий тулинга.

### T-02 — contracts
**Описание:** типы/enums (статусы скана/модулей runtime и export — раздельно, severity, тарифы, record types), тарифная матрица §18, реестр правил `rules-mvp-0.1` (37 позиций: id, module, target_kind, severity, категория, краткий оракул, page/site-level), zod-схемы входных данных API, константы лимитов (D-028/D-030, caps AI).
**Критерии:** пакет собирается, реестр покрыт тестом на уникальность/полноту, severity ∈ {Critical,High,Medium,Low}.
**Проверка:** `pnpm --filter contracts test`. **Риски:** расхождение с планом — сверять с §14–§18.

### T-03 — fingerprint
**Описание:** URL-нормализация v1 (§14 + D-018) и fingerprint-v1: canonical serialization (length-prefix+NUL), SHA-256, формат `fluxradar-fp-v1:<hex>`. Тесты: 6 golden-векторов, вся equivalence/difference-таблица §14, IDN/percent-case/идемпотентность (D по PLAN_REVIEW QA-11).
**Критерии:** 6/6 golden hash совпадают байт-в-байт; equivalence-таблица зелёная.
**Проверка:** `pnpm --filter fingerprint test`. **Риски:** тонкости punycode/NFC — использовать встроенные `URL`/`normalize('NFC')`.

### T-04 — scoring
**Описание:** чистые функции: module_score (dedup fingerprint → max severity per rule → penalty × min(1, affected/applicable) → round2 half-up), coverage, effective weights, overall/Basic score, статусы Provisional/Insufficient data/Not applicable/completed-but-unusable (D-016/17/20/21/22).
**Критерии:** golden 96.50; фикстуры: site-level Critical, Partial coverage, all Unavailable, all Not applicable, Failed, Cancelled, нулевой знаменатель.
**Проверка:** `pnpm --filter scoring test`. **Риски:** float-накопление — считать в сотых (integer).

### T-05 — safe-fetch
**Описание:** fetch-обёртка: DNS-резолв всех A/AAAA до соединения, blocklist (loopback, RFC1918, fc00::/7, fe80::/10, ::ffff:0:0/96, 169.254.0.0/16, metadata 169.254.169.254), pin разрешённого IP для соединения, проверка каждого redirect Location (лимит 5), таймаут 10 s, max body 5 MB, max URL 2048 B, per-host token bucket 5 req/s / 4 concurrent (D-028/D-030). Инъектируемый resolver/transport для тестов.
**Критерии:** unit-тесты блокировок (private IPv4/IPv6, redirect на metadata, превышение размера/времени); localhost разрешён только в test-режиме через явный флаг (для fixture-сайта).
**Проверка:** `pnpm --filter safe-fetch test`. **Риски:** DNS-моки — вынести resolver в интерфейс.

### T-06 — БД и биллинг
**Описание:** Prisma (SQLite): Account, Session, SiteProfile, Purchase (unique paddle_transaction_id), Entitlement (unique purchase_id), Scan (unique purchase_id; статусы; retry-счётчики), ScanModule, Issue, AiResponseRecord, WebhookEvent (unique paddle_event_id), RefundRecord (unique purchase_id), Job. Сервисы: webhook-handler MockPaddle (HMAC-SHA256 по raw body, D-029) в одной транзакции; state machine переходов §18 через conditional update; refund flow (`refund:{purchase_id}`, reason enum); dev-checkout endpoint-хелпер, эмитящий подписанный webhook.
**Критерии:** тесты BILLING-001..006: невалидная подпись reject; дубль event → один entitlement/scan; out-of-order не откатывает состояние; запрещённые переходы отвергаются; retry-счётчики ≤ 1; один refund на purchase; NoUsableOutput-ветка (D-026/D-027).
**Проверка:** `pnpm --filter api test -- billing`. **Риски:** транзакции SQLite — использовать `prisma.$transaction`.

### T-07 — crawler
**Описание:** обход в пределах scope (домен/поддомены по флагу, include/exclude-шаблоны, глубина, лимит страниц тарифа), robots.txt по умолчанию (+ логируемый override), sitemap.xml как источник, dedup по нормализованному URL, учёт пропущенных сверх лимита, сбор PageSnapshot (status, headers, redirect chain, HTML, timing). Fixture-сайт: локальный static-сервер из `fixtures/site` (~12 страниц: валидная, без title, чужой canonical, 404, redirect chain, noindex, дубликат, пустая, broken image, mixed content, форма без labels, страница с trackers).
**Критерии:** integration-тест обхода fixture-сайта: точный список URL, соблюдение robots/лимитов, дедуп.
**Проверка:** `pnpm --filter crawler test`. **Риски:** нестабильность парсинга HTML — использовать `node-html-parser` или `cheerio`.

### T-08 — rules: движок + SEO
**Описание:** rule engine: `Rule = (ctx: SiteContext, page?: PageSnapshot) => Finding[]`; учёт applicable/affected targets; сборка Issue с fingerprint (T-03), evidence (http/dom excerpt ≤ 2048), confidence, severity из реестра. Реализация SEO-TECH-001..008,013 и SEO-ONPAGE-001,002,003,005. Фикстуры `fx-<rule_id>-{positive,negative}` (+boundary где есть порог).
**Критерии:** все фикстуры зелёные; на fixture-сайте — ожидаемый набор findings с ожидаемыми fingerprint.
**Проверка:** `pnpm --filter rules test`. **Риски:** трактовки правил — фиксировать оракул в комментарии к правилу.

### T-09 — rules: passive-модули
**Описание:** SEC-PASSIVE-002,003,005; REL-URL-001,003,009 + REL-API-003,005 (expected-status precedence §9, verdict pass/warning/fail, D-023); A11Y-002,004; CONTENT-003 (порог 200 видимых символов),004; PRIVACY-001,003. Фикстуры по D-025.
**Критерии:** фикстуры зелёные, включая boundary «ожидаемый 404 → pass», «неожиданный 404 → warning».
**Проверка:** `pnpm --filter rules test`. **Риски:** severity-калибровка — брать из реестра T-02.

### T-10 — ai (mock)
**Описание:** интерфейс `AiProvider` + `MockAiProvider` (OpenAI-shaped, детерминированные ответы из фикстур); normalized response contract §5 (все поля, `total=input+output`); caps 8000/2000 + детерминированная truncation `[TRUNCATED]` (приоритет: system → вопрос → факты → заголовки); `ai_request_key`; quota-учёт (50/500, retry не списывает повторно); consent per-scan (без согласия → module `Unavailable`, без записи ai_response, без списания квоты); redaction v1 (email/JWT/API-key/cookie-паттерны, fail-closed + timeout); GEO-VIS-003/004 (brand/link в ответе), GEO-METHOD-002/005.
**Критерии:** тесты контракта: pre-response отказ → нет ai_response record; truncation детерминирована; quota-инварианты.
**Проверка:** `pnpm --filter ai test`. **Риски:** переусложнение — только mock-путь, реальные HTTP-клиенты не писать.

### T-11 — export
**Описание:** canonical records builder (summary/module/ai_response/issue, D-014/15/16/19), JSON Schema §16 дословно + ajv-валидация, semantic validator (инварианты 1–9 EXPORT-001 + penalty-формула D-016), CSV-writer (RFC 4180, UTF-8 без BOM, LF, порядок, null→пустое, формула-экранирование), zero-issue → summary-строка; `econ-validate` CLI (ECON-001: contribution margin, support-reserve floor, break-even, floor 45).
**Критерии:** канонический пример из плана проходит; негативные пробы (score_delta≠−penalty, отсутствие status_reason) отклоняются semantic-валидатором; CSV-снапшот-тест; ECON-001 фикстуры (валидный forecast проходит, reserve ниже floor — нет).
**Проверка:** `pnpm --filter export test`. **Риски:** дословность схемы — копировать из плана, не переписывать.

### T-12 — api
**Описание:** Express: auth (register/login/logout, bcrypt, httpOnly session, rate limit 5/15 мин), SiteProfile CRUD, dev-checkout → MockPaddle webhook → entitlement → scan Pending; orchestrator: Queued→Running (atomic claim), последовательный прогон модулей по тарифу (Free: 4 проверки homepage; Basic: SEO+GEO(mock); Complete: все доступные, остальные Unavailable/Not applicable), прогресс в БД (polling-endpoint), сборка issues/score (T-04), Resolved/Reopened сравнение с предыдущим Complete-сканом по fingerprint; Issue Center API (фильтры, статусы, False Positive/Ignored); export API (JSON records + CSV, только Complete); tariff-гейтирование истории.
**Критерии:** supertest-тесты happy path каждого тарифа + отказ экспорта на Basic; envelope-формат ответов; ошибки не глотаются.
**Проверка:** `pnpm --filter api test`. **Риски:** объём — держать модули маленькими файлами (<400 строк).

### T-13 — web: дизайн-система
**Описание:** `tokens.css`, `base.css` (reset, bevel-утилиты), компоненты из DESIGN_SYSTEM §12 (Window, MenuBar, Panel, Terminal, Button, Input, Select, Checkbox, Tabs, DataTable, StatusChip, ScoreDial, ProgressBar, AlertDialog, EmptyState, FieldRow) с состояниями; демо-страница `/styleguide` со всеми компонентами.
**Критерии:** styleguide рендерит все компоненты и состояния; клавиатурная навигация и focus-ring работают; сборка проходит.
**Проверка:** `pnpm --filter web build` + ручной просмотр styleguide. **Риски:** дрейф от DESIGN_SYSTEM.md — сверять по чек-листу §9/§11.

### T-14 — web: экраны
**Описание:** React Router: Login/Register → Desktop (профили сайтов + запуск Free-проверки) → New Scan wizard (домен, scope, тариф, dev-checkout) → Scan progress (терминал-лог, polling) → Results dashboard (общий score + модули + coverage) → Issue Center (таблица, фильтры, статусы) → Issue detail (evidence) → Export (CSV, Complete-only) → Free-результат. Все состояния loading/error/empty/success.
**Критерии:** happy path вручную от регистрации до CSV; Basic не видит export; узкий экран работает.
**Проверка:** `pnpm --filter web build` + ручной прогон с API. **Риски:** объём — переиспользовать T-13, не изобретать новые стили.

### T-15 — integration
**Описание:** сквозные тесты уровня API: полный Complete-скан fixture-сайта → ожидаемый набор issues (по fingerprint) → score → export records проходят JSON Schema + semantic validator → CSV корректен; webhook-идемпотентность (дубль, out-of-order, конкурентная доставка); Free/Basic-гейтирование; NoUsableOutput → refund-ветка на недоступном fixture-домене; Resolved/Reopened между двумя сканами.
**Критерии:** все сценарии зелёные в CI-прогоне `pnpm test`.
**Проверка:** `pnpm --filter api test -- integration`. **Риски:** время прогона — держать fixture-сайт маленьким.

### T-16 — Финальная проверка
**Описание:** полный `pnpm lint && pnpm typecheck && pnpm -r build && pnpm test`; ручная проверка UI по DESIGN_SYSTEM; проверка чистоты git; `docs/FINAL_REPORT.md`.
**Критерии:** DoD из IMPLEMENTATION_PLAN §6 выполнен.
