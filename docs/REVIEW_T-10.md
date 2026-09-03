# REVIEW_T-10 — Review: packages/ai (adapter-контракт §5, MockAiProvider, caps/quota/consent, GEO ×5)

**Дата:** 2026-09-03
**Ревьювер:** review-агент T-10
**Объект:** `packages/ai/src/` — types, errors, consent, quota, redaction, prompt-builder,
request-key, response-contract, mock-provider, run-request, geo-findings, geo-rules,
geo-module, index (+ testing/harness, 10 тест-файлов)
**Контекст:** план §5 (adapter contract, caps 8000/2000, truncation, redaction fail-closed,
consent per-scan), §15 (GEO score_delta=0), §18 (ai_request_key, retry); IMPLEMENTATION_PLAN
(ai/GEO); D-008, D-015, D-107, D-109, D-171..D-176.
**Вердикт:** **APPROVED WITH FIXES** — 1 HIGH (GEO-VIS-004 false positive на подстроке
домена) и 1 MEDIUM (redaction-маркеры выталкивали prompt за input cap → ложный
ProviderContract-отказ) исправлены с регрессионными тестами; 6 LOW приняты с фиксацией
трактовок. Тесты расширены с 95 до 100. Решения D-177..D-179.

---

## Итоговый вердикт

Пакет выполнен на уровне T-08/T-09: маленькие файлы (< 270 строк), strict TS без `any`,
иммутабельный квота-трекер, типизированные ошибки, импорты `.js` (NodeNext), единственная
зависимость `@fluxradar/contracts`. Ключевые контракты плана проверены по коду и тестам:

- **Pipeline D-175** — порядок consent → buildPrompt (truncation) → redaction (fail-closed) →
  quota reserve → provider.send → §5-валидация → quota commit выдержан дословно в
  `run-request.ts`; после ревью дополнен шагом re-cap после redaction (D-177, см. M-1).
- **Pre-response отказ** (§5) — ConsentMissing / RedactionBlocked / QuotaExceeded возвращают
  `AiUnavailableOutcome` ДО обращения к провайдеру: тесты с counting-провайдером ассертят
  `calls() === 0`, `quota` — тот же объект (spent 0, outstanding 0), материала ai_response нет.
  Consent чужого скана трактуется как отсутствие записи («несоответствие записи блокирует
  запрос», §5) — есть отдельный тест.
- **Quota 50/500** (§18) — лимиты читаются из `TARIFFS` contracts (Free 0 / Basic 50 /
  Complete 500), не хардкод. Retry с тем же `ai_request_key` бесплатен: reserve уже
  reserved/committed ключа — идентичный объект-состояние (проверено `toBe`). Ошибка
  провайдера и ответ вне контракта → release резерва (квота не течёт); неожиданное
  исключение провайдера → release + `AiModuleError` наверх (баг интеграции, не ветка §5).
- **ai_request_key (D-015)** — `ai:{scan_id}:{provider}:{prompt_hash}:{sequence}`, hash от
  точного redacted-текста, ушедшего провайдеру (D-175; после фикса M-1 — от финального
  re-capped текста). В fingerprint GEO findings не входит (отдельное поле, D-176).
- **Truncation §5** — порядок секций prompt-а = приоритет выживания (system → вопрос →
  факты бренда → заголовки), хвост режется по границе токена approx-v1 (4 chars/token),
  маркер `[TRUNCATED]` и его перевод строки входят в бюджет, итог ровно ≤ cap
  (математика keepChars даёт ровно 32 000 chars = 8000 tokens). Детерминизм проверен
  byte-в-byte (`Buffer.equals`).
- **Output cap** — mock усекает output по той же границе токена (общая константа
  `CHARS_PER_TOKEN`, D-172), `finish_reason='length'` и при собственном усечении, и при
  provider-side `incomplete/max_output_tokens`.
