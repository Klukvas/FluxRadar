# REVIEW_T-15 — integration gates

**Дата:** 2026-09-03  
**Ревьювер:** Codex coordinator  
**Вердикт:** ✅ **APPROVED**

Интеграционный слой подтверждает связку API → worker → crawler/rules/GEO →
score → Issue Center → export. Complete fixture scan выдаёт issues, dashboard
и JSON/CSV; перед отдачей export route запускает schema и semantic validator.

Проверены отдельными сценариями:

- один Free scan и повторный отказ;
- Complete happy path с доступным fixture-site;
- Basic happy path с отказом Complete-only export;
- unreachable paid scan: один retry, затем `Failed` и
  `EXTERNAL_NO_USABLE_OUTPUT` refund;
- expiry gate для module retry;
- исчезнувший fingerprint → `Resolved`, возвращённый fingerprint → `Reopened`.

Webhook duplicate, out-of-order и concurrent delivery, atomic claim и refund
idempotency остаются покрытыми BILLING-001..006 из T-06 и входят в общий gate.

