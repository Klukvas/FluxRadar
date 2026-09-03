# REVIEW_T-02 — ревью пакета `packages/contracts`

**Дата:** 2026-09-03. **Ревьювер:** review-агент T-02.
**Объём:** `packages/contracts/src/*` (16 файлов), сверка с `FluxRadar-Feature-Plan.md`
(§5, §14–§18, §25), `docs/IMPLEMENTATION_PLAN.md` §3–§4, `docs/DECISIONS.md` (D-007..D-030,
D-107..D-112), `docs/TASK_BOARD.md` (T-02).

## Вердикт

**APPROVED (с исправлениями, внесёнными в ходе ревью).** Пакет корректно фиксирует все
load-bearing контракты плана: severity-веса, тарифную матрицу, статусные enum-ы,
state machine, data dictionary export records и реестр `rules-mvp-0.1` из 42 дескрипторов.
Найдено и исправлено две проблемы (1 high, 1 medium) — обе в zod-схемах `api.ts`:
байтовые лимиты D-028/D-111 применялись как посимвольные. После исправления все
команды зелёные (43 теста).

## Таблица сверок с исходным планом

| # | Пункт сверки | Источник плана | Результат |
|---|---|---|---|
| 1 | Severity weights: Critical 25, High 10, Medium 3, Low 1 | §15 (стр. ~561) | ✅ совпадает (`severity.ts`, зафиксировано тестом) |
| 2 | Модули per plan: Free=SEO(homepage), Basic=SEO+AI, Complete=все 10 | §18 (стр. ~1145) | ✅ совпадает (`tariffs.ts`) |
| 3 | Веса Complete: SEO .20, AI .15, Security .20, Performance .15, A11y .10, Reliability .10, Content .05, Privacy .05 (Σ=1.0) | §15/§18 | ✅ совпадает; UX/Conversion и Analytics вне score (`SIDE_SCORE_MODULES`), тест суммы весов |
| 4 | Веса Basic: SEO .60 / AI .40 | §15/§18 | ✅ совпадает |
| 5 | Лимиты прогона: 5 000 / 50 000 URL; 50 / 500 AI-запросов | §18 (стр. ~1160) | ✅ совпадает |
| 6 | Цены: Basic $55, Complete $120, Free $0 | §19 (стр. ~1176) | ✅ совпадает |
| 7 | Retention: Free 30, Basic 30, Complete 365 (12 мес.) | §18 | ✅ совпадает |
| 8 | Entitlement 30 дней | §18 | ✅ совпадает (`ENTITLEMENT_DAYS`) |
| 9 | Free = 4 проверки homepage: title, H1, meta description, индексация | §18 | ✅ совпадает: `FREE_CHECK_RULE_IDS` = ONPAGE-001 (title), ONPAGE-003 (H1), ONPAGE-002 (meta), TECH-008 (noindex) — в порядке перечисления плана; тест резолвит каждый ID в реестре |
| 10 | Data dictionary полей records | §16 (стр. ~619–651) | ✅ совпадает: все поля словаря присутствуют в `ExportRecordBase`, типы/nullability соответствуют; narrowed-типы Summary/Module/AiResponse/Issue сверены с ветвями `oneOf` JSON Schema плана (стр. ~760–960) — const-null поля, обязательные строки (`provider`, `deletion_evidence_ref`, …), nullable `provider_created_at`/`finish_reason`/`metric_key`/`evidence_excerpt`, `usage` с 6 полями. D-014 (все ключи всегда присутствуют) соблюдён |
| 11 | State machine: Pending→{Queued,Cancelled}, Queued→{Running,Cancelled}, Running→{Completed,Partial,Failed,Cancelled}, Partial→Running (1 retry), Failed→Queued (1 platform retry), Completed/Cancelled терминальны | §18 (стр. ~1110–1122) | ✅ совпадает (`statuses.ts`); Refunded/Disputed корректно не включены — это billing-состояния; `isTerminalScanStatus` честно различает «терминальный» и «экспортируемый snapshot» |
| 12 | Статусы Issue: New, Acknowledged, Resolved, Reopened, Ignored, False Positive | §14 (стр. ~505–513) | ✅ совпадает; user-settable подмножество без Resolved/Reopened (D-110) в `USER_SETTABLE_ISSUE_STATUSES` + zod-схема |
| 13 | Статусы export: scan `Partial/Completed/Failed/Cancelled`; module `Completed/Partial/Unavailable/Not applicable`; runtime Pending/Queued/Running не экспортируются | §15 (стр. ~581) | ✅ совпадает; runtime и export enum-ы разделены, как требует TASK_BOARD |
| 14 | Названия правил из explicit mapping §25 | стр. ~1427–1452 | ✅ совпадает по ID/module/target kind/семантике оракула для всех 42; titles — короткие формы из IMPLEMENTATION_PLAN §3 (управляющий документ T-02). Задокументированные отклонения: GEO-PROVIDER-001 «provider adapter contract» вместо «OpenAI Responses adapter» (mock-провайдер v0.1, D-008; §3 impl-плана прямо задаёт «adapter-контракт»), BILLING-001 «webhook…» вместо «Paddle…» (MockPaddle). Косметика: SEO-TECH-006 «4xx/5xx pages», CONTENT-004 «broken media» |
| 15 | AI caps: 8 000 input / 2 000 output / 4 000 reasoning / 8 search / 32 citation | §5 (стр. ~247) | ✅ совпадает (`AI_REQUEST_CAPS`) |
| 16 | Лимиты краулера D-028/D-030: 5 MB HTML, 2048 B URL, 5 redirects, 10 s, 5 rps, 4 concurrent | DECISIONS | ✅ совпадает (`CRAWL_LIMITS`) |
| 17 | `evidence_excerpt` ≤ 2048 Unicode chars; CONTENT-003 порог 200 символов | §16 / impl §3 | ✅ совпадает (`limits.ts`) |
| 18 | Реестр 42 = 32 scanning+GEO + 10 platform (D-107: 9+4+5+3+5+2+2+2+6+3+1) | D-007/D-107, impl §3 | ✅ совпадает; тест фиксирует состав по каждой группе и итог |
| 19 | `RULESET_VERSION = 'rules-mvp-0.1'` — единственная точка определения | impl §3 | ✅ консистентно: определён в `ruleset-types.ts`, ре-экспорт в `ruleset.ts`, других захардкоженных копий в коде нет |
| 20 | D-111: https-origin (без path/query/fragment/userinfo/trailing slash, нормализация к `origin`), пароль ≥8 и ≤72 байт | DECISIONS | ⚠️ **исправлено**: origin-валидация была корректной, но оба верхних лимита (пароль, домен) применялись в символах, а не байтах — см. проблемы ниже |