- **Normalized contract §5** — `validateNormalizedResponse` проверяет runtime-значения:
  `total = input + output` (дословно §5; mock всегда пересчитывает), caps, enum-поля,
  ISO-8601 UTC `createdAt`, `tokenizerVersion` при `usageSource=estimated`. Ответ вне
  контракта → release + outcome ProviderContract (не fail-open данные).
- **Redaction fail-closed** — исключение и timeout (инъектируемые часы) → RedactionBlocked;
  audit — только счётчики типов (включая нули), исходные значения не возвращаются; в
  сообщениях ошибок пакета секретов нет (проверено по всем конструкторам ошибок);
  evidence GEO-правил строится из ответа провайдера, который секретов не видел.
- **MockAiProvider детерминизм (D-173)** — содержимое только из фикстур; `createdAt` из
  `created_at` фикстуры либо из инъектируемых часов с фиксированным дефолтом
  2026-01-01T00:00:00Z; локальный request id — sha256(sequence:prompt) в форме UUID.
  `Date.now` в пакете встречается один раз — дефолтные часы deadline-а redaction
  (тайминг, не содержимое). Byte-идентичность повторных вызовов покрыта тестами.
- **GEO ×5 (D-171/D-176)** — informational: severity `null`, scoreDelta `0` гарантированы
  билдером `geoFinding` по построению; метаданные — только из реестра contracts;
  normalizedUrl='' (D-019), normalizedParameter=`q<sequence>`, evidence ≤ 2048 code points
  (§16). Обе ветки found/not-found каждого правила покрыты. `runGeoModule` (D-174):
  Completed / Partial (сводка отказов) / Unavailable (reason первого отказа,
  EmptyQuestionLibrary для пустой библиотеки); Unavailable-модуль — без findings и без
  ai_response-материала.
- **Совместимость** — `@fluxradar/contracts` (43) и `@fluxradar/rules` (109) зелёные;
  сборка и lint корня проходят.

---

## Таблица находок

| # | Severity | Файл | Описание | Статус |
|---|---|---|---|---|
| H-1 | high | `packages/ai/src/geo-rules.ts` | GEO-VIS-004: substring-матч домена в rawText давал false positive «ссылка на сайт есть» на чужом hostname, содержащем домен как подстроку (`notfluxradar.test`, `fluxradar.test.evil.com`) → finding подавлялся. Подтверждено probe-тестом до фикса | **fixed** (D-178, +2 теста) |
| M-1 | medium | `packages/ai/src/run-request.ts`, `prompt-builder.ts` | Redaction-маркеры `[REDACTED:<type>]` длиннее заменённых значений выталкивали prompt за input cap 8000 tokens: estimated-путь мока получал ложный `ProviderContract`-отказ (подтверждено probe-тестом), реальный адаптер отправил бы over-cap запрос вопреки §5 «adapter обязан передать caps». Известное ограничение исполнителя; фикс дешёвый и безопасный — сделан | **fixed** (D-177, +3 теста) |
| L-1 | low | `redaction.ts` | Generic `[A-Fa-f0-9]{32,}` ловит и SHA/контент-хэши. Трактовка: допустимая перередакция публичного контента при fail-closed позиции, не дефект | accepted (D-179) |
| L-2 | low | `redaction.ts` | Deadline проверяется между паттернами, не внутри одного regex-exec (в JS regex непрерываем). Все 6 паттернов линейны, катастрофического backtracking нет | accepted (D-179) |
| L-3 | low | `redaction.ts` | Полный список §5 включает phone/session IDs; scope T-10 по TASK_BOARD — email/JWT/API-key/cookie (auth-header и private-ip реализованы сверх). Phone — при переходе на real-адаптеры | accepted (D-179) |
| L-4 | low | `consent.ts` | `AiConsent` несёт минимум для гейта (scanId/providers/noticeVersion); полный consent evidence §5 (consent_id, account_id, timestamp UTC, версии Terms/privacy policy) — персистентность T-12, пакет проверяет ровно то, что может проверить | accepted |
| L-5 | low | `prompt-builder.ts` | Срез по UTF-16 code units может разрезать суррогатную пару на границе truncation → U+FFFD при UTF-8-кодировании. Детерминировано, cap соблюдён; приемлемо для approx-v1 | accepted |
| L-6 | low | `mock-provider.ts` | Provider-declared `output_tokens` сверх cap клампится `Math.min` (а input_tokens сверх cap — contract violation): лёгкая асимметрия нормализации. Mock-only, оба пути дают валидный §5-ответ | accepted |

