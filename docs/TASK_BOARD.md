# TASK_BOARD — FluxRadar v0.1

Статусы: `PENDING` → `IN PROGRESS` → `REVIEW` → `TESTING` → `DONE` (или `BLOCKED`).
Детали задач — ниже таблицы. Отчёты: `docs/REVIEW_<ID>.md`, `docs/TEST_<ID>.md`.

| ID | Задача | Зависимости | Агент | Статус | Изменённые файлы | Ревью | Тесты | Комментарии |
|---|---|---|---|---|---|---|---|---|
| T-01 | Скелет монорепо (pnpm, TS, Vitest, lint) | — | impl-агент | DONE | корень, packages/*, apps/* | ✅ approved-with-fixes | ✅ pass | TS 6.0, Vite 8, React 19 |
| T-02 | contracts: типы, enums, тарифы, реестр rules-mvp-0.1 | T-01 | impl-агент | DONE | packages/contracts | ✅ approved (2 фикса) | ✅ pass | реестр = 42 правила (D-107), не 37 |
| T-03 | fingerprint: URL-нормализация v1 + fingerprint-v1 | T-02 | impl-агент | DONE | packages/fingerprint | ✅ approved (1 фикс, D-118) | ✅ pass | golden vectors 6/6 ✅, независимый пересчёт ✅ |
| T-04 | scoring: score engine §15 | T-02, T-03 | impl-агент | DONE | packages/scoring | ✅ approved (0 фиксов, пересчёт 3 сценариев ✅) | ✅ pass | golden 96.50 ✅ (61 тест) |
| T-05 | safe-fetch: SSRF-guard fetch-слой | T-02 | impl-агент | DONE | packages/safe-fetch | ✅ approved-with-fixes (H-1: NAT64 local-use 64:ff9b:1::/96; M-1: 6to4 2002::/16 — исправлены) | ✅ pass (тест-агент) | IP-pin через lookup-callback (D-125); +16 тестов SSRF-векторов |
| T-06 | БД/биллинг: Prisma-схема, state machine, MockPaddle | T-02 | impl-агент | DONE | apps/api (prisma, billing) | ✅ approved-with-fixes (H-1: refunded-webhook был без тестов → +5 тестов монотонности; L-1: индекс Issue(scanId,fingerprint); L-2: хардкоды test-db) | ✅ pass | BILLING-001..006 ✅ 32 теста; Prisma 6.19 (D-130) |
| T-07 | crawler: scope, robots, dedup, лимиты + fixture-сайт | T-03, T-05 | impl-агент | DONE | packages/crawler (+fixtures) | ✅ approved-with-fixes (H-1: redirect на чужой origin оставался источником ссылок; M-1: scope child-sitemap; M-2: urlVariants для SEO-TECH-007; M-3: per-host robots.txt; M-4: суммарный sitemap-лимит — исправлены) | ✅ pass | 17 страниц (≥15 ✅); robots /private/secret.html ✅; нет utm_ ✅; 2 прогона идентичны ✅; 33 теста ✅ |
| T-08 | rules: движок + SEO-правила (13) | T-02, T-03, T-07 | impl-агент | DONE | packages/rules | ✅ approved-with-fixes (H-1: TECH-013 FP на protocol-relative `//host` при http-странице; M-1: совместимость IssueCandidate↔ScoredFinding не проверялась импортом scoring; M-2: normalized*-поля finding не проходили normalizeField; L-1: кэш pageLinks — исправлены, D-157) | ✅ pass | 29 fx-фикстур, 53 теста, интеграция с fixture-сайтом; smoke: 34 findings, fingerprints уникальны, 2 прогона идентичны |
| T-09 | rules: passive-модули (SEC/REL/A11Y/CONTENT/PRIVACY, 14) | T-08 | impl-агент | DONE | packages/rules (+30 fx-фикстур) | ✅ approved-with-fixes (H-1: PRIVACY-003 FP на собственных поддоменах — поддоменная цепочка теперь first-party; L-1: PRIVACY-001 матчил `document.cookie ===` как присваивание — исправлены, D-170) | ✅ pass | 14 правил в 5 модулях; движок: ApiRule/apiChecks (§9), evidenceGroupId (§14, D-167); 109 тестов ✅, интеграция 5 модулей с fixture-сайтом ✅; smoke: Security 17 findings, Privacy 3 findings (/trackers.html ✅), Content Quality /empty.html ✅, Accessibility /form.html ✅, fingerprints уникальны; HSTS — юниты на https-моках (http-сайт → N/A, D-162); решения D-160..D-170 |
| T-10 | ai: adapter-контракт, MockAiProvider, caps/quota/consent | T-02, T-06 | impl-агент | DONE | packages/ai (src: types/errors/consent/quota/redaction/prompt-builder/request-key + response-contract, mock-provider, run-request, geo-findings, geo-rules, geo-module, index; testing/harness) | ✅ approved-with-fixes (H-1: GEO-VIS-004 FP на подстроке домена в чужом hostname — граничный матчинг, D-178; M-1: redaction-маркеры выталкивали prompt за input cap → re-cap после redaction, D-177; 6 low accepted, трактовки в D-179; +5 тестов → 100) | ✅ pass (100 юнитов ai, 519 workspace; смоук 4/4: consent→Completed+5 GEO-правил+детерминизм, no-consent→Unavailable/квота 0, quota-limit→Partial+QuotaExceeded, redaction email/JWT → [REDACTED:*]; TEST_T-10.md) | GEO-правила ×5 (informational, severity null, score_delta 0 — D-109); MockAiProvider OpenAI-shaped (D-172/D-173); pipeline consent→prompt→redaction→re-cap→quota→send→commit (D-175/D-177); фасад runGeoModule для T-12 (D-174); 100 тестов ✅; решения D-171..D-179 |
| T-11 | export: records, JSON Schema, semantic validator, CSV | T-02, T-03, T-04 | impl-агент | DONE | packages/export (src: errors/fields/schema/schema-validator/builder-inputs/builder-guards/builders/semantic-validator/semantic-aggregation/validate/csv/econ/econ-cli/index + testing/fixtures + 7 тестов; fixtures/econ ×2; package.json: ajv 8.20 + ajv-formats, bin econ-validate); pnpm-lock.yaml | ✅ approved-with-fixes (H-1: econ-validate через bin-шим pnpm (symlink) молча выходил с кодом 0 при любом входе — ложный PASS economics gate → realpath-сравнение, D-188; L-1: +негативная проба D-019 на semantic-уровне; 4 low accepted, D-189; схема §16 и канонический пример сверены с планом программным deep-diff-ом — идентичны; ECON-001 пересчитан вручную: margin $27.50/$60/$34, break-even 49, стресс-кейс = floor 45 ✅; REVIEW_T-11.md) | ✅ pass (85 юнитов export, 603 workspace; lint/typecheck/build ✅; смоук 4/4: builders→validate→CSV на маленьком скане — header 56 колонок, LF/no-BOM, null→пустое, сортировка summary→module→issue; порча score_delta → semantic reject EXPORT-001/7, строка вместо числа → schema reject; `=SUM(A1,A9)` → `"'=SUM(…)"`; econ-validate из dist exit 0/1/2 + symlink-прогон D-188 exit 0/1 ✅; TEST_T-11.md) | Схема §16 дословно (ajv 2020-12); канонический пример проходит schema+semantic ✅; билдеры D-014 (56 полей явно), fingerprint/score_delta по построению; semantic — инварианты 1–9 + usage-часть 10 + penalty-пересчёт через computeModuleScore (D-119), негативные пробы по каждому инварианту ✅; CSV снапшот байт-в-байт (LF, без BOM), формула-экранирование `= + - @` ✅, zero-issue → summary-строка ✅; ECON-001: floor 45, reserve floor, break-even 49 на fx-фикстуре, reserve ниже floor → fail ✅; CLI exit 0/1/2 ✅ (и через symlink после D-188); 85 тестов, workspace 603 ✅; решения D-180..D-189 |
| T-12 | api: auth, профили, scans, orchestrator/worker, issues, export API | T-04–T-11 | Codex | DONE | `apps/api/src/{auth,billing-http,export,http,issues,orchestrator,profiles,scans}`, `apps/api/src/{data-retention.ts,index.ts}`, Prisma schema | ✅ approved + follow-up fixes | ✅ 42 API tests | `REVIEW_T-12.md`, `TEST_T-12.md`; atomic Free claim, tenant scope, active entitlement/module retry gate, retention/account deletion, Disputed |
| T-13 | web: дизайн-система (токены + компоненты) | T-01 | Codex | DONE | `apps/web/src/components.tsx`, `apps/web/src/styles/*` | ✅ approved | ✅ build + manual styleguide | `REVIEW_T-13.md`, `TEST_T-13.md`; styleguide loaded at `#styleguide` |
| T-14 | web: экраны (auth, профили, checkout, скан, дашборд, issues, export) | T-12, T-13 | Codex | DONE | `apps/web/src/App.tsx`, `apps/web/src/api.ts` | ✅ approved | ✅ build + API-backed screen paths | `REVIEW_T-14.md`, `TEST_T-14.md`; Free/Basic/Complete gates rendered |
| T-15 | integration: pipeline на fixture-сайте, webhook-идемпотентность, гейтирование | T-12 | Codex | DONE | `apps/api/src/api.integration.test.ts`, `apps/api/src/orchestrator/issue-sync.test.ts` | ✅ approved + follow-up fixes | ✅ 5 API integration scenarios + lifecycle | `REVIEW_T-15.md`, `TEST_T-15.md`; Complete export, Basic denial/history gate, refund/Disputed, Resolved/Reopened |
| T-16 | Финальная проверка + FINAL_REPORT | все | Codex | DONE | `docs/FINAL_REPORT.md`, `docs/DECISIONS.md`, `docs/TASK_BOARD.md` | ✅ approved + follow-up fixes | ✅ full workspace suite + full gates | `FINAL_REPORT.md`; lint/typecheck/build/test green |
| T-17 | Accessibility: WCAG 2.2 AA automated audit | T-09, T-12, T-14 | Codex + Opus review | DONE | `packages/contracts`, `packages/rules/src/accessibility`, `apps/web`, `docs/WCAG_AUDIT.md` | ✅ independent Opus review; static/manual boundary documented | ✅ A11Y rules + integration + full workspace gates | A11Y-001..011; no legal-conformance claim; browser-rendered checks remain follow-up |
| T-18 | Public-only discovery/security/privacy profiles | T-08, T-09, T-10, T-17 | Codex | DONE | `packages/contracts`, `packages/rules`, `apps/api`, `apps/web`, docs | ✅ no customer tokens; static limitations documented | ✅ unit/integration coverage + workspace gates | JSON-LD/social preview; OWASP ASVS Public Profile; Privacy & Consent; EN/Section mappings; AI crawler readiness |

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
**Описание:** Prisma (PostgreSQL): Account, Session, SiteProfile, Purchase (unique paddle_transaction_id), Entitlement (unique purchase_id), Scan (unique purchase_id; статусы; retry-счётчики), ScanModule, Issue, AiResponseRecord, WebhookEvent (unique paddle_event_id), RefundRecord (unique purchase_id), Job. Сервисы: webhook-handler MockPaddle (HMAC-SHA256 по raw body, D-029) в одной транзакции; state machine переходов §18 через conditional update; refund flow (`refund:{purchase_id}`, reason enum); dev-checkout endpoint-хелпер, эмитящий подписанный webhook.
**Критерии:** тесты BILLING-001..006: невалидная подпись reject; дубль event → один entitlement/scan; out-of-order не откатывает состояние; запрещённые переходы отвергаются; retry-счётчики ≤ 1; один refund на purchase; NoUsableOutput-ветка (D-026/D-027).
**Проверка:** `pnpm --filter api test -- billing`. **Риски:** транзакции PostgreSQL — использовать `prisma.$transaction`.

### T-07 — crawler
**Описание:** обход в пределах scope (домен/поддомены по флагу, include/exclude-шаблоны, глубина, лимит страниц тарифа), robots.txt по умолчанию (+ логируемый override), sitemap.xml как источник, dedup по нормализованному URL, учёт пропущенных сверх лимита, сбор PageSnapshot (status, headers, redirect chain, HTML, timing). Fixture-сайт: локальный static-сервер из `fixtures/site` (~12 страниц: валидная, без title, чужой canonical, 404, redirect chain, noindex, дубликат, пустая, broken image, mixed content, форма без labels, страница с trackers).
**Критерии:** integration-тест обхода fixture-сайта: точный список URL, соблюдение robots/лимитов, дедуп.
**Проверка:** `pnpm --filter crawler test`. **Риски:** нестабильность парсинга HTML — использовать `node-html-parser` или `cheerio`.

### T-08 — rules: движок + SEO
**Описание:** rule engine: `Rule = (ctx: SiteContext, page?: PageSnapshot) => Finding[]`; учёт applicable/affected targets; сборка Issue с fingerprint (T-03), evidence (http/dom excerpt ≤ 2048), confidence, severity из реестра. Реализация SEO-TECH-001..008,013, SEO-ONPAGE-001,002,003,005, structured-data и social-preview checks. Фикстуры `fx-<rule_id>-{positive,negative}` (+boundary где есть порог).
**Критерии:** все фикстуры зелёные; на fixture-сайте — ожидаемый набор findings с ожидаемыми fingerprint.
**Проверка:** `pnpm --filter rules test`. **Риски:** трактовки правил — фиксировать оракул в комментарии к правилу.

### T-09 — rules: passive-модули
**Описание:** SEC-PASSIVE-002,003,005 + OWASP ASVS public checks SEC-ASVS-001..003; REL-URL-001,003,009 + REL-API-003,005 (expected-status precedence §9, verdict pass/warning/fail, D-023); A11Y-002,004; CONTENT-003 (порог 200 видимых символов),004; PRIVACY-001..004. Public AI crawler readiness и профили EN 301 549/Section 508 фиксируются в T-18. Фикстуры по D-025.
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

### T-17 — Accessibility: WCAG 2.2 AA automated audit
**Описание:** расширить Accessibility до закрытого inventory `A11Y-001..011`: контраст, alt, язык/заголовки, формы, клавиатурные риски, focus, ARIA, accessible names, ошибки форм, landmarks/media и прозрачность отчёта. Все статические проверки должны иметь точное DOM/CSS evidence; runtime-поведение, computed layout и assistive-technology output явно остаются `Needs manual review`.
**Критерии:** каждый rule ID присутствует в contracts и executable registry; positive/negative тесты проходят; Complete dashboard показывает WCAG 2.2 AA scope и disclaimer; score/fingerprint/export contracts не ломаются.
**Проверка:** `pnpm --filter @fluxradar/contracts build`, `pnpm --filter @fluxradar/rules test`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm -r build`; независимый Opus review.