## Найденные проблемы

| ID | Severity | Описание | Статус |
|---|---|---|---|
| H-1 | **High** | `api.ts`: лимит пароля D-111 — это граница молчаливого усечения bcrypt в **байтах**, но `z.string().max(72)` считает UTF-16 code units. Пароль из 37 кириллических символов (74 байта UTF-8) проходил валидацию и был бы молча усечён bcrypt — ровно тот сценарий, который D-111 обязан исключать. | ✅ исправлено |
| M-1 | Medium | `api.ts`: `httpsOriginSchema.max(CRAWL_LIMITS.maxUrlBytes)` — константа задаёт **байты** (D-028), а `.max()` считает символы; IDN-домен в Unicode мог превысить байтовый лимит. Практически труднодостижимо (лимит hostname 253 символа), но контракт был выражен неверной единицей. | ✅ исправлено |
| L-1 | Low | Titles нескольких правил — короткие парафразы формулировок §25 (SEO-TECH-006 «4xx/5xx pages», CONTENT-004 «broken media», REL-API-005 «no-credentials policy» и др.). ID, module, target kind и оракулы совпадают; формулировки соответствуют IMPLEMENTATION_PLAN §3. | принято, без изменений |
| L-2 | Low | GEO-PROVIDER-001 назван «provider adapter contract» вместо «OpenAI Responses adapter» из §25 — осознанное решение v0.1 (mock-провайдер, D-008; IMPLEMENTATION_PLAN §3 задаёт именно «adapter-контракт»). При подключении реальных провайдеров потребуется новая версия ruleset с GEO-PROVIDER-001..003. | принято, без изменений |

Критических проблем не найдено. Замечаний по качеству кода нет: все файлы < 400 строк
(максимум — `ruleset-scanning.ts`, 366), данные иммутабельны (`as const`, `readonly`,
`ReadonlyMap`), naming ясный, комментарии объясняют «почему» со ссылками на решения,
`console.log` отсутствует. Тесты осмысленны: пиннинг констант — уместная практика для
пакета-источника истины (защита от случайной правки), тесты состава реестра, переходов
state machine и zod-границ нетавтологичны.

## Исправления

1. **`packages/contracts/src/api.ts`** — введён `utf8ByteLength` через `TextEncoder`
   (работает в Node и браузере); лимит пароля 72 в `registerInputSchema` и
   `loginInputSchema` теперь применяется к длине в UTF-8 байтах (`refine`), лимит
   домена 2048 — аналогично. Сообщения об ошибках явно называют байты.
2. **`packages/contracts/src/api.test.ts`** — регрессионный тест байтовой границы:
   72 ASCII-символа проходят, 73 — нет; 36 кириллических символов (72 байта) проходят,
   37 (74 байта) — нет. Этот тест ловил исходный дефект H-1.

## Результаты команд (после исправлений)

| Команда | Результат |
|---|---|
| `pnpm --filter @fluxradar/contracts test` | ✅ 5 файлов, **43 теста passed** |
| `pnpm lint` | ✅ без ошибок |
| `pnpm typecheck` | ✅ все пакеты |
| `pnpm -r build` | ✅ все пакеты и приложения |

**Рекомендация:** T-02 можно переводить в DONE. Контракты пригодны как основание для
T-03..T-11; отдельное внимание T-10 — при выходе из mock-режима потребуется новая версия
ruleset для provider-специфичных GEO-PROVIDER правил (L-2).
