# Отчёт тестирования T-02 — пакет `packages/contracts`

Дата: 2026-09-03

---

## 1. pnpm lint

**Команда:** `pnpm lint`

**Результат:** Успешно, без ошибок и предупреждений.

**Вердикт:** PASS

---

## 2. pnpm typecheck

**Команда:** `pnpm typecheck` (запускает `pnpm -r typecheck` по всем 10 пакетам воркспейса)

**Результат:** Все пакеты проверены без ошибок (`tsc --noEmit`).

```
packages/contracts typecheck: Done
apps/api typecheck: Done
apps/web typecheck: Done
packages/ai typecheck: Done
... (все 10 — Done)
```

**Вердикт:** PASS

---

## 3. pnpm -r build

**Команда:** `pnpm -r build`

**Результат:** Все пакеты собраны успешно. `apps/web` собран через Vite (190 КБ JS, gzip 60 КБ).

```
packages/contracts build: Done
apps/web build: ✓ built in 84ms
... (все пакеты — Done)
```

**Вердикт:** PASS

---

## 4. pnpm test (весь workspace)

**Команда:** `pnpm test`

**Результат:**

| Пакет | Файлов | Тестов | Статус |
|---|---|---|---|
| packages/contracts | 5 | 43 | PASS |
| apps/api | 1 | 1 | PASS |
| packages/ai | 1 | 1 | PASS |
| packages/crawler | 1 | 1 | PASS |
| packages/export | 1 | 1 | PASS |
| packages/fingerprint | 1 | 1 | PASS |
| packages/rules | 1 | 1 | PASS |
| packages/safe-fetch | 1 | 1 | PASS |
| packages/scoring | 1 | 1 | PASS |
| apps/web | 0 | 0 | PASS (нет тестов) |

Итого: 13 файлов, 51 тест — всё прошло.

**Вердикт:** PASS

---

## 5. Смысловая проверка (node -e / contracts/dist/index.js)

**Команда:**
```
node -e "const c = require('.../packages/contracts/dist/index.js'); ..."
```

**Примечание по проверке #3:** В задании указано "сумма весов Complete = 1.0". В `RuleDescriptor` нет полей `weight` / `requiredForStatus` — эта концепция отсутствует в текущем дизайне. Вместо этого проверялась сумма `TARIFFS.Complete.scoreWeights`, что соответствует смыслу проверки (веса модулей в тарифе Complete должны давать 1.0).

| # | Проверка | Ожидаемо | Получено | Вердикт |
|---|---|---|---|---|
| 1 | `RULES_MVP_01.length` | 32 | 32 | PASS |
| 2 | `PLATFORM_CONTRACTS.length` | 10 | 10 | PASS |
| 3 | Сумма `TARIFFS.Complete.scoreWeights` | 1.0 | 1.0 | PASS |
| 4 | `canTransition('Pending','Running')` | false | false | PASS |
| 5 | `canTransition('Pending','Queued')` | true | true | PASS |
| 6 | `SEVERITY_WEIGHTS.Critical` | 25 | 25 | PASS |

**Вердикт:** PASS

---

## Итоговый вердикт

**T-02 (packages/contracts): PASS**

Все 5 шагов пройдены без ошибок. Пакет корректно собирается, типы валидны, 43 unit-теста проходят, смысловые инварианты соблюдены.
