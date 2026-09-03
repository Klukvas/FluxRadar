# TEST_T-07 — crawler: scope, robots, dedup, лимиты + fixture-сайт

Дата: 2026-09-03. Тест-агент: локальный.

---

## 1. pnpm lint

```
pnpm lint
```

**Результат:** ✅ pass — ошибок нет.

---

## 2. pnpm typecheck

```
pnpm typecheck
```

**Результат:** ✅ pass — все пакеты (включая `packages/crawler`) проверены без ошибок.

---

## 3. pnpm -r build

```
pnpm -r build
```

**Результат:** ✅ pass — все 10 пакетов/приложений собраны. `packages/crawler` собран с `tsc -p tsconfig.build.json`.

---

## 4. pnpm test

```
pnpm test
```

**Результат:** ✅ pass

| Пакет | Файлы | Тесты |
|---|---|---|
| **packages/crawler** | **4** | **33** |
| apps/api | 7 | 32 |
| packages/ai | 1 | 1 |
| packages/contracts | 5 | 43 |
| packages/export | 1 | 1 |
| packages/rules | 1 | 1 |
| packages/fingerprint | 2 | 56 |
| packages/scoring | 5 | 61 |
| packages/safe-fetch | 3 | 84 |
| apps/web | 0 | 0 (passWithNoTests) |

Итого по `packages/crawler`: **4 файла, 33 теста — все прошли**.

---

## 5. Smoke-тест (независимый node-скрипт)

Скрипт `/tmp/smoke-t07.mjs` импортирует `startFixtureSite` и `crawl` из `packages/crawler/dist/index.js`, запускает два последовательных прогона обхода fixture-сайта.

Параметры: `dangerouslyAllowLoopback: true`, `respectRobots` — по умолчанию (соблюдается).

**Результаты:**

| Проверка | Результат |
|---|---|
| `pages.length >= 15` | ✅ pass — 17 страниц |
| `blockedByRobots` содержит `/private/secret.html` | ✅ pass |
| Ни один URL не содержит `utm_` | ✅ pass — проверено 17 URLs |
| Два прогона дают одинаковый набор `normalizedUrl` | ✅ pass — run1=17, run2=17, diff=0 |

Список обойденных URL (прогон 1, 17 страниц):

```
[200] http://127.0.0.1:<port>/
[200] http://127.0.0.1:<port>/no-title.html
[200] http://127.0.0.1:<port>/orphan.html
[200] http://127.0.0.1:<port>/wrong-canonical.html
[200] http://127.0.0.1:<port>/broken-link.html
[200] http://127.0.0.1:<port>/redirect-a
[200] http://127.0.0.1:<port>/noindex.html
[200] http://127.0.0.1:<port>/dup-a.html
[200] http://127.0.0.1:<port>/dup-b.html
[200] http://127.0.0.1:<port>/empty.html
[200] http://127.0.0.1:<port>/broken-image.html
[200] http://127.0.0.1:<port>/mixed-content.html
[200] http://127.0.0.1:<port>/form.html
[200] http://127.0.0.1:<port>/trackers.html
[200] http://127.0.0.1:<port>/deep/
[404] http://127.0.0.1:<port>/missing
[200] http://127.0.0.1:<port>/deep/level2/page.html
```

`blockedByRobots`: `/private/secret.html` (соблюдает `Disallow: /private/` из robots.txt)

---

## Вердикт

**PASS** — все 5 шагов пройдены без ошибок. `packages/crawler`: lint чист, типы верны, сборка успешна, 33 теста зелёные, smoke-тест подтверждает корректный обход fixture-сайта (17 страниц, robots соблюдается, нет utm_, детерминизм двух прогонов).
