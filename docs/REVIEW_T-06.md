# REVIEW_T-06 — Code Review: БД и биллинг (apps/api)

**Дата:** 2026-09-03
**Ревьювер:** review-агент
**Объект:** `apps/api/prisma/schema.prisma`, `apps/api/src/billing/` (state-machine, webhook-handler, refund, cancel-scan, resolve-outcome, paddle-signature, webhook-schema, dev-checkout), `apps/api/src/db.ts`, `apps/api/src/test-utils/`
**Вердикт:** APPROVED WITH FIXES — 1 high-пробел покрытия закрыт (+5 тестов монотонности refunded), 2 minor-фикса; кодовых ошибок critical/high не найдено. 27 → 32 теста.

---

## Итоговый вердикт

Реализация точно следует контракту §18: все переходы state machine закодированы в `SCAN_TRANSITIONS` и исполняются атомарным CAS через `updateMany`, retry-инварианты встроены в WHERE самого CAS (D-133), idempotency contract полностью выражен unique-констрейнтами схемы, webhook работает в одной `$transaction` с dedup-insert. Единственная high-находка — путь `transaction.refunded` (`processRefunded`) не был покрыт ни одним тестом, хотя «out-of-order не откатывает состояние» — явный критерий T-06. Тесты добавлены; они прошли на нетронутом коде, то есть поведение было корректным, но не зафиксированным.

---

## Сверка state machine с таблицей §18 (план, строки 1110–1122)

| §18: состояние → переход | Условие §18 | Реализация | Статус |
|---|---|---|---|
| `Pending` → `Queued` \| `Cancelled` | ровно один атомарный CAS; `paid` webhook с проверенными signature/amount/currency/priceId; user cancel до queue | `SCAN_TRANSITIONS.Pending = ['Queued','Cancelled']`; `transitionScan` = CAS `updateMany({id, status: from})`; webhook создаёт скан только после HMAC + zod + `findPriceMismatch`; `cancelScan` пишет reason `UserCancelledPreQueue` только из CAS `Pending → Cancelled` (D-132) | ✅ |
| `Queued` → `Running` \| `Cancelled` | worker claim атомарен, ровно один worker; стоп после queue без refund | CAS: из 5 конкурентных claims побеждает ровно 1 (BILLING-004); `cancelScan` Queued-ветка возвращает `refund: null` | ✅ |
| `Running` → `Completed` \| `Partial` \| `Failed` \| `Cancelled` | результат пишется один раз; стоп после старта — использованный прогон | все 4 перехода в таблице; `resolveScanOutcome` терминализирует через CAS (второй вызов на терминальном скане — `InvalidTransitionError`); `cancelScan` Running-ветка без refund | ✅ |
| `Partial` → `Running` (один retry) \| terminal | retry не создаёт платёж и не продлевает entitlement | CAS с `moduleRetryCount < 1` в WHERE + `increment` в той же операции (D-133); entitlement не изменяется; `startedAt` исходный сохраняется | ✅ |
| `Failed` → `Queued` (один platform retry) \| billing `Refunded` | platform fault: retry без доплаты, затем полный refund | CAS с `platformRetryCount < 1` + `increment`; `PLATFORM_FAILURE_AFTER_RETRY` требует `Failed` **и** `platformRetryCount >= 1` | ✅ |
| `Cancelled` — terminal | refund только при отмене до `Queued` или platform fault | `SCAN_TRANSITIONS.Cancelled = []`; `PRE_QUEUE_CANCEL` policy требует `Cancelled` + reason `UserCancelledPreQueue` (доказуемость D-132) | ✅ |
| `Completed` → billing `Refunded` только по policy | обычный пользовательский refund не разрешён | `SCAN_TRANSITIONS.Completed = []` (scan неизменен); refund из Completed возможен только с `LEGAL_SUPPORT` | ✅ |
| `Refunded` — billing-состояние, не scan terminal | — | `Refunded` живёт только в `Purchase.status`; `Scan.status` нигде не принимает 'Refunded' (проверено grep + тест «scan stays Pending») | ✅ |
| Monotonic / event ID ordering | старое событие не откатывает состояние; повтор не создаёт второй entitlement/scan/refund/retry | unique `paddleEventId` (dedup-insert в транзакции), dedup по `paddleTransactionId`, `NOT: {status: Refunded}`-guard в `processRefunded`; **было без тестов — H-1, закрыто** | ✅ (после фикса) |

## Сверка idempotency contract §18

