# TEST_T-04 — scoring: score engine §15

Дата: 2026-09-03

## Команды и результаты

### 1. `pnpm lint`

```
> fluxradar@0.1.0 lint /Users/.../FluxRadar
> eslint .
```

Результат: **PASS** — нет ошибок и предупреждений.

---

### 2. `pnpm typecheck`

```
Scope: 10 of 11 workspace projects
[все пакеты, включая packages/scoring]: Done
```

Результат: **PASS** — TypeScript ошибок нет.

---

### 3. `pnpm -r build`

```
packages/contracts build: Done
packages/fingerprint build: Done
packages/scoring build: Done
apps/web build: ✓ built in 61ms
...
```

Результат: **PASS** — все пакеты собраны успешно, `packages/scoring/dist/` сгенерирован.

---

### 4. `pnpm test`

```
packages/scoring test:  Test Files  5 passed (5)
packages/scoring test:       Tests  61 passed (61)
packages/scoring test:    Duration  287ms
```

Итого по всем пакетам: все тест-файлы зелёные.

Результат: **PASS** — 61 тест scoring, включая покрытие module-score, coverage, overall-score, round2, usable-output.

---

### 5. Независимый smoke — golden scenario §25

Скрипт: `/tmp/smoke-t04.mjs`, вызов `computeModuleScore` из `packages/scoring/dist/index.js`.

Условия:
- `applicableTargets = 100`
- Правило High: `affectedTargets = 20` → penalty = 10 × (20/100) = **2.00**
- Правило Medium: `affectedTargets = 50` → penalty = 3 × (50/100) = **1.50**
- Σ penalty = **3.50**
- Ожидаемый score: 100 − 3.5 = **96.50**

```
=== Smoke test T-04: golden scenario §25 ===
Вход: 100 applicable, High→20 affected, Medium→50 affected
Ожидаемый score: 96.5
Полученный score: 96.5

Rule penalties:
  rule-high: severity=High, affected=20/100, penalty=2
  rule-medium: severity=Medium, affected=50/100, penalty=1.5

РЕЗУЛЬТАТ: PASS ✓ — score совпадает с golden 96.5
```

Результат: **PASS** — golden 96.50 подтверждён.

---

## Итоговый вердикт: PASS

Все 5 проверок прошли без ошибок. Пакет `@fluxradar/scoring` корректно реализует score engine §15:
- dedup по fingerprint
- max severity per rule
- page-level penalty = severity_weight × min(1, affected/applicable), считается в целых сотых (D-119)
- module_score = round2(max(0, 100 − Σ rule_penalty))
