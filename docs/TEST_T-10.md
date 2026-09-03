# TEST T-10 — ai: adapter-контракт, MockAiProvider, caps/quota/consent

**Дата:** 2026-09-03  
**Вердикт: ✅ PASS**

---

## 1. Команды и результаты

| Команда | Результат | Время |
|---|---|---|
| `pnpm --filter @fluxradar/ai test` | ✅ pass — 10 файлов, 100 тестов | 477 ms |
| `pnpm test` (workspace) | ✅ pass — все пакеты, exit 0 | ~8 s |
| `pnpm lint` | ✅ pass (0 ошибок, exit 0) | 1.5 s |
| `pnpm typecheck` | ✅ pass (все 10 проектов, exit 0) | 4.3 s |
| `pnpm -r build` | ✅ pass (все артефакты, exit 0) | 4.0 s |

## 2. Тест-сьют workspace (`pnpm test`)

| Пакет | Файлов | Тестов | Статус |
|---|---|---|---|
| packages/contracts | 5 | 43 | ✅ pass |
| packages/fingerprint | 2 | 56 | ✅ pass |
| packages/scoring | 5 | 61 | ✅ pass |
| packages/safe-fetch | 3 | 84 | ✅ pass |
| packages/crawler | 4 | 33 | ✅ pass |
| packages/rules | 11 | 109 | ✅ pass |
| **packages/ai** | **10** | **100** | ✅ pass |
| apps/api | 7 | 32 | ✅ pass |
| packages/export | 1 | 1 | ✅ pass |
| apps/web | 0 | 0 (`--passWithNoTests`) | ✅ pass |

Итого: **519 тестов**, из них 100 — юниты T-10 (types/errors/consent/quota/redaction/
prompt-builder/request-key/response-contract/mock-provider/run-request/geo-*/index).
T-10 соседей не ломает: contracts/api и остальные пакеты зелёные.

## 3. Смоук-сценарии (node-скрипт из /tmp, импорт из `packages/ai/dist/index.js`)

Используемый API: `runGeoModule`, `MockAiProvider`, `geoVisibilityFixtures`,
`AiQuotaTracker.withLimit`. Файлы в репозиторий не добавлялись.

### A. Consent → response-outcomes, 5 GEO-правил, детерминизм
- 2 запроса (вопрос с брендом + «alternatives»), plan Basic, consent покрывает `openai`.
- Результат: `status=Completed`, `statusReason=null`, оба outcome `kind=response`.
- Оценены ровно 5 правил: GEO-PROVIDER-001, GEO-VIS-003, GEO-VIS-004, GEO-METHOD-002, GEO-METHOD-005.
- `findings=2`, `quota.spent=2`, `outstanding=0`.
- Два независимых прогона: `JSON.stringify({findings, evaluations, responses})` байт-в-байт идентичны. ✅

### B. Без consent → модуль Unavailable, квота 0
- `consent: null` → `status=Unavailable`, `statusReason=ConsentMissing`.
- `responses=0` (нет материала ai_response record), `evaluations=0`, `findings=0`.
- `quota.spent=0`, `outstanding=0` — провайдер не вызывался, квота не тронута. ✅

### C. Quota limit 1 + два разных вопроса
- `AiQuotaTracker.withLimit(1)`: первый запрос → `response`, второй → `unavailable`
  с `reason=QuotaExceeded`.
- Модуль агрегирует по контракту: `status=Partial`,
  `statusReason="1 of 2 AI requests unavailable (QuotaExceeded)"`.
- `quota.spent=1`, `outstanding=0`. ✅

### D. Redaction: email/JWT не уходят провайдеру
- В brandFacts вложены реальный email и JWT (3 base64url-сегмента).
- Spy-обёртка над `MockAiProvider.send` перехватила точный `promptText`, ушедший провайдеру:
  исходных секретов в нём **нет**, присутствуют маркеры `[REDACTED:email]` и `[REDACTED:jwt]`.
- `promptText` в `AiResponseOutcome` совпадает с перехваченным текстом (хранится redacted input).
- Audit-счётчики: `redaction.email=1`, `redaction.jwt=1` — без исходных значений. ✅

Вывод скрипта: `T-10 SMOKE: all scenarios passed` (exit 0).

## 4. Вердикт

**✅ PASS** — 100/100 юнитов пакета, 519/519 по workspace, lint/typecheck/build чистые,
4/4 смоук-сценария подтверждают инварианты §5: consent-гейт до провайдера, квота
не списывается при отказе, Partial-агрегация при QuotaExceeded, fail-closed redaction.
Аномалий не обнаружено.