| Требование | Реализация | Статус |
|---|---|---|
| unique `paddle_transaction_id` → ровно один `purchase_id` | `Purchase.paddleTransactionId @unique`; гонка P2002 → один повтор транзакции → dedup-ветка (D-134) | ✅ |
| unique(`purchase_id`) → один entitlement и один scan | `Entitlement.purchaseId @unique`; `Scan.purchaseId String? @unique` (nullable для Free, D-131) | ✅ |
| dedup `paddle_event_id`, insert + side effects в одной транзакции | `WebhookEvent.paddleEventId @unique`; `$transaction(processEvent)`: create event → create Purchase/Entitlement/Scan/Job; P2002 по eventId → `storedResult` без side effects | ✅ |
| `platform_retry_count <= 1`, `module_retry_count <= 1` | guard в WHERE CAS + `increment` атомарно; в т.ч. in-run retry `resolveNoUsableOutput` инкрементирует тот же `moduleRetryCount` (D-133) | ✅ |
| refund: `refund:{purchase_id}`, один refund независимо от reason code | `RefundRecord.purchaseId @unique` + `idempotencyKey @unique`; повтор (и с другим reason) возвращает сохранённую запись; P2002-гонка обработана | ✅ |
| reason code — закрытый enum | `REFUND_REASON_CODES` в contracts; `RefundReasonCode` — union-тип параметра | ✅ |
| повтор webhook refund возвращает сохранённый статус | guard `status in (requested, processing)` при переводе в `paid`; redelivery → dedup | ✅ |
| для refund сохраняются transaction/event id, signature, amount и т.д. | `WebhookEvent.rawBody + signature` (D-029) + `RefundRecord` (reasonCode, status, amountUsd, requestedAt) | ✅ |

## Безопасность

- **Timing-safe подпись:** `timingSafeEqual` после проверки длины; HMAC-SHA256 по raw body (D-029). ✅
- **Недоверие полям:** zod-схема на весь payload; `amount/currency/priceId` сверяются с `TARIFFS` **до** любых side effects (для `transaction.paid`; refunded не проверяется — задокументированное D-134, сумма может включать налог). Site profile проверяется на принадлежность account. ✅
- **SQL:** только Prisma-API, `$queryRaw*` не используется. ✅
- **Секреты:** `PADDLE_WEBHOOK_SECRET` из env, fail-loud при отсутствии; `.env.example` содержит ключ без значения; в коде секретов нет (`TEST_WEBHOOK_SECRET` — тестовая константа). ✅
- **rawBody для dispute:** сохраняется вместе с подписью в `WebhookEvent` (§18/D-029). ✅

## Конкурентность

- CAS через `updateMany({where: {id, status: from, <retry guard>}})` — корректный примитив: `count === 1` ровно у одного победителя (BILLING-004: 1 из 5).
- Webhook-транзакция действительно атомарна: dedup-insert и все side effects в одном `$transaction`; при откате по P2002-transactionId событие-неудачник переигрывается целиком и записывается по dedup-ветке (событие не теряется — проверено BILLING-003).
- Гонка P2002 различает `paddleEventId` (→ stored result) и `paddleTransactionId` (→ один повтор, затем rethrow); цикл ограничен (`attempt === 1`).
- PostgreSQL: connection pool остаётся управляемым через `DATABASE_URL`; CAS и dedup используют транзакции Prisma.

## Проблемы и исправления

### H-1 (HIGH, тестовое покрытие) — путь `transaction.refunded` не был покрыт ни одним тестом [ИСПРАВЛЕНО]

**Описание.** `processRefunded` (монотонный перевод purchase → `Refunded`, guard `requested/processing → paid`, out-of-order refunded-до-paid) не исполнялся ни в одном тесте — grep по `*.test.ts` не находил ни `refunded`, ни `Refunded`. Критерий T-06 «out-of-order не откатывает состояние» и пункт §18 про monotonic ordering оставались незафиксированными: регрессия (например, откат `Refunded → paid` поздним paid-событием или второй RefundRecord) прошла бы CI.

**Исправление.** Добавлен describe `BILLING-003 monotonic refunded event ordering` (+5 тестов, отдельная изолированная БД) в `apps/api/src/billing/billing-003-transaction-unique.test.ts`:
1. refunded после paid → purchase `Refunded`, scan-состояние не тронуто (Refunded — billing, не scan state), entitlement один;
2. stale/duplicate paid после refunded → dedup, `Refunded` не откатывается, счётчики 1/1/1;
3. redelivery refunded (тот же eventId) → no-op, событие в dedup-таблице один раз;
4. полный E2E §18 «отмена до Queued»: checkout → `cancelScan` (refund `requested`) → refunded webhook → `paid`; второй refunded-webhook ничего не меняет (одна запись, статус `paid`);
5. out-of-order refunded-до-paid → событие сохранено без side effects; поздний paid создаёт обычный `paid`-purchase (документированное поведение D-134, зафиксировано тестом).

Все 5 прошли на нетронутом коде — поведение было корректным; тесты не тавтологичны (ассертят состояние БД, а не возвращаемое значение хендлера).

### M-1 (MEDIUM) — `cancelScan`: CAS и создание refund не в одной транзакции [Задокументировано]

