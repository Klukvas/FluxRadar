# REVIEW_T-04 — ревью пакета `packages/scoring`

**Дата:** 2026-09-03. **Ревьювер:** review-агент T-04.
**Объём:** `packages/scoring/src/*` (round2.ts, module-score.ts, coverage.ts,
usable-output.ts, overall-score.ts, index.ts + 5 тест-файлов), сверка
с `FluxRadar-Feature-Plan.md` §15 (стр. 549–597, дословные формулы score)
и §25 (стр. 1364–1374, golden score vector), `docs/DECISIONS.md`
(D-016, D-017, D-020, D-021, D-022, D-026, D-027, D-119..D-124),
`docs/TASK_BOARD.md` (T-04). Формулы проверены построчно; три сценария
пересчитаны независимо (вручную + node-скриптом против собранного dist,
без опоры на тесты пакета).

## Вердикт

**APPROVED.** Все формулы §15 реализованы точно: module score (dedup по
fingerprint → max severity per rule → `severity_weight × min(1, affected/applicable)`
для page-level / полный вес для site-level → informational вне Σ →
`round2(max(0, 100 − Σ))`), coverage/status contract v1, effective weights,
общий score с порогами 0.80/0.50 и `Insufficient data` при нулевом знаменателе,
usable-output предикат D-026. Golden vector §25 (96.50) и оба сценария
overall подтверждены независимым пересчётом. Расчёт в целых сотых (D-119)
исключает float-накопление; half-up по десятичному представлению (D-021)
подтверждён на провокационных значениях, где `toFixed(2)` даёт другой
результат. Критических и high-проблем нет; код не менялся. 61 тест,
lint и typecheck зелёные.

## Сверка формул против плана §15 (построчно)

### `module-score.ts` — computeModuleScore

| Требование §15/§25 | Реализация | Статус |
|---|---|---|
| Findings сначала дедуплицируются по fingerprint; повтор fingerprint считается один раз | `dedupByFingerprint` (Set, первый выигрывает); порядок «filter informational → dedup» эквивалентен плану, т.к. fingerprint включает rule_id, а scoring — атрибут правила: scored и informational не делят fingerprint | ✅ |
| Для каждого rule_id — максимальная severity уникальных scored findings (D-020: один Critical среди Low задаёт вес всей доли) | `maxSeverity` по `SEVERITY_WEIGHTS`; тест «Critical + Low → вес 25» | ✅ |
| `rule_penalty = severity_weight × min(1, affected/applicable)` для page-level | `pageLevelPenaltyHundredths`: при `affected >= applicable` — полный вес (min(1,…)); иначе `floor((2·w·100·a + d) / (2d))` — точное целочисленное деление с half-up (D-119/D-021), без float | ✅ |
| Site-level — полный вес, targets 1/1 (§15); site-level = `site`/`environment`, `api` — page-level (D-120) | `SITE_LEVEL_TARGET_KINDS = ['site','environment']`; валидация targets ≠ 1 → throw | ✅ |
| `score_delta=0` (informational) не входит в Σ | `filter(scoreDelta === 'scored')` до агрегации; informational допускает `severity: null` (D-109) | ✅ |
| `module_score = round2(max(0, 100 − Σ rule_penalty))` | `max(0, 10000 − Σ penaltyHundredths) / 100` — эквивалент round2 в целых сотых; клэмп только на итоге, разбор penalty сохраняет полные значения | ✅ |
| Severity-веса: Critical −25, High −10, Medium −3, Low −1 | `SEVERITY_WEIGHTS` из contracts | ✅ |
| `applicable_targets=0` → Not applicable, scored finding невозможен | throw в `validateTargetCounts` | ✅ |
| D-016/D-121: affected/applicable — агрегаты уровня правила; агрегатор берёт максимум; разные targetKind в одном правиле — ошибка | `Math.max(...)` по findings + throw на смешанные targetKind | ✅ |
| D-119 инвариант: Σ отображаемых per-rule penalty = 100 − score (до клэмпа) | подтверждён пересчётом (2 правила по 3.33 → score 93.34) | ✅ |

### `coverage.ts` — computeCoverage (coverage/status contract v1)

| Требование §15 | Реализация | Статус |
|---|---|---|
| `coverage = completed_applicable_checks / applicable_checks`, расчёт по точному значению, округление только при отображении | точная дробь (тест: 3/7 без округления) | ✅ |
| `Completed` → coverage 1 при `applicable_checks > 0` | ветка `completed === applicable` (после отсечения `applicable === 0`) | ✅ |
| `Partial` → строго `0 < coverage < 1` (D-022 побеждает «1%–99%») | остаточная ветка; тест 1/1 000 000 → Partial | ✅ |
| `Unavailable` → coverage 0 + обязательный `status_reason` | ветка `completed === 0`, `withRequiredReason` | ✅ |
| `Not applicable` → `applicable_checks=0`, coverage 0 + обязательный reason | первая ветка | ✅ |
| `status_reason` обязателен во всех состояниях, кроме обычного `Completed` | throw при пустом/пробельном reason для Partial/Unavailable/Not applicable | ✅ |
| Runtime-статусы (Pending/Queued/Running) не экспортируются | тип `ModuleExportStatus` содержит только 4 терминальных статуса | ✅ |

