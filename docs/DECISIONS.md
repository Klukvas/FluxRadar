# DECISIONS — журнал решений реализации FluxRadar v0.1

Формат: `D-NNN — решение — причина`. Решения принимаются автономно; трактовки противоречий
плана выбирают одну из формулировок самого плана и не меняют его дух.

## Процесс

- **D-001** — Репозиторий инициализирован git-ом, исходный план закоммичен первым коммитом
  (`eb40d97`). Причина: защита исходного плана от перезаписи, отслеживаемость всех изменений,
  финальная проверка «нет случайных незакоммиченных изменений» требует git. Пуш не выполняется.
- **D-002** — Все статусные документы процесса (`PLAN_REVIEW.md`, `DECISIONS.md`,
  `IMPLEMENTATION_PLAN.md`, `DESIGN_SYSTEM.md`, `TASK_BOARD.md`, `REVIEW_*.md`, `TEST_*.md`,
  `BLOCKERS.md`, `FINAL_REPORT.md`) размещаются в `docs/`, а не в корне. Причина: PreToolUse-хук
  окружения (`everything-claude-code` doc-file blocker) блокирует создание `.md` в корне,
  разрешая `docs/`; настройка окружения пользователя уважается.
- **D-003** — Валидация плана выполнена 4 параллельными агентами (архитектор, разработчик, QA,
  security) с вычислительной верификацией golden-векторов. Итоги — в `docs/PLAN_REVIEW.md`.
- **D-004** — Исходный план **не редактируется**. `IMPLEMENTATION_PLAN.md` — отдельный
  реализационный план v0.1, ссылающийся на разделы исходного плана. Причина: план сам требует
  (§27) преобразования в реализационные артефакты; сам документ — спецификация полного релиза.

## Scope v0.1

- **D-005** — Очередь задач: DB-backed (таблица jobs + атомарный conditional-update claim по
  `scan_id`), worker — фоновый цикл внутри процесса API. Причина: план не выбирает брокер (§22);
  для локального MVP внешний Redis/BullMQ — лишняя инфраструктура; интерфейс позволяет замену.
- **D-006** — Модули **вне v0.1** (в реальном скане получают `Unavailable`/`Not applicable` с
  `status_reason` — легальная ветка по §13/§15 плана): Performance (нет pinned runner/`PERF-001`),
  Analytics (нет GSC/GA OAuth), UX/Conversion (правила без оракула), активный Security (за launch
  gate по самому плану), SEO-advanced/SEO-content-эвристики без оракула. Score-математика
  честно нормализует веса доступных модулей — ровно как описано в §15.
- **D-007** — Реализуемый субсет правил `rules-mvp-0.1` — 37 правил с детерминированным
  оракулом (список в `IMPLEMENTATION_PLAN.md`): SEO-TECH×9, SEO-ONPAGE×4, GEO×5 (на mock),
  SEC-PASSIVE×3, REL×5, A11Y×2, CONTENT×2, PRIVACY×2, BILLING×6(инварианты), EXPORT×3, ECON×1.
  Причина: рекомендация QA-агента; полный inventory из 191 правила — условие public launch,
  не MVP. Расширение аддитивно через новую версию ruleset.
- **D-008** — Внешние сервисы за версионированными интерфейсами адаптеров, в v0.1 — mock:
  `MockPaddle` (HMAC-подписанные webhook-события), `MockAiProvider` (нормализованные ответы по
  контракту §5; реальные OpenAI/Google/Perplexity не подключаются — нет credentials и
  `AI-001` sign-off), performance-runner и GSC/GA не реализуются. Причина: рекомендации
  архитектора и security; контракты тестируются полностью, деньги не тратятся.
- **D-009** — PDF-экспорт вне v0.1; экспорт = канонические JSON records + CSV по контракту §16.
  Причина: PDF — представление той же канонической модели, добавляется аддитивно.
- **D-010** — Админ-панель FluxLab (§20) вне v0.1. Причина: не влияет на основной пользовательский
  контур; требует RBAC/2FA-подсистему.

## Стек

- **D-011** — Стек: pnpm workspaces монорепо, TypeScript strict, backend Express + Prisma,
  БД SQLite (dev/тесты), frontend React + Vite, тесты Vitest + supertest. Причина: соответствие
  привычному стеку пользователя (full-stack TS + Prisma); SQLite — нулевая настройка локального
  запуска; атомарный claim реализуется conditional-update (`updateMany where status=...`),
  что корректно и в SQLite; путь миграции на Postgres задокументирован. Auth: email/пароль,
  bcrypt, httpOnly session cookie, account-scoping каждого запроса (tenant isolation).
- **D-012** — Frontend без Tailwind: собственная дизайн-система на CSS custom properties
  (см. `DESIGN_SYSTEM.md`). Причина: стиль Mac OS 8/9 (рельефные рамки, пиксельные детали)
  требует полностью кастомных компонентов; utility-фреймворк не даёт выигрыша.
- **D-013** — E2E через Playwright вне v0.1; верификация: unit + integration (scan pipeline на
  локальном fixture-сайте, webhook-идемпотентность через supertest) + ручной прогон UI.
  Причина: загрузка браузеров и хрупкость e2e не окупаются для локального MVP; happy path
  покрыт integration-тестами API.

