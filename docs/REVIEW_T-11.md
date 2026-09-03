# REVIEW_T-11 — Review: packages/export (canonical records §16, JSON Schema, semantic validator, CSV, ECON-001)

**Дата:** 2026-09-03
**Ревьювер:** review-агент T-11
**Объект:** `packages/export/src/` — errors, fields, schema, schema-validator, builder-inputs,
builder-guards, builders, semantic-validator, semantic-aggregation, validate, csv, econ,
econ-cli, index (+ testing/fixtures, 7 тест-файлов, fixtures/econ ×2)
**Контекст:** план §16 (Export schema v1, CSV contract v1, data dictionary, канонический
пример, EXPORT-001 инварианты 1–13), §18 (ECON-001, цены/Paddle/floor 45), §15 (score);
D-014..D-016, D-019, D-021, D-024, D-107..D-109, D-119, D-180..D-187.
**Вердикт:** **APPROVED WITH FIXES** — 1 HIGH исправлен (CLI `econ-validate` через
bin-шим pnpm молча выходил с кодом 0 при любом входе — ложный PASS economics gate,
D-188), 1 LOW исправлен (негативная проба D-019 на уровне semantic-валидатора),
4 LOW приняты с фиксацией трактовок (D-189). Тесты расширены с 84 до 85
(workspace 602 → 603).

---

## Итоговый вердикт

Ключевой риск задачи — дословность схемы §16 — снят объективно: схема и канонический
пример сверены с планом **программным deep-diff-ом** (парсинг JSON-блоков из
`FluxRadar-Feature-Plan.md` → рекурсивное сравнение значений **и порядка ключей**
с `EXPORT_RECORD_SCHEMA` из свежесобранного dist) — расхождений ноль. Код чистый:
strict TS без `any`, файлы < 400 строк (schema.ts — 488 строк данных, допущение D-180),
иммутабельные билдеры, типизированные ошибки, импорты `.js`, входные структуры не
мутируются (нормализация и сортировка создают новые объекты/массивы).

### Проверено по источникам истины

- **Схема §16 дословно** — deep-diff план ↔ `schema.ts`: идентичны все имена полей,
  типы, enum-литералы, required-списки, const-ы, if/then-ветки allOf, все четыре
  oneOf-ветки и порядок ключей. Тест дополнительно фиксирует `$id`, draft 2020-12,
  `oneOf ×4`, `additionalProperties: false`.
- **Канонический пример** — `CANONICAL_ISSUE_EXAMPLE` в fixtures сверен с примером
  плана программно: порядок ключей и значения идентичны (41 поле, включая
  placeholder-ы `scan_01J...`/`fluxradar-fp-v1:...`). Тест прогоняет пример как есть
  через schema-этап и (с настоящим пересчитанным fingerprint — требование инварианта 8)
  через полный пайплайн `validateExportRecords` (schema → normalize D-014 → semantic).
  Пересчёт penalty примера сходится: High (10) × min(1, 1/1) = 10.00 = `rule_penalty`.
- **Semantic-инварианты 1–9** — каждый реализован и имеет адресную негативную пробу
  (проба портит одно поле валидного record и ассертит номер инварианта): 1 — plan/
  schema_version; 2 — порядок timestamp-ов и UTC Z (2 пробы); 3 — status_reason по
  веткам (3 пробы); 4 — coverage/counts + статусный контракт (2); 5 — module score,
  summary score < 0.50 coverage, cross-record completed-but-unusable (3); 6 — affected ≤
  applicable + site-level 1/1 (2); 7 — score_delta = −rule_penalty; 8 — пересчёт
  fingerprint из 8 компонент через `computeFingerprint`; 9 — дубль fingerprint, пересчёт
  penalty, рассинхрон агрегатов правила (D-016), metric_key non-perf/perf (4 пробы).
  Плюс usage-часть инварианта 10 (2 пробы) и set-часть 13 (один summary D-024, один
  scan_id — 2 пробы). Пересчёт rule_penalty идёт через **тот же** `computeModuleScore`
  из scoring (integer hundredths D-119, max severity per rule D-020, дедуп по
  fingerprint) — валидатор и движок не могут разойтись по округлению. `rule_penalty=0`
  честно трактуется как explicit non-scoring resolver (D-183). Scope-решения D-183/D-184
  (полный инвариант 13 и AI-метаданные 11 — T-15; PERF-RULE-014/015 — при появлении
  Performance-раннера, D-006) корректны.
- **CSV contract v1** — снапшот-тест действительно байт-в-байт (`toBe` на полной строке
  документа, вход перемешан — writer сам строит канонический порядок summary → module
  (порядок MODULE_NAMES, D-185) → ai_response (provider, request_id) → issue (Critical→Low,
  fingerprint лексикографически)); отдельные байтовые ассерты: нет BOM, нет 0x0D,
  завершающий LF. Формула-экранирование `= + - @` только у строк — числовые поля
  не портятся (ассерт `,10.00,-10.00,` и `not.toContain("'-10.00")`, D-186); RFC 4180
  quoting покрыт: запятая и удвоение кавычек в снапшоте, LF внутри значения — отдельный
  тест. Zero-issue → ровно header + summary-строка. Header = 56 колонок в порядке
  data dictionary (плоский разворот таблицы, D-185).