Дополнительно проверено (проблем нет): cost guard денежный отсутствует — соответствует
D-008/mock-only (счётная квота есть); никаких HTTP-клиентов в пакете; `testing/harness`
исключён из сборки (`tsconfig.build.json`), в публичный `index.ts` не экспортируется.

---

## Внесённые исправления

### H-1 — GEO-VIS-004: граничный матчинг домена (D-178)

`geo-rules.ts`: substring-проверка `rawText.includes(domain)` заменена на
`textMentionsDomain` — regex с границами hostname:

- слева запрещён `[a-z0-9-]` (отсекает `notsite.com`, `evil-site.com`);
- справа запрещён `[a-z0-9-]` и продолжение `.` + буквенно-цифровой
  (отсекает `site.community` и `site.com.evil`);
- поддомен слева (`docs.site.com`) и точка конца предложения (`site.com.`) остаются
  легальным упоминанием; регистр — флаг `i`; домен regex-экранируется.

Citations как и раньше сравниваются по распарсенному hostname (равенство/dot-suffix).
Регрессионные тесты: `not<domain>` + `<domain>.evil.com` → finding; `www.<domain>` и
`<DOMAIN>.` (uppercase, конец предложения) → без finding.

### M-1 — Re-cap prompt-а после redaction (D-177)

`prompt-builder.ts`: truncation-математика вынесена в экспортируемую `enforceInputCap`
(та же формула keepChars/маркер; `buildPrompt` теперь использует её).
`run-request.ts`: после `redact(...)` вызывается `enforceInputCap(redacted.text)`;
`ai_request_key`, `provider.send` и `promptText` outcome используют финальный текст;
`inputTruncated = prompt.truncated || capped.truncated`. Повторный срез безопасен —
секреты уже заменены маркерами, раскрытия нет. Порядок D-175 уточнён:
consent → buildPrompt (cap) → redaction → **re-cap** → quota reserve → send.

Тесты: юниты `enforceInputCap` (под cap без изменений; сверх cap — ровно cap, маркер,
детерминизм) + pipeline-тест: prompt, полный email-ов, после redaction остаётся ≤ cap,
outcome `response` (до фикса — `unavailable/ProviderContract`), usage.inputTokens ≤ 8000,
ключ считается от финального текста.

---

## Результаты проверок

| Команда | Результат |
|---|---|
| `pnpm --filter @fluxradar/ai test` | ✅ 10 файлов, **100 тестов** (было 95, +5 регрессионных) |
| `pnpm --filter @fluxradar/ai typecheck` | ✅ |
| `pnpm --filter @fluxradar/ai build` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm --filter @fluxradar/contracts test` | ✅ 43 теста |
| `pnpm --filter @fluxradar/rules test` | ✅ 109 тестов |

## Остаточные риски

- Redaction v1 покрывает перечисленные паттерны; phone/session-id и более строгий
  «неуверенный secret-like» детектор — обязательное условие включения real-адаптеров
  (AI-001 sign-off), не v0.1 (D-179).
- `AiConsent` — гейт, а не evidence record; T-12 обязан сохранять полный consent
  evidence §5 при персистентности.
- approx-v1 tokenizer — приближение (4 chars/token); реальные адаптеры потребуют
  pinned tokenizer провайдера (§5), что зафиксировано в контракте `usageSource`/
  `tokenizerVersion` и не меняет форму API.