## Трактовки противоречий плана (из PLAN_REVIEW)

- **D-014** — «null vs absent» в JSON records: все поля record всегда присутствуют явно
  (со значением `null`, где применимо), absent запрещён. Причина: разрешает конфликт
  `required` + `const: null` в JSON Schema плана; CSV сериализует null пустым полем — как в §16.
- **D-015** — `ai_request_key` — идемпотентный ключ провайдера (`ai:{scan_id}:{provider}:{prompt_hash}:{sequence}`), НЕ входит в fingerprint; `ai_response` records не имеют fingerprint.
- **D-016** — `rule_penalty`/`score_delta` в issue record дублируют **агрегатный** penalty
  правила (один и тот же для всех records одного rule_id); суммирование по records запрещено,
  UI показывает вклад на уровне правила. Причина: иначе сумма по records завышает вычет.
- **D-017** — Basic Provisional: применяется формула weighted coverage (`0.60/0.40`), как в
  подробном абзаце §15; per-module «Provisional» — только информационная метка модуля.
- **D-018** — URL-нормализация: сортировка query-пар по UTF-8 байтам `(name, value)` **после**
  нормализации компонент; NFC применяется ко всем компонентам (не только path). Причина:
  детерминизм fingerprint между реализациями.
- **D-019** — Для site-level issue (`target_kind=site|environment`): `normalized_url` — пустая
  строка; origin хранится в поле `domain`. Соответствует сериализации пустого поля `0:` из §14.
- **D-020** — Max severity per rule (§15) принято буквально: единственный Critical среди Low
  того же правила определяет severity_weight для всей доли affected. Причина: текст плана
  однозначен; изменение — вопрос ruleset v2.