- **ECON-001 / D-187 — пересчёт вручную** (цены из TARIFFS: Basic $55, Complete $120;
  Paddle 5% + $0.50): Basic margin = 5500 − (275+50) − 2425 = 2750¢ = $27.50; Complete =
  12000 − (600+50) − 5350 = 6000¢ = $60.00; weighted 80/20 = 3400¢ = $34.00 — совпадает
  с §18 и fx-фикстурой. Break-even = ceil((100000+50000+6800+1700+5000)¢ / 3400¢) =
  ceil(48.088) = 49 ≤ 50 ✅. Стресс-кейс §18: ceil(150000/3400) = 45 = operational floor ✅.
  Негативная фикстура: gross $14 400 → floor max($500, $1 440) = $1 440 > reserve $500 →
  единственный отказ `reserve-floor` ✅. Арифметика в центах (`toCents`/`Math.round`);
  дробные центы возможны только после mix-взвешивания — поглощаются допуском 1 цент
  и `ceilWithEpsilon` (принято, D-189).
- **Совместимость** — типы contracts (`ExportRecordBase` 56 полей, narrowed records,
  enum-ы D-108) и API scoring/fingerprint используются напрямую, без переобъявлений.

## Таблица находок

| # | Severity | Файл | Описание | Статус |
|---|---|---|---|---|
| H-1 | High | `src/econ-cli.ts` | Запуск через bin-шим pnpm (symlink в `node_modules/.bin`) не выполнял main-блок: Node резолвит `import.meta.url` через realpath, а `process.argv[1]` остаётся путём symlink-а → сравнение путей ложно-отрицательно, CLI **молча выходил с кодом 0 при любом входе**, включая проваливающий forecast — ложный PASS economics gate. Воспроизведено смоуком через symlink до фикса (пустой вывод, exit 0). Исправлено сравнением канонических путей (`realpathSync`, D-188); смоук через symlink после фикса: PASS→0, FAIL→1 | fixed |
| L-1 | Low | `src/semantic-validator.test.ts` | Проверка D-019 (site-level → `normalized_url` = '') существовала в валидаторе и билдере, но негативная проба была только на билдере. Добавлена адресная проба валидатора (fingerprint пересчитан под порченый URL, чтобы проба била в D-019, а не в инвариант 8) | fixed |
| L-2 | Low | `src/csv.ts` | `compareStrings` — UTF-16 code-unit сравнение: для fingerprint (ASCII hex) эквивалентно байтовому (что и требует §16), но для provider/request_id с не-BMP символами порядок может отличаться от UTF-8-байтового. Реальные значения — ASCII | accepted (D-189) |
| L-3 | Low | `src/econ.ts` | `weightedMarginCents` после mix-взвешивания — float (mix — доля): «целые центы» строго верны до взвешивания; сверка с заявленной margin имеет допуск 1 цент, break-even защищён `ceilWithEpsilon` | accepted (D-189) |
| L-4 | Low | `src/schema-validator.ts` | `normalizeUsage`: fallback `?? 0` для required-полей usage — мёртвая ветка (ajv гарантирует присутствие по required схемы); безвреден, семантику не меняет | accepted (D-189) |
| L-5 | Low | `src/csv.ts` | Формула-экранирование покрывает `= + - @` (без tab/CR-lead-вариантов OWASP); CR/LF в значениях в любом случае нейтрализуются RFC 4180 quoting | accepted (уже зафиксировано D-186) |

## Внесённые исправления

1. **`src/econ-cli.ts`** — детект прямого запуска вынесен в `isDirectCliRun()`:
   `import.meta.url === pathToFileURL(realpathSync(entryPoint)).href`; при недоступном
   realpath — откат к сравнению без резолва. Библиотечный импорт по-прежнему не
   запускает main-блок (проверено тестами: импорт `runEconValidate` из index без
   побочного вывода).
2. **`src/semantic-validator.test.ts`** — добавлена негативная проба `D-019`
   (site-level issue с непустым `normalized_url` отклоняется валидатором) — 85-й тест.

## Результаты команд

| Команда | Результат |
|---|---|
| `pnpm --filter @fluxradar/export test` | ✅ 7 файлов, **85 passed** |
| `pnpm --filter @fluxradar/export typecheck` | ✅ |
| `pnpm --filter @fluxradar/export build` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ (все пакеты) |
| `pnpm --filter @fluxradar/scoring test` | ✅ 61 passed |
| `pnpm --filter @fluxradar/contracts test` | ✅ 43 passed |
| `pnpm -r test` | ✅ **603 passed** (все 9 пакетов) |
| Смоук CLI из dist (direct) | ✅ valid→0 + PASS-отчёт stdout; reserve-below-floor→1 + `[reserve-floor]` stderr; несуществующий файл→2; без аргументов→2 |
| Смоук CLI через symlink (как pnpm bin) | ✅ после H-1: valid→0, fail→1 (до фикса: пустой вывод, exit 0) |
| Deep-diff схемы план ↔ dist | ✅ идентичны (значения + порядок ключей) |
| Deep-diff канонического примера план ↔ fixture | ✅ идентичны (41 поле, порядок ключей) |

## Остаточные риски

- Инварианты 11 (сверка AI-метаданных с AI-001) и полный 13 (сверка с dashboard) —
  сознательный scope T-15 (D-183); ordering-часть 12 покрыта CSV-writer-ом и снапшотом.
- PERF-RULE-014/015 special-cases инварианта 9 не реализованы до появления
  Performance-раннера (D-184, Performance вне v0.1 по D-006) — проверка аддитивна.
- `writeExportCsv` не вызывает валидацию сам: контракт §16 требует запускать
  `validateExportRecords` до записи — обязанность T-12 export API (зафиксировано
  комментарием в `validate.ts`).
