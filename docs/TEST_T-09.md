# TEST T-09 — rules: passive-модули (SEC/REL/A11Y/CONTENT/PRIVACY)

**Дата:** 2026-09-03  
**Вердикт: ✅ PASS**

---

## 1. Статические проверки

| Команда | Результат |
|---|---|
| `pnpm lint` | ✅ pass (0 ошибок) |
| `pnpm typecheck` | ✅ pass (все 10 пакетов) |
| `pnpm -r build` | ✅ pass (все артефакты собраны) |

## 2. Тест-сьют

```
pnpm test (workspace)
```

| Пакет | Файлов | Тестов | Статус |
|---|---|---|---|
| packages/contracts | 5 | 43 | ✅ pass |
| packages/fingerprint | 2 | 56 | ✅ pass |
| packages/scoring | 5 | 61 | ✅ pass |
| packages/safe-fetch | 3 | 84 | ✅ pass |
| packages/crawler | 4 | 33 | ✅ pass |
| packages/rules | **11** | **109** | ✅ pass |
| apps/api | 7 | 32 | ✅ pass |
| packages/ai | 1 | 1 | ✅ pass |
| packages/export | 1 | 1 | ✅ pass |

packages/rules: 109 тестов — юниты 14 правил (5 модулей) + интеграция на fixture-сайте.

## 3. Независимый smoke (node-скрипт из /tmp)

Импорт из dist: `@fluxradar/crawler` (startFixtureSite, crawl), `@fluxradar/rules` (runModuleRules, createSiteContext), `@fluxradar/safe-fetch` (HostLimiter).

**Crawl:** 17 страниц fixture-сайта.

| Проверка | Результат |
|---|---|
| Security — findings по headers (SEC-PASSIVE-002) | ✅ 16 findings (на 16 HTML-страницах с 2xx) |
| Privacy — findings на /trackers.html | ✅ 2 findings (PRIVACY-001 + PRIVACY-003) |
| PRIVACY-003 evidence содержит `stats.example.com` | ✅ |
| Content Quality — finding на /empty.html | ✅ (CONTENT-003, <200 символов) |
| Accessibility — finding на /form.html | ✅ A11Y-004, selector: `input[name="nickname"]` |
| Reliability — 0 findings (все URL доступны) | ✅ |

**Fingerprints уникальны в каждом модуле:**

| Модуль | Findings | Дубли |
|---|---|---|
| Security | 17 | 0 |
| Privacy | 3 | 0 |
| Content Quality | 5 | 0 |
| Accessibility | 2 | 0 |
| Reliability | 0 | — |

**Coverage (applicableChecks = completedApplicableChecks):**

| Модуль | Checks |
|---|---|
| Security | 33 / 33 |
| Privacy | 33 / 33 |
| Content Quality | 32 / 32 |
| Accessibility | 32 / 32 |
| Reliability | 51 / 51 |

## 4. Замечания

- HSTS (SEC-PASSIVE-003): Not applicable на http fixture-сайте — `applicableTargets=0`, findings нет. Поведение соответствует D-162.
- 14 правил реализованы в 5 модулях: Security (3), Reliability (5), Accessibility (2), Content Quality (2), Privacy (2).
- Движок расширен: `ApiRule`/`apiChecks` (§9), `evidenceGroupId` (§14, D-167).
- Решения: D-160..D-170.
