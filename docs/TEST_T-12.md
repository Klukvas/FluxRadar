# TEST_T-12 — API

**Дата:** 2026-09-03  
**Вердикт:** ✅ **PASS**

| Проверка | Результат |
|---|---|
| `pnpm --filter @fluxradar/api test` | ✅ 9 файлов, 38 тестов |
| `pnpm --filter @fluxradar/api typecheck` | ✅ |
| `pnpm lint` | ✅ |
| API build через `pnpm -r build` | ✅ |

Покрыты регистрация и сессия, tenant-scoping, один Free check на аккаунт и
публичный origin (включая межаккаунтную блокировку и конкурентный claim),
Complete и Basic checkout, worker pipeline, dashboard, Issue Center, Complete
JSON/CSV, NoUsableOutput refund, retry gate после expiry и ошибки HTTP envelope.