**Описание.** В pre-queue-ветке `Pending → Cancelled` (CAS) и `requestRefund` — два отдельных вызова. Crash между ними оставит скан `Cancelled` + reason `UserCancelledPreQueue` без RefundRecord.

**Оценка.** Восстановимо без потери денег: `requestRefund(purchaseId, 'PRE_QUEUE_CANCEL')` идемпотентен, а policy-проверка по statusReason (D-132) пройдёт при повторе. §18 требует создать refund request «не позднее 1 рабочего дня», а не атомарно. Рекомендация T-12: обернуть ветку в `$transaction` (сигнатуры уже принимают `DbClient`).

### M-2 (MEDIUM) — конкурентная двойная резолюция может пропустить внешний retry [Задокументировано]

**Описание.** Два конкурентных `resolveScanOutcome` по одному Running-скану с нулём usable-модулей: первый забирает retry-бюджет (`moduleRetryCount 0→1`, `ExternalRetryGranted`), второй видит `count === 0` и немедленно терминализирует `Failed` + refund — retry фактически не состоится.

**Оценка.** Резолюцию вызывает только worker, владеющий сканом; claim атомарен и выдаётся одному worker (D-005/D-133), поэтому двойная резолюция возможна лишь при баге воркера, и даже тогда инварианты денег не нарушаются (retry ≤ 1, refund ≤ 1). Рекомендация T-07: вызывать `resolveScanOutcome` только держателем claim.

### L-1 (LOW) — индекс Issue под запросы `scanId+fingerprint` [ИСПРАВЛЕНО]

`@@index([scanId])` заменён на составной `@@index([scanId, fingerprint])` (leftmost prefix покрывает прежние запросы по `scanId`); `@@index([fingerprint])` для кросс-скан истории issue оставлен.

### L-2 (LOW) — хардкоды в test-utils [ИСПРАВЛЕНО]

`test-db.ts`: цены `120/55` и строка `'rules-mvp-0.1'` заменены на `TARIFFS[plan].priceUsd` и `RULESET_VERSION` из contracts — сид не разъедется с тарифной матрицей.

### L-3 (LOW) — `deduplicated: false` у повторного refunded с новым eventId [Принято как есть]

Поле информационное, side effects отсутствуют (monotonic guard), webhook в T-12 в любом случае ответит 200. Семантику можно уточнить при подключении реального Paddle.

### L-4 (LOW) — RefundRecord `failed` не переводится в `paid` повторным webhook [Принято как есть]

Guard намеренно узкий (`requested/processing`); ресабмит после `failed` — ручной кейс поддержки, вне объёма MockPaddle.

### L-5 (LOW) — forward-константы [Принято как есть]

`PURCHASE_STATUSES.disputed`, `JOB_STATUSES.claimed/done` пока не используются — заготовки под Disputed-overlay и worker-очередь (T-07/T-12); Disputed не входит в критерии BILLING-001..006.

## Верификация: что работает корректно

- **Схема:** все unique-констрейнты idempotency contract на месте (`paddleTransactionId`, `Entitlement.purchaseId`, `Scan.purchaseId` nullable-unique, `paddleEventId`, `RefundRecord.purchaseId` + `idempotencyKey`, `Job.scanId`, `ScanModule (scanId, module)`).
- **Timestamps:** `Queued → Running` ставит `startedAt`; `Partial → Running` сохраняет исходный `startedAt`; `Failed → Queued` сбрасывает оба; терминальные ставят `completedAt`.
- **NoUsableOutput (D-026/D-027):** completed-модуль без валидного metric/score/finding (`usableOutput=false`) попадает в NoUsableOutput-ветку; полностью Not-applicable модули не блокируют `Completed` и не считаются usable; Free-скан без purchase падает без refund.
- **Ошибки:** иерархия `BillingError` с машинными кодами; ничего не глотается (`tryCancel` осознанно сужает до `InvalidTransitionError` и пробрасывает остальное).
- **Качество:** все файлы ≤ 253 строк; мёртвого кода нет (кроме forward-констант L-5); `console.log` отсутствует.
- **Тесты не тавтологичны:** BILLING-001 ассертит отсутствие side effects при reject; 002/003 — реальные гонки через `Promise.all`; 004 — CAS 1-из-5; 005 — негативные policy-кейсы; 006 — обе ветки retry-cap.

## Изменённые файлы

- `apps/api/src/billing/billing-003-transaction-unique.test.ts` — +5 тестов монотонности refunded (H-1);
- `apps/api/prisma/schema.prisma` — составной индекс `Issue(scanId, fingerprint)` (L-1);
- `apps/api/src/test-utils/test-db.ts` — `TARIFFS`/`RULESET_VERSION` вместо хардкодов (L-2).

## Команды

```
pnpm --filter @fluxradar/api test   # 7 файлов, 32 passed (было 27)
pnpm lint                           # чисто
pnpm typecheck                      # все пакеты Done
```
