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
