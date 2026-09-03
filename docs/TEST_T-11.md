# TEST T-11 — export: records, JSON Schema, semantic validator, CSV, ECON-001

**Дата:** 2026-09-03  
**Вердикт: ✅ PASS**

---

## 1. Команды и результаты

| Команда | Результат | Время |
|---|---|---|
| `pnpm --filter @fluxradar/export test` | ✅ pass — 7 файлов, 85 тестов | 565 ms |
| `pnpm test` (workspace) | ✅ pass — 603 теста, exit 0 | ~8 s |
| `pnpm lint` | ✅ pass (0 ошибок, exit 0) | ~2 s |
| `pnpm typecheck` | ✅ pass (все проекты, exit 0) | ~5 s |
| `pnpm -r build` | ✅ pass (все артефакты, включая bin `dist/econ-cli.js`, exit 0) | ~6 s |

## 2. Тест-сьют workspace (`pnpm test`)

| Пакет | Файлов | Тестов | Статус |
|---|---|---|---|
| packages/contracts | 5 | 43 | ✅ pass |
| packages/fingerprint | 2 | 56 | ✅ pass |
| packages/scoring | 5 | 61 | ✅ pass |
| packages/safe-fetch | 3 | 84 | ✅ pass |
| packages/crawler | 4 | 33 | ✅ pass |
| packages/rules | 11 | 109 | ✅ pass |
| packages/ai | 10 | 100 | ✅ pass |
| **packages/export** | **7** | **85** | ✅ pass |
| apps/api | 7 | 32 | ✅ pass |
| apps/web | 0 | 0 (`--passWithNoTests`) | ✅ pass |

Итого: **603 теста** (совпадает с числом из ревью), из них 85 — юниты T-11
(schema-validator / builders / semantic-validator / csv / econ / econ-cli / index).
Соседи не сломаны: contracts/fingerprint/scoring/api и остальные пакеты зелёные.

## 3. Смоук-сценарии (node-скрипты из /tmp, импорт из `packages/export/dist/index.js`)

Файлы в репозиторий не добавлялись; вход собран билдерами
(`buildSummaryRecord` / `buildModuleRecord` / `buildIssueRecord`), маленький скан:
summary + module (SEO, 10/10) + issue (SEO-TECH-004, High, 2/10 → penalty 2.00).

### A. Полный пайплайн: builders → validateExportRecords → writeExportCsv

- `validateExportRecords([issue, summary, module])` (вход нарочно перемешан) → `ok: true`
  — schema и semantic стадии пройдены.
- Header = `EXPORT_CSV_COLUMNS.join(',')`, ровно **56 колонок**
  (первая `schema_version`, последняя `deletion_evidence_ref`).
- Кодировка: **LF-only** (нет `\r`), финальный LF присутствует, **BOM отсутствует**
  (первый байт не 0xEF/0xFEFF).
- Канонический порядок строк восстановлен из перемешанного входа:
  `summary → module → issue`.
- **null → пустое поле**: в summary-строке колонки `module`, `rule_id`, `severity`,
  `score_delta`, `fingerprint`, `metric_key` пусты; `scan_status=Completed`, `score=97.50`
  (два знака после точки).
- Issue-строка: `rule_penalty=2.00`, `score_delta=-2.00` (по построению = −penalty),
  fingerprint настоящий `fluxradar-fp-v1:*` (пересчёт инварианта 8 проходит).

Фактический вывод (усечён):

```
SMOKE-1a validateExportRecords: ok=true (schema+semantic)
SMOKE-1b header: 56 колонок, первый=«schema_version», последний=«deletion_evidence_ref»
SMOKE-1c кодировка: LF-only, завершающий LF, BOM отсутствует
SMOKE-1d сортировка: summary → module → issue при перемешанном входе
SMOKE-1e null → пустое поле (module/rule_id/severity/score_delta/fingerprint/metric_key), score=97.50
SMOKE-1f issue: rule_penalty=2.00, score_delta=-2.00, fingerprint=fluxradar-fp-v1:*
```

✅

### B. Негативная проба: испорченный score_delta

- `{...issue, score_delta: -1.5}` (вместо −2.00) → `ok: false`, `stage: 'semantic'`,
  violation с понятным сообщением:

```
[EXPORT-001/7] record #2: issue SEO-TECH-004: score_delta -1.5 != -rule_penalty (-2)
```

- Дополнительно `{...issue, score_delta: "-2"}` (строка) → отказ уже на `stage: 'schema'`;
  в списке violations присутствует точная причина `/score_delta: must be number`
  (см. «Наблюдения» про шум oneOf). ✅

### C. CSV formula-injection

- `evidence_excerpt = '=SUM(A1,A9) canonical points elsewhere'` (ведущий `=` + запятая).
- В CSV ячейка сериализована как `"'=SUM(A1,A9) canonical points elsewhere"` —
  префикс `'` нейтрализует формулу, запятая корректно заквочена по RFC 4180.
- Голой ячейки, начинающейся с `=`, в документе нет. ✅

### D. econ-validate CLI из dist (exit-коды)

Запуск `node packages/export/dist/econ-cli.js <arg>`:

| Вход | Exit | Вывод |
|---|---|---|
| `fixtures/econ/forecast-valid.json` | **0** | `ECON-001: PASS`; scans 50, gross $3400.00, reserve floor $500.00, margin $34.00, break-even 49, floor 45 |
| `fixtures/econ/forecast-reserve-below-floor.json` | **1** | `ECON-001: FAIL`, `[reserve-floor] support_reserve $500 ниже floor $1440 (max($500, 10% × gross))` |
| `/tmp/no-such-forecast-t11.json` | **2** | `econ-validate: не удалось прочитать forecast-файл …: ENOENT …` |
| без аргументов | **2** | `использование: econ-validate <forecast.json>` |

Регрессия D-188 (symlink bin-шим): pnpm-шим в workspace ещё не создаётся (на
`@fluxradar/export` пока никто не зависит — появится в T-12), поэтому сценарий
эмулирован symlink-ом `/tmp/econ-validate-symlink.js → dist/econ-cli.js`:
валидная фикстура → `ECON-001: PASS`, exit 0; невалидная → exit 1. CLI через
symlink реально исполняется (нет молчаливого exit 0). ✅

## 4. Наблюдения (не блокирующие)

1. **Шум schema-violations на oneOf**: при испорченном типе одного поля ajv
   репортит ошибки всех четырёх веток record-union (~94 записи на один battered
   record, «/record_type: must be equal to constant» и т.п.); точная причина
   (`/score_delta: must be number,null`) присутствует в конце списка. Поведение
   штатное для ajv `oneOf`, отказ корректен — соответствует «4 low accepted»
   из ревью (D-189).
2. Bin-шим `node_modules/.bin/econ-validate` в workspace отсутствует до появления
   зависимого пакета (T-12) — D-188 проверен эмуляцией symlink-а, тест
   `econ-cli.test.ts` также покрывает realpath-сравнение.

## 5. Вердикт

Все 5 формальных прогонов зелёные (85 юнитов пакета, 603 workspace), 4/4
смоук-сценария подтверждают контракты §16 (schema+semantic пайплайн, CSV LF/no-BOM/
null→пустое/two-decimals, formula-escape, порядок записей) и ECON-001 exit-коды
0/1/2 включая symlink-запуск. **T-11 — PASS, статус DONE.**