### `overall-score.ts` — computeOverallScore

| Требование §15 | Реализация | Статус |
|---|---|---|
| `effective_weight_i = tariff_weight_i × coverage_i` при usable output, иначе 0 | `buildModuleWeights` + `isScoreEligible`; D-124: дополнительно требуется терминальный `Completed`/`Partial` — `Unavailable` с ненулевым coverage не набирает вес (тест защиты контракта) | ✅ |
| `weighted_coverage = Σ ew / Σ tariff_weight`; в знаменатель входят **все** модули тарифа (Unavailable, Not applicable, completed-but-unusable, отсутствующие) | `moduleWeights` строится по `TARIFFS[plan].scoreWeights` целиком; отсутствующий модуль тарифа → ew 0 | ✅ |
| Overall только по модулям с `ew > 0` и числовым score; `overall = round2(Σ(score×ew) / Σew)` | `weightedScore` фильтрует `ew > 0` + `typeof score === 'number'`, делит на Σ этих ew, итог через `round2` | ✅ |
| Пороги: wc ≥ 0.80 → normal; 0.50 ≤ wc < 0.80 → Provisional; wc < 0.50 → Insufficient data; одинаково для Complete и Basic (D-017) | `verdictFor` с epsilon 1e-9 (D-122); wc возвращается точным, без округления | ✅ |
| Нулевой знаменатель Σ tariff_weight (Free) → Insufficient data без исключения (D-123) | ранний return при `tariffWeightTotal <= 0` | ✅ |
| Нулевой effective-знаменатель (all Unavailable / Not applicable) → Insufficient data, не деление на ноль | `weightedScore` → null → вердикт insufficient_data | ✅ |
| Basic: те же веса 0.60/0.40, та же формула | `TARIFFS.Basic.scoreWeights`; общий код | ✅ |
| UX/Conversion и Analytics — побочные оценки, вне общего score | `SIDE_SCORE_MODULES` молча пропускаются; модуль вне тарифа → fail fast (D-124) | ✅ |
| Недоступный модуль не превращается в нулевой балл | ew 0 → исключён и из числителя, и из effective-знаменателя; тест «completed-but-unusable» | ✅ |

### `round2.ts` (D-021) и `usable-output.ts` (D-026)

