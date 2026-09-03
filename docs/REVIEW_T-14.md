# REVIEW_T-14 — web screens

**Дата:** 2026-09-03  
**Ревьювер:** Codex coordinator  
**Вердикт:** ✅ **APPROVED**

`apps/web/src/App.tsx` содержит рабочие экранные состояния:

- login/register;
- desktop с профилями и запуском проверки;
- new scan с Free/Basic/Complete, scope и AI consent;
- polling scan progress с terminal log и cancel;
- results dashboard со score, coverage и module status;
- Issue Center с поиском и изменением пользовательских статусов;
- Complete-only JSON/CSV export;
- `#styleguide`.

API boundary вынесен в `apps/web/src/api.ts`: credentials, JSON envelope и CSV
ответ обрабатываются единообразно. Basic UI явно сообщает, что export доступен
только для Complete; Free использует отдельный one-time endpoint.

Ограничение v0.1 — навигация сделана компактным screen state вместо отдельного
router-пакета; это не меняет API-контракт и соответствует локальному scope.

