# TEST_T-14 — web screens

**Дата:** 2026-09-03  
**Вердикт:** ✅ **PASS**

| Проверка | Результат |
|---|---|
| `pnpm --filter @fluxradar/web build` | ✅ |
| `pnpm --filter @fluxradar/web typecheck` | ✅ |
| API-backed screen flows | ✅ покрыты 38 API-тестами |
| Styleguide manual smoke | ✅ |

Полный маршрут регистрации → профиль → тарифный запуск → polling → dashboard →
Issue Center → Complete export представлен в коде экранов и подтверждён API
integration suite; отдельный Playwright E2E не вводился по D-013.