| Требование | Реализация | Статус |
|---|---|---|
| round2 = half-up по **десятичному представлению** (не banker's, не по двоичному значению) | решение по третьей цифре `String(value)` (кратчайшее десятичное представление double); арифметика в целых сотых без `×100` в float | ✅ |
| Провокации: 0.005→0.01, 2.675→2.68 (`toFixed` даёт 2.67), 96.495→96.5, 1.005→1.01 | подтверждено независимым пересчётом (см. ниже) | ✅ |
| Двоичный шум: `0.1+0.2` (=0.30000000000000004) → 0.30 | третья цифра '0' → вниз | ✅ |
| Отрицательные в домене score не встречаются | симметричное округление от нуля реализовано и оттестировано на всякий случай; NaN/Infinity/|x|>1e12 → throw (сотые остаются в safe integers, String без экспоненты в целой части; экспоненциальная запись малых чисел разворачивается `toPlainDecimalString`) | ✅ |
| usable output (D-026): ≥1 завершённая applicable check И ≥1 валидный metric/score/finding с evidence; findings «цель недоступна» (DNS/timeout/5xx) usable output не создают | `hasUsableOutput`: `completedApplicableChecks >= 1` + `some(hasEvidence && targetUnreachable !== true)`; unreachable-findings не блокируют другой валидный результат | ✅ |

## Независимые пересчёты (вручную + node против dist)

**(а) Golden §25** — 100 applicable URL, High rule на 20 URL, Medium rule на 50 URL:
ручной расчёт `100 − 10×0.20 − 3×0.50 = 100 − 2 − 1.5 = 96.50`;
`computeModuleScore` → **96.5**, penalty 2.00 + 1.50 — совпадает.
Повтор того же fingerprint (дубль finding) → **96.5**, значение не меняется. ✅

**(б) Basic, Partial coverage** — SEO 90 @ cov 0.5 + AI 100 @ cov 1.0:
ручной расчёт `ew_SEO = 0.6×0.5 = 0.30`, `ew_AI = 0.4×1 = 0.40`,
`wc = 0.70` → Provisional; `overall = round2((90×0.30 + 100×0.40)/0.70) =
round2(67/0.7) = round2(95.7142857…) = 95.71`;
`computeOverallScore('Basic', …)` → **provisional, 95.71, wc 0.7** — совпадает. ✅

**(в) Complete, Performance Unavailable** (score null, usable output нет),
остальные 7 модулей 100 @ cov 1.0: ручной расчёт `Σ tariff_weight = 1.00`,
`Σ ew = 1 − 0.15 = 0.85` → wc 0.85 → normal; `overall = 0.85×100/0.85 = 100`;
`computeOverallScore('Complete', …)` → **normal, 100, wc 0.8500000000000001** —
совпадает (float-шум в wc ожидаем: план требует точное значение без округления,
пороги сравниваются с epsilon D-122, отображение округляет round2). ✅

**round2-провокации** (независимый прогон): 0.005→0.01, 2.675→2.68
(контроль: `(2.675).toFixed(2)` = «2.67»), 96.495→96.5, 1.005→1.01,
`0.1+0.2`→0.3, `67/0.7`→95.71, 96.494→96.49, 0.004999→0 — все совпали. ✅

**Дополнительные краевые прогоны:** половинный случай в сотых
(Low 1/200 → 0.5 сотой → half-up → penalty 0.01) ✅; инвариант D-119
(Σ per-rule penalty == 100 − score: 3.33+3.33 → score 93.34) ✅;
wc ровно 0.8 из float-произведений (0.6×1 + 0.4×0.5) → normal (D-122) ✅;
Free → insufficient_data (D-123) ✅; all Unavailable → insufficient_data
без исключения ✅; coverage 3/7 — точная дробь ✅; только
unreachable-findings → usable output false (D-026) ✅.

## Проблемы

**Critical: 0. High: 0.** Код в ходе ревью не менялся.

Низкоприоритетные наблюдения (не блокируют, исправление не требуется):

- **L-1** (`module-score.ts`): scored finding с `affectedTargets = 0` проходит
  валидацию и создаёт запись в `rulePenalties` с penalty 0. По смыслу §15
  affected target — цель с *подтверждённым* finding, значит при наличии finding
  affected ≥ 1. Поведение безопасно (штраф 0), но агрегатор rules (T-08+)
  не должен подавать такой вход; при желании можно ужесточить валидацию.
- **L-2** (`overall-score.ts`): `validateSummary` не проверяет консистентность
  `moduleStatus` ↔ `coverage` (например, `Completed` с coverage 0.5 получит
  `ew = w×0.5`). Опасное направление закрыто D-124 (`Unavailable` с ненулевым
  coverage → вес 0, тест есть); обратное направление лишь консервативно
  занижает вес. Вход формируется `computeCoverage`, рассинхрон возможен только
  при ошибке сборки в T-12.

Информационные заметки:

- **I-1**: per-rule округление penalty до сотых *до* суммирования — документированное
  отклонение от буквального §15 (`round2` один раз после Σ), принятое в D-119
  ради инварианта D-016 (Σ отображаемых penalty точно равна 100 − score);
  расхождение с буквальной формулой ограничено 0.005 × число правил модуля.
- **I-2**: `totalPenaltyHundredths` восстанавливает сотые из float
  (`Math.round(rule.penalty * 100)`); в домене (penalty = n/100, n ≤ 2500·k)
  это точно, но элегантнее было бы нести `penaltyHundredths` в промежуточной
  структуре. Не баг.

Качество для потребителей (T-11 export, T-12 api): все функции и типы
(`ScoredFinding`, `RulePenalty`, `ModuleScoreResult`, `CoverageInput`,
`ModuleCoverage`, `ModuleScoreSummary`, `ModuleWeightBreakdown`,
`OverallScoreResult`, `OverallVerdict`, пороговые константы) экспортированы
из `index.ts`; входы/выходы `readonly`, мутаций внешних данных нет
(локальные Map/Set — только внутри функций); `rulePenalties` и
`moduleWeights` детерминированно отсортированы; краевые случаи покрыты
(informational с `severity: null`, пустой список findings → 100, пустой вход
overall, дубликаты модулей, диапазоны coverage/score). Файлы 38–180 строк,
чистые функции без I/O.

## Команды

| Команда | Результат |
|---|---|
| `pnpm --filter @fluxradar/scoring test` | ✅ 5 файлов, 61/61 тестов |
| `pnpm lint` | ✅ без ошибок |
| `pnpm typecheck` | ✅ все пакеты |
| независимый node-скрипт (3 сценария + краевые прогоны против dist) | ✅ все совпали |