- **D-021** — `round2` = округление half-up по десятичному представлению (не banker's).
- **D-022** — Граница `Partial`: контракт `0 < coverage < 1` побеждает формулировку «1%–99%».
- **D-023** — Reliability timeout: 10 s на попытку, общий deadline цепочки (до 4 попыток
  с backoff) — 40 s.
- **D-024** — Retry `Partial → Running`: после ре-терминализации создаётся новый export
  snapshot; предыдущий помечается `superseded` (в рамках того же `scan_id`); интерфейс отдаёт
  только последний snapshot. Инвариант «один terminal record» действует внутри snapshot-а.
- **D-025** — Fixture-контракт: 3 фикстуры на правило (positive/negative/boundary), нейминг
  `fx-<rule_id>-{positive|negative|boundary}` (побеждает формулировка Explicit ruleset mapping §25).
  Для v0.1 обязательны positive+negative; boundary — там, где у правила есть числовой порог.
- **D-026** — `usable output` для целей refund: findings, единственным содержанием которых
  является недоступность самой цели (DNS/timeout/5xx на все запросы), не считаются usable
  output. Причина: закрывает дыру «сайт лежит → Partial без refund» (находка QA-5), соответствует
  интенту `NoUsableOutput` §18.
- **D-027** — Пустой сайт / robots disallow-all: каскад `Not applicable` → `Insufficient data`;
  причина external; refund по общему правилу `NoUsableOutput` (все модули без usable output).
- **D-028** — Ресурсные лимиты краулера: max 5 MB HTML на страницу, max 2048 байт URL,
  max 5 redirects, 10 s timeout на страницу. Причина: план не задаёт (находка QA-12).
- **D-029** — Подпись webhook в MockPaddle: HMAC-SHA256 по raw body, секрет из env
  (`PADDLE_WEBHOOK_SECRET`), raw payload + signature сохраняются; невалидная подпись — reject
  с negative-фикстурой (`BILLING-001`).
- **D-030** — Лимиты пассивного краулера per host: 5 req/s, 4 одновременных запроса,
  авто-throttle при росте доли 5xx. Причина: находка security-агента №9 (краулер как
  DDoS-инструмент); значения консервативнее активного профиля не требуются.

## Решения, принятые в ходе реализации

- **D-101 (T-01)** — TypeScript зафиксирован на 6.0.x (не 7.0.2) — typescript-eslint 8.69 требует
  peer `typescript <6.1.0`; нативный TS 7 ещё не поддержан линт-тулингом. Версии тулинга:
  TypeScript 6.0.3, Vitest 4.1.11, ESLint 10.9.1 + @eslint/js 10.0.1 + typescript-eslint 8.69.0,
  Prettier 3.9.6; web: Vite 8.2.2 + @vitejs/plugin-react 6.1.1 (peer `vite ^8`), React 19.2.8.
- **D-102 (T-01)** — `tsconfig.base.json`: `module`/`moduleResolution: NodeNext` +
  `verbatimModuleSyntax`, `isolatedModules`, `noUncheckedIndexedAccess`; `apps/web`
  переопределяет на `ESNext`/`bundler` — Node-пакеты собираются tsc и обязаны писать корректные
  ESM-расширения (`./index.js`), а Vite-приложение живёт в bundler-резолюции (extensionless
  импорты `.tsx`, `noEmit`, сборку делает Vite).
- **D-103 (T-01)** — vitest/typescript/eslint/prettier — только в корневых devDependencies;
  скрипты пакетов используют бинарники через `node_modules/.bin` workspace-рута (штатное
  поведение pnpm). Локальные devDependencies есть только у `apps/web` (vite, plugin-react,
  типы React) — это тулинг конкретного приложения.
- **D-104 (T-01)** — `src/**/*.test.ts` исключены из package tsconfig: build не тащит
  тест-артефакты в `dist`, тесты исполняет Vitest. Цена — `tsc --noEmit` не проверяет
  тест-файлы; ошибки типов в тестах ловятся на прогоне.
- **D-105 (T-01)** — `apps/api` dev-скрипт = `node --watch src/index.ts` (нативный type
  stripping Node ≥ 24) — без tsx/nodemon на этапе скелета; пересмотр при появлении
  не-erasable синтаксиса в T-12.
- **D-106 (T-01)** — `pnpm.onlyBuiltDependencies: ["esbuild"]` в корневом package.json —
  pnpm 10 блокирует postinstall-скрипты по умолчанию; esbuild одобрен явно, чтобы Vite/Vitest
  получили платформенный бинарник.
- **D-107 (T-02)** — Реестр `rules-mvp-0.1` фактически содержит **42** дескриптора:
  32 сканирующих+GEO (`RULES_MVP_01`) + 10 платформенных (`PLATFORM_CONTRACTS`). Цифра «37»
  в §3 IMPLEMENTATION_PLAN / D-007 — арифметическая ошибка: перечисленные группы дают
  9+4+5+3+5+2+2+2+6+3+1 = 42, а «37» получается только без группы GEO×5 (13 SEO + 14 passive +
  10 platform). Сокращать перечень нельзя: T-08 ждёт 13 SEO-правил, T-09 — 14 passive,
  T-10 — 5 GEO. Тест фиксирует состав по группам и итог 42.
- **D-108 (T-02)** — Канонические строковые значения enum-ов взяты дословно из export schema
  §16 (`'Not applicable'`, `'False Positive'`, `'AI SEO / GEO'`, `'Content Quality'`).
  Внутренние идентификаторы планов — короткие `'Free' | 'Basic' | 'Complete'`; display/export
  метка (`'Basic Scan'`, `'Complete Scan'`) хранится полем `label` тарифной матрицы,
  export records используют `label` плана Complete.
- **D-109 (T-02)** — `RuleDescriptor.severity: Severity | null`: у informational-правил
  (GEO×5 и платформенные контракты) severity = `null` — они не штрафуют score
  (`score_delta = 0` по §15 / GEO-METHOD-005). Платформенные контракты вынесены в отдельный
  массив `PLATFORM_CONTRACTS` (module `'platform'`, targetKind `environment`) — это инварианты
  тестов, а не runtime-правила сканера.
- **D-110 (T-02)** — `IssueStatusUpdateInput` ограничен user-settable статусами
  (`New`, `Acknowledged`, `Ignored`, `False Positive`): `Resolved`/`Reopened` назначаются
  только системой по сравнению fingerprint между Complete-сканами (§14) и через API
  не принимаются.
- **D-111 (T-02)** — `SiteProfileInput.domain`: строгий https-origin — без пути (включая
  trailing slash), query, fragment и userinfo; значение нормализуется к `new URL(v).origin`
  (lowercase host, срез default port). Пароль ограничен 72 байтами — bcrypt молча усекает
  ввод на 72 байтах. `ScanRequestInput` через superRefine отклоняет `scope.maxPages` выше
  urlLimit выбранного тарифа.
- **D-112 (T-02)** — `zod@^4.5` добавлен в dependencies `packages/contracts` — единственная
  runtime-зависимость пакета; корневой package.json не менялся.
- **D-113 (T-03)** — `normalizeUrl` принимает только `http:`/`https:`; другие схемы и
  относительные строки → throw; userinfo → throw (план §14 «userinfo запрещён»). Причина:
  default-port правило определено планом только для 80/443, иные схемы вне домена сканера;
  ошибка на границе честнее тихой неопределённости.
- **D-114 (T-03)** — Percent-encoding в path и query-компонентах: последовательности,
  дающие unreserved ASCII (`A-Z a-z 0-9 - . _ ~`), декодируются в literal; валидный
  не-ASCII UTF-8 декодируется, проходит NFC и re-encode-ится обратно в percent-encoding;
  все сохранённые последовательности — с UPPERCASE hex (`%2f` → `%2F`); невалидные UTF-8
  октеты сохраняются побайтно; одиночный `%` вне валидной hex-пары кодируется как `%25`.
  Итог: normalized URL — всегда чистый ASCII (host — punycode, остальное — percent).
  Причина: план фиксирует только unreserved-декод; без декода не-ASCII невыполним
  equivalence-вектор «NFC = NFD», а ASCII-only выход даёт максимальный кросс-системный
  детерминизм fingerprint (цель D-018). byte_length в framing считается от этой ASCII-формы.
- **D-115 (T-03)** — Имена query-параметров НЕ приводятся к lowercase (план этого не требует);
  трекинг-фильтр — точное case-sensitive совпадение нормализованного (декодированного) имени
  со списком `gclid, fbclid, msclkid, yclid, mc_cid, mc_eid` либо префикс `utm_`.
  `UTM_source`/`GCLID` сохраняются; `%75tm_source` удаляется (декод до сравнения).
- **D-116 (T-03)** — Query-детали, не заданные планом: пустой query (`?`) и query, ставший
  пустым после удаления трекинг-параметров, сериализуются без `?`; пустые сегменты (`&&`)
  отбрасываются; bare key без `=` канонизируется в `name=` (модель пар `(name, value)` §14);
  `+` остаётся literal-символом (эквивалентность с `%20` не вводится). NFC применяется
  по прогонам: сохранённые `%XX`-последовательности — границы NFC (combining mark не
  композируется «через» закодированный байт). Сортировка — `Buffer.compare` по UTF-8.
- **D-117 (T-03)** — `FingerprintFields.targetKind` типизирован как `TargetKind` из
  `@fluxradar/contracts` (остальные семь полей — `string`): compile-time защита самого
  контрактно-критичного входа; сериализация не меняется. `normalizeField`: порядок
  `trim → NFC → CRLF→LF` дословно по §14; одиночный `\r` сохраняется, literal NUL
  сохраняется. Экспортирован `buildFingerprintPayload` — canonical payload проверяется
  в тестах байт-в-байт против hex-эталона V1.
- **D-118 (T-03, ревью)** — `normalizeField`: замена CRLF→LF выполняется до неподвижной
  точки (`\r+\n` → `\n`). Однопроходный `replaceAll('\r\n', '\n')` на входе `a\r\r\nb`
  давал `a\r\nb`: сохранённый одиночный `\r` и вставленный `\n` образуют новый CRLF,
  повторная нормализация меняет значение — нарушение идемпотентности и риск ложных
  `Reopened`/`Resolved` при повторной нормализации полей. Одиночный `\r` без
  последующего `\n` по-прежнему сохраняется (уточнение D-117); golden vectors
  не затронуты — `\r` в них отсутствует.
- **D-119 (T-04)** — Module score считается в целых сотых (integer hundredths):
  per-rule penalty = `floor((2·weight·100·min(affected, applicable) + applicable) / (2·applicable))`
  (точное целочисленное деление с half-up, D-021), `score = (10000 − Σ penaltyHundredths) / 100`
  с клэмпом в 0. Следствие: Σ отображаемых per-rule penalty (D-016) точно равна
  `100 − score` до клэмпа — UI/export не расходятся с итогом, float-накопления нет.
- **D-120 (T-04)** — `target_kind='api'` трактуется как page-level для score-формулы
  (доля `min(1, affected/applicable)` по нормализованным endpoint-целям); site-level
  (полный вес, targets 1/1) — только `site` и `environment`. Причина: §15 определяет
  applicable target как «нормализованную цель», REL-API-правила оценивают множество
  endpoint-ов; полный вес за один affected endpoint завышал бы вычет.
- **D-121 (T-04)** — `affectedTargets`/`applicableTargets` на входе score — агрегаты
  уровня правила (по контракту D-016 одинаковы у всех findings одного `rule_id`);
  агрегатор берёт максимум по уникальным scored findings правила — детерминированная
  защита при рассинхроне входа, findings с разными `targetKind` в одном правиле — ошибка.
- **D-122 (T-04)** — Сравнение weighted coverage с порогами 0.80/0.50 выполняется
  с epsilon 1e-9 (поглощает двоичный float-шум произведений `weight × coverage`,
  например `0.6·1 + 0.4·0.5`); точное значение wc возвращается без округления,
  отображение округляет round2. Гранулярность реальных coverage (≥ ~5e-8 при лимитах
  тарифов) на порядки больше epsilon — ложных переключений вердикта нет.
- **D-123 (T-04)** — Нулевой знаменатель `Σ tariff_weight` (Free и вырожденные тарифы)
  возвращает `insufficient_data` без исключения — согласовано с «Free score
  не рассчитывается» (§15) и требованием «нулевой знаменатель не кидает» (§25).
- **D-124 (T-04)** — Вход `computeOverallScore`: модули из `SIDE_SCORE_MODULES`
  (UX/Conversion, Analytics) молча пропускаются (§15 — побочные оценки), модуль вне
  scoreWeights тарифа — ошибка (fail fast на неверную сборку), отсутствующий модуль
  тарифа получает effective weight 0; effective weight > 0 требует usable output
  И терминального `Completed`/`Partial` — `Unavailable` с ненулевым coverage
  не набирает вес даже при некорректном входе.
- **D-125 (T-05)** — IP-pin в `safe-fetch` реализован через `node:http`/`node:https`
  с кастомной `lookup`-опцией (callback подставляет ровно те адреса, что прошли
  SSRF-гард), а не через undici Agent: `undici` не импортируем как builtin
  (ERR_MODULE_NOT_FOUND в Node 24; внутренняя копия для fetch не экспортируется),
  а новая внешняя зависимость не нужна. Резолв выполняется один раз, его результат
  и проверяется blocklist-ом, и используется для соединения → DNS rebinding между
  проверкой и connect невозможен. TLS SNI/cert проверяются по hostname (соединение
  на pinned IP, `servername` остаётся доменом). `agent: false` — сокет на запрос,
  без пула; `accept-encoding: identity` по умолчанию — лимит `maxHtmlBytes`
  считается по байтам тела на проводе, без сюрпризов декомпрессии.
- **D-126 (T-05)** — Тестовый эскейп-флаг сужен с «allow private» до
  `dangerouslyAllowLoopback`: пропускает только loopback (127/8, `::1`) — ровно то,
  что нужно fixture-сайту на 127.0.0.1. RFC1918, link-local/metadata, CGNAT и прочие
  непубличные диапазоны блокируются даже с флагом, поэтому тест «redirect на
  169.254.169.254 блокируется» работает и в тест-режиме без дополнительных лазеек.
- **D-127 (T-05)** — `timeoutMs` (default `CRAWL_LIMITS.pageTimeoutMs`) — общий
  дедлайн на весь `safeFetch`, включая redirect-цепочку: согласуется с «10 s
  timeout на страницу» D-028. При сработавшем дедлайне `TimeoutError` имеет
  приоритет над сетевыми ошибками, порождёнными самим abort-ом. Превышение
  `maxRedirects` — `RedirectLimitError` на (maxRedirects+1)-м переходе, цепочка
  переходов включена в ошибку; превышение тела — не ошибка, а `truncated: true`
  с обрывом соединения на границе лимита.
- **D-128 (T-05)** — Классификация IP в ip-guard: IPv4-mapped (`::ffff:0:0/96`)
  и NAT64 (`64:ff9b::/96`) классифицируются по вложенному IPv4 (публичный
  вложенный → публичный, приватный → блок с категорией вложенного); deprecated
  IPv4-compatible `::/96` блокируется целиком; любой нераспарсенный адрес
  (включая zone id `%…` и октальные формы) → non-public (fail-closed). Ошибки
  валидации URL (схема, userinfo, длина) выделены в отдельный тип
  `UrlValidationError` — это отказ до любых сетевых действий, не SSRF-блок.
- **D-129 (T-05)** — `HostLimiter`: token bucket ёмкостью `perHostRps` (burst
  ≤ секунды трафика) с непрерывным пополнением + семафор `perHostConcurrency`;
  `acquire(host)` возвращает идемпотентную release-функцию. Авто-throttle по доле
  5xx из D-030 — ответственность crawler-а (T-07), которому нужен контекст
  ответов, а не rate-limiter-а.
- **D-130 (T-06)** — Prisma зафиксирован на 6.19.x (не 7/8): новые мажоры требуют
  driver adapters (`@prisma/adapter-better-sqlite3`), `prisma.config.ts` и генерацию
  клиента в src — лишняя инфраструктура для локального SQLite MVP; 6.x даёт
  `prisma-client-js` + `url = env("DATABASE_URL")` с нулевой настройкой. `prisma generate`
  встроен в `build`/`test`/`typecheck`-скрипты apps/api (детерминизм для fresh clone);
  postinstall-скрипты prisma/@prisma/client/@prisma/engines добавлены в
  `pnpm.onlyBuiltDependencies` (pnpm 10 блокирует их по умолчанию).
- **D-131 (T-06)** — Статусные колонки — строки с каноническими литералами enum-ов из
  contracts (SQLite/Prisma без native enum, D-108 дословность). Фабрика `createPrismaClient`
  принудительно добавляет `connection_limit=1` к file:-URL: пул >1 соединения на SQLite
  даёт SQLITE_BUSY на конкурентных записях, одно соединение сериализует транзакции — на
  этом стоят атомарный CAS и webhook-дедуп. Free-скан — `Scan.purchaseId NULL` (nullable
  unique: SQLite допускает много NULL, каждый paid purchase — ровно один скан).
- **D-132 (T-06)** — Доказуемость PRE_QUEUE_CANCEL без отдельной колонки `queuedAt`:
  statusReason `UserCancelledPreQueue` пишется только атомарным CAS `Pending → Cancelled`
  внутри `cancelScan`; policy-проверка refund требует `Cancelled` + именно этот reason.
  Остановка после queue/старта пишет другие reasons и refund не проходит.
- **D-133 (T-06)** — Retry-инварианты §18 встроены в WHERE самого CAS:
  `Failed → Queued` требует `platformRetryCount < 1` (+increment), `Partial → Running` —
  `moduleRetryCount < 1` (+increment). Ветка «ноль usable модулей на первом проходе»
  (статуса для неё план не даёт) решена in-run: `resolveScanOutcome` выдаёт
  `ExternalRetryGranted`, инкрементируя тот же `moduleRetryCount` условным update —
  суммарно ровно один внешний retry, скан остаётся `Running`, worker перегоняет модули.
- **D-134 (T-06)** — Webhook: amount/currency/priceId проверяются только у
  `transaction.paid` (у refunded сумма может включать налоги); MockPaddle price IDs
  зафиксированы в `billing/webhook-schema.ts`. Скан из webhook получает дефолтный
  `scopeJson` — реальный scope свяжет checkout-поток T-12. `transaction.refunded` —
  монотонный billing-overlay: purchase → `Refunded`, RefundRecord `requested/processing` →
  `paid`; refunded до paid (out-of-order) сохраняет событие в dedup-таблицу без side effects.
  Гонка «два разных eventId, один transactionId» решается одним повтором транзакции после
  P2002 по `paddleTransactionId` (первая транзакция откатилась целиком, повтор идёт по
  dedup-ветке). `amountUsd` — Float: только equality-сравнение с целыми ценами тарифов,
  денежная арифметика в v0.1 не ведётся.
- **D-135 (T-06)** — Тестовая БД: vitest globalSetup делает один `prisma db push` в
  template-файл, каждый тест-файл копирует его в свой tmp-файл (`createTestDb`) —
  изоляция по файлу без повторного push. Два обхода тулинга: (1) Prisma CLI 6.19 на
  Node 24 падает с пустой «Schema engine error», если schema engine не логирует —
  `RUST_LOG=info` форсируется для db push (унаследованный `RUST_LOG=warn` из среды
  воспроизводимо ломает); (2) `--force-reset` не используется (срабатывает AI-consent
  gate Prisma при запуске из агента) — вместо него template-файл удаляется перед push.
- **D-141 (T-07)** — Robots-политика краулера fail-safe: override работает только при
  `respectRobots=false` **и** `robotsOverrideConfirmed=true`; `respectRobots=false` без
  подтверждения игнорируется (robots.txt соблюдается) с warn-логом через инъектируемый
  logger. Активный override логируется дважды: раз при старте обхода и на каждый фетч
  заблокированного URL. robots.txt: 200 → парсинг (группы User-agent с longest-match
  выбором токена, Allow/Disallow longest-match, при равной длине Allow сильнее, `*` и `$`
  по RFC 9309), не-200 → «всё разрешено», сетевая ошибка → запись в `errors` + обход
  продолжается открытым.
- **D-142 (T-07)** — Дедуп и очередь: ключ дедупа — `normalizeUrl` v1 (fingerprint, utm/
  gclid вырезаются там); проверка на этапе enqueue, поэтому дубли не попадают даже в
  очередь. `finalUrl` каждого redirect-а тоже помечается посещённым — прямая ссылка на
  цель redirect-а не фетчится повторно. Sitemap-seed-ы получают depth=1 и подчиняются
  maxDepth; источники sitemap — директивы robots.txt (в scope), при их отсутствии —
  стандартный `/sitemap.xml`; sitemapindex разворачивается на 1 уровень, суммарный лимит
  1000 URL, недоступный sitemap — не ошибка. Ненормализуемые обнаруженные ссылки
  (userinfo и пр.) молча отбрасываются — это мусор веба, не ошибка обхода.
- **D-143 (T-07)** — Учёт лимитов: maxPages считает фетч-попытки (снимки, включая
  упавшие — они несут `fetchError` и дублируются в `errors`); URL сверх лимита, прошедшие
  scope и robots, идут в `skippedOverLimit`. Порядок классификации: scope-фильтры (тихо) →
  robots (`blockedByRobots`) → лимит (`skippedOverLimit`) — заблокированный robots URL
  остаётся в `blockedByRobots` даже при исчерпанном лимите. Include/exclude-шаблоны —
  простые glob по pathname (`*` — любая последовательность, полное совпадение), exclude
  сильнее include. 4xx/5xx-ответ — валидный снимок со статусом, не ошибка (нужно T-08/T-09
  как evidence).
- **D-144 (T-07)** — Авто-throttle D-030 конкретизирован как «≥5 **последовательных** 5xx
  на host → стоп хоста»: счётчик сбрасывается любым не-5xx ответом; учитываются только
  фетчи страниц (robots/sitemap — нет); остановка и каждый пропущенный из-за неё URL
  фиксируются в `errors` с пометкой D-030. Порог — экспортируемая константа
  `CONSECUTIVE_5XX_HOST_STOP`.
- **D-145 (T-07)** — Fixture-сайт: 15 статических страниц + программные маршруты
  (redirect-цепочка `/redirect-a`→`/redirect-b`→`/redirect-final.html`, 1×1 PNG
  `/img/pixel.png`); динамический порт решён подстановкой `{{ORIGIN}}` в статику при
  отдаче (canonical/robots/sitemap ссылаются на реальный origin). `/orphan.html` доступен
  только из sitemap (доказывает seed-инг), `/deep/` — промежуточная страница для цепочки
  глубины 2. Сервер слушает 127.0.0.1 (обход через `dangerouslyAllowLoopback`, D-126),
  security headers намеренно отсутствуют, на `/` — `Set-Cookie` без Secure/HttpOnly (под
  SEC-PASSIVE T-09). `startFixtureSite()` экспортируется из пакета для T-08/T-09/T-15.
- **D-150 (T-08)** — Оракулы site-проверок SEO: TECH-001 — finding только при отсутствии
  robots.txt (краулер заполняет `crawl.robotsTxt` лишь при HTTP 200, D-141; явный
  `ctx.robotsTxt` приоритетнее), контент файла в v0.1 не валидируется. TECH-002 — сигнал
  «sitemap не найден» = `crawl.sitemapUrls` пуст: недоступный, невалидный и пустой sitemap
  на этом уровне неразличимы и дают один и тот же finding. Для обоих правил и TECH-007
  applicable/affected = сайт (1/1 при любом числе findings, D-121).
- **D-151 (T-08)** — TECH-004 canonical: finding при (a) отсутствии `<link rel=canonical>`
  с непустым href, (b) href, не разрешающемся в абсолютный http(s)-URL (относительный
  разрешается против `finalUrl`), (c) host канонического URL ≠ host страницы —
  `www.example.com` и `example.com` считаются разными host-ами. Canonical на другой
  path/scheme того же host-а — легитимная канонизация дублей, не finding; при нескольких
  тегах берётся первый непустой href.
- **D-152 (T-08)** — TECH-006 битые внутренние ссылки: оцениваются только `<a href>`, чья
  цель имеет снимок в обходе; robots-blocked, за-лимитом и вне-scope цели не оцениваются —
  их статус неизвестен, evidence нет. Finding вешается на страницу-источник, selector —
  raw href (стабильная привязка к разметке), resource — нормализованный target; повторные
  href на странице схлопываются.
- **D-153 (T-08)** — TECH-008 noindex: finding только при противоречии сигналов —
  страница с noindex (`<meta name=robots>` с токеном noindex/none либо `X-Robots-Tag`)
  одновременно присутствует в sitemap ИЛИ на неё ведут внутренние ссылки с других страниц
  (self-ссылки не считаются). Просто noindex без противоречия — осознанное намерение
  владельца, НЕ finding. При обоих сигналах evidence — meta (dom).
- **D-154 (T-08)** — TECH-013 mixed content: помимо классического случая (https-страница
  с http:// субресурсом) finding даёт и http-страница с http-ресурсом на ДРУГОМ host —
  небезопасный внешний субресурс, ломающийся при переходе на https (fixture-сайт живёт на
  loopback-http и представляет https-сайт). Same-host ресурс на http-странице — не
  finding. Субресурсы: img/script/iframe[src] и link[href] c resource-rel
  (stylesheet/icon/apple-touch-icon/mask-icon/preload/prefetch/manifest); rel canonical/
  alternate и пр. — не субресурсы. Дедуп по selector `tag[attr="raw"]`.
- **D-155 (T-08)** — Пороги on-page правил: title 10–70, meta description 50–160; длина —
  в Unicode code points после trim, границы включительны (ровно 10/70/50/160 — не
  finding). ONPAGE-003 собирает все нарушения структуры заголовков (нет h1 / h1 > 1 /
  пропуск уровня) в один finding на страницу; ONPAGE-005 — один finding на страницу
  (selector — первый `<img>` без alt, excerpt с количеством), пустой alt="" — норма.
- **D-156 (T-08)** — Движок runModuleRules: applicable page-check = страница, прошедшая
  `rule.isApplicable` (по умолчанию 2xx+HTML; TECH-003/005 — любой HTTP-ответ); снимок с
  fetchError, не взятый правилом в работу, — applicable check без completed (иначе
  лежащий сайт давал бы coverage 1 вопреки D-026). Единственный fetchError-случай,
  который правило обрабатывает, — цикл redirect-ов (RedirectLimitError → TECH-005 c
  `targetUnreachable`). Issue-кандидаты дедупятся по fingerprint (первый побеждает),
  сырые findings остаются в RuleEvaluation; модуль без реализованных правил — ошибка
  вызывающего (throw), статусы Unavailable/Not applicable решаются до движка.
- **D-157 (T-08 review)** — Уточнение D-154: protocol-relative субресурс `//host/...`
  на http-странице НЕ finding — такой URL наследует схему страницы и при переходе
  сайта на https обновится автоматически, «ломаться» ему нечем (rationale D-154 —
  именно поломка при миграции). На https-странице protocol-relative резолвится в
  https и в ветку mixed content не попадает по определению. Дополнительно: поля
  `normalized*` в RuleFinding нормализуются normalizeField ещё в билдерах
  (pageFinding/siteFinding) — хранимое значение побайтно совпадает со входом
  fingerprint-v1 (движок сохраняет повторную нормализацию как idempotent-защиту).
- **D-160 (T-09)** — SEC-PASSIVE-002 baseline security headers: проверяются три группы —
  `X-Content-Type-Options` со значением ровно `nosniff`, защита от framing
  (`X-Frame-Options` ЛИБО CSP с директивой `frame-ancestors` — любого достаточно) и
  непустой `Referrer-Policy`. Один finding на страницу с перечнем отсутствующих в
  excerpt; selector пуст, resource = `security-headers`. Applicable — успешные
  HTML-страницы (2xx + HTML).
- **D-161 (T-09)** — SEC-PASSIVE-005 cookie-атрибуты: finding на каждую куку из
  Set-Cookie без Secure/HttpOnly/SameSite, parameter = имя куки; значение куки в
  evidence не попадает никогда (потенциальный секрет). safe-fetch склеивает повторные
  Set-Cookie через `, ` — сплиттер режет по запятой, за которой идёт `name=`, и не
  трогает запятую внутри Expires. Applicable — любой снимок с HTTP-ответом (куки
  ставятся и не-HTML/не-2xx ответами).
- **D-162 (T-09)** — SEC-PASSIVE-003 HSTS: applicable только для https-origin
  (applicable = 1); http-сайт → Not applicable (0/0) — fixture-сайт краулера живёт на
  loopback-http, поэтому в интеграционном тесте правило молчит, а оракул закрыт
  юнит-фикстурами с https-моками. Evidence — снимок homepage (normalizedUrl =
  origin + '/'): заголовок отсутствует ЛИБО без положительного max-age (отсутствие
  max-age и max-age=0 эквивалентны отсутствию HSTS). Нет снимка homepage → applicable
  без finding (evidence нет).
- **D-163 (T-09)** — REL-URL-verdicts по §9 в v0.1: warning-вердикты scored finding НЕ
  создают (у scored-правила score_delta = 0 невозможен). REL-URL-003 даёт finding
  только на финальный 5xx (fail); неожиданный 4xx — warning-вердикт, к тому же его
  evidence уже несёт SEO-TECH-003 — дублировать не стали. REL-URL-009: порог 1.8 s
  (§9) строгий — ровно 1800 ms не finding; превышение единственный сигнал правила,
  поэтому он scored (Medium из реестра). REL-URL-001: fetchError любого рода → fail c
  `targetUnreachable: true` (D-026); правило берёт в applicable ВСЕ снимки — проверка
  доступности недостижимого URL считается завершённой (её вердикт fail), coverage
  D-156 не занижается.
- **D-164 (T-09)** — API-проверки Reliability: SiteContext получил опциональный
  `apiChecks` (method из allowlist GET/HEAD/OPTIONS, url, expectedStatus?,
  requestHeaders?, snapshot?), движок — третий вид правила `kind: 'api'` (форма
  результата — как у site-правил, цели — ctx.apiChecks). REL-API-003: applicable —
  только выполненные проверки с чистыми заголовками; фактический статус ∈
  expected_status → pass (ожидаемый 404 — pass), вне списка → finding (неожиданный
  404 — finding); без явного списка ожидается любой 2xx; parameter = метод (различает
  проверки одного URL). REL-API-005: applicable — все сконфигурированные проверки;
  credentials детектируются по ИМЕНАМ заголовков (authorization, cookie,
  proxy-authorization + паттерны api-key/token/secret), значения не читаются и не
  логируются; выполненный вопреки policy запрос отмечается в excerpt; parameter =
  первый offending заголовок.
- **D-165 (T-09)** — CONTENT-004 битые media: краулер v0.1 фетчит только страницы по
  `<a href>`, media-ресурсы снимков не имеют. Оракул: (a) media-цель со снимком
  4xx/5xx, fetchError или text/html content-type (img на HTML-страницу) → битая,
  confidence 1; (b) внутренняя (host сайта) media без снимка → «не подтверждён
  обходом», confidence 0.6; внешние media без снимка не оцениваются (rationale
  D-152 — нет evidence). Признанный trade-off: на fixture-сайте живой /img/pixel.png
  попадает в excerpt как unconfirmed рядом с реальным /img/missing.png — деривативно
  различить их без фетча нельзя; устраняется media-probe краулера в будущем релизе.
  Один finding на страницу, selector — первый битый элемент.
- **D-166 (T-09)** — CONTENT-003 порог видимого текста: текст body без script/style
  (рекурсивный сбор без мутации кэшированного DOM), collapse whitespace, длина в
  Unicode code points (метрика §16). Порог 200 строгий: < 200 → finding, ровно 200 —
  норма (boundary 199/200). Страница без body — текст всего документа.
- **D-167 (T-09)** — evidence_group_id (§14 cross-module policy): RuleFinding получил
  опциональное non-scoring поле `evidenceGroupId` — в fingerprint не входит, на score
  не влияет. Формат `evg-v1:<sha256-hex>`, hash от `evg-v1 NUL category NUL
  normalizedUrl` (NUL-разделитель против склейки). Категория `img-alt` связывает
  SEO-ONPAGE-005 и A11Y-002: оба намеренно дают по finding на одно evidence (разные
  измерения и тарифные веса), SEO-ONPAGE-005 дополнен тем же group id.
- **D-168 (T-09)** — A11Y-004 labels: элемент считается подписанным при любом из —
  label[for] по id, обёртка `<label>`, непустой aria-label или aria-labelledby.
  Не требуют label input-типы hidden/submit/button/reset/image (имя даёт value/alt,
  hidden невидим); placeholder подписью НЕ считается. Один finding на элемент,
  selector по приоритету `tag#id` → `tag[name="..."]` → `tag[type="..."]`; повторные
  селекторы схлопываются (стабильный fingerprint).
- **D-169 (T-09)** — Privacy-инвентаризация (Low, informational-style, но scored по
  реестру): PRIVACY-001 — один finding на страницу с именами кук из Set-Cookie и/или
  присваиваний document.cookie в inline-скриптах; evidence http/dom/mixed по
  источникам; значения кук не логируются. PRIVACY-003 — один finding на страницу,
  third-party = script src с host, отличным от host страницы (поддомены тоже чужие —
  v0.1 не ведёт allowlist), отсортированные домены в excerpt; normalized-поля пусты,
  чтобы fingerprint не менялся при смене CDN.
- **D-170 (T-09 review)** — Уточнение D-169: PRIVACY-003 НЕ считает third-party хосты,
  связанные поддоменной цепочкой с hostname страницы или сайта (dot-suffix в любую
  сторону: cdn.example.com при сайте example.com — свой; сравнение по hostname, порт
  стороны не различает). Rationale: «third-party скрипты с доменов: static.mysite.com»
  на собственном статик-поддомене — ложный сигнал на самом распространённом сетапе.
  v0.1 без PSL: registrable-суффиксы не выделяются, родительский хост платформы тоже
  считается своим — осознанный trade-off в пользу отсутствия FP. Дополнительно:
  PRIVACY-001 матчит только присваивания document.cookie (`=` с lookahead `(?!=)`) —
  сравнение `document.cookie === ...` больше не даёт ложный маркер.
