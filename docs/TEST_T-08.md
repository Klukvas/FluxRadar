# TEST_T-08 — rules: движок + SEO-правила (13)

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

**Результат:** ✅ pass — все пакеты (включая `packages/rules`) проверены без ошибок.

---

## 3. pnpm -r build

```
pnpm -r build
```

**Результат:** ✅ pass — все 10 пакетов/приложений собраны. `packages/rules` собран с `tsc -p tsconfig.build.json`.

---

## 4. pnpm test

```
pnpm test
```

**Результат:** ✅ pass

| Пакет | Файлы | Тесты |
|---|---|---|
| **packages/rules** | **5** | **53** |
| apps/api | 7 | 32 |
| packages/ai | 1 | 1 |
| packages/contracts | 5 | 43 |
| packages/export | 1 | 1 |
| packages/fingerprint | 2 | 56 |
| packages/scoring | 5 | 61 |
| packages/safe-fetch | 3 | 84 |
| packages/crawler | 4 | 33 |
| apps/web | 0 | 0 (passWithNoTests) |

Итого по `packages/rules`: **5 файлов, 53 теста — все прошли**.

---

## 5. Smoke-тест (независимый node-скрипт)

Скрипт `/tmp/smoke-t08.mjs` импортирует `startFixtureSite` и `crawl` из `packages/crawler/dist/index.js`, `runModuleRules` и `createSiteContext` из `packages/rules/dist/index.js`, запускает два последовательных прогона на fixture-сайте и проверяет findings SEO-модуля.

Параметры: `dangerouslyAllowLoopback: true`, `maxPages: 50`, `plan: 'Complete'`.

**Результаты:**

| Проверка | Результат |
|---|---|
| `findings` непусты | ✅ pass — 34 findings |
| `SEO-ONPAGE-001` для `/no-title.html` | ✅ pass |
| `SEO-TECH-004` для `/wrong-canonical.html` | ✅ pass |
| Все fingerprints начинаются с `fluxradar-fp-v1:` | ✅ pass — 34/34 |
| Fingerprints уникальны (нет дублей) | ✅ pass — 34 уникальных |
| Повторный прогон: идентичное множество fingerprints | ✅ pass — run1=run2=34 |

Findings по правилам (прогон 1, 17 страниц, 165 applicableChecks):

| ruleId | Затронутые URL |
|---|---|
| SEO-TECH-003 | /missing |
| SEO-TECH-004 | /broken-image.html, /broken-link.html, /deep/, /deep/level2/page.html, /dup-a.html, /dup-b.html, /empty.html, /form.html, /mixed-content.html, /no-title.html, /noindex.html, /orphan.html, /redirect-a, /trackers.html, /wrong-canonical.html |
| SEO-TECH-005 | /redirect-a |
| SEO-TECH-006 | /broken-link.html |
| SEO-TECH-007 | (site-level) |
| SEO-TECH-008 | /noindex.html |
| SEO-TECH-013 | /mixed-content.html |
| SEO-ONPAGE-001 | /no-title.html |
| SEO-ONPAGE-002 | /deep/level2/page.html, /dup-a.html, /dup-b.html, /empty.html, /form.html, /mixed-content.html, /no-title.html, /noindex.html, /orphan.html, /redirect-a |
| SEO-ONPAGE-003 | /empty.html |
| SEO-ONPAGE-005 | /broken-image.html |

---

## Вердикт

**PASS** — все 5 шагов пройдены без ошибок. `packages/rules`: lint чист, типы верны, сборка успешна, 53 теста зелёные (5 файлов: engine/evidence, engine/run-module, seo/seo-tech, seo/seo-onpage, seo/seo-module.integration), smoke-тест подтверждает корректную работу движка и SEO-правил на fixture-сайте: 34 findings с уникальными fingerprints `fluxradar-fp-v1:*`, детерминизм двух независимых прогонов, правильный ruleId для `/no-title.html` (SEO-ONPAGE-001) и `/wrong-canonical.html` (SEO-TECH-004).
