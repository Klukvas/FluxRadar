# TEST_T-15 — integration

**Дата:** 2026-09-03  
**Вердикт:** ✅ **PASS**

| Проверка | Результат |
|---|---|
| `apps/api/src/api.integration.test.ts` | ✅ 5 сценариев |
| `apps/api/src/orchestrator/issue-sync.test.ts` | ✅ Resolved/Reopened |
| API suite | ✅ 9 файлов, 38 тестов |
| T-06 billing suite | ✅ webhook/refund/atomic claim invariants |

Fixture scan проходит через реальный worker orchestration. Complete export
возвращает summary/module/issue records и CSV; Basic export получает 403.

