# TEST_T-03 — Результаты локального тестирования

Дата: 2026-09-03

## Команды и результаты

| # | Команда | Результат |
|---|---------|-----------|
| 1 | `pnpm lint` | PASS |
| 2 | `pnpm typecheck` | PASS |
| 3 | `pnpm -r build` | PASS |
| 4 | `pnpm test` | PASS (13 файлов, все тесты прошли) |
| 5а | `computeFingerprint` golden-вектор V1 | PASS |
| 5б | `normalizeUrl` нормализация | PASS |
| 5в | `normalizeUrl` идемпотентность | PASS |

## Детали шага 4 (pnpm test)

- packages/contracts: 5 файлов, 43 теста — PASS
- packages/fingerprint: 2 файла, 56 тестов — PASS
- Остальные пакеты: по 1 файлу, 1 тесту — PASS
- apps/web: тестов нет (passWithNoTests) — PASS

## Детали шага 5 (node /tmp/test-fingerprint.mjs)

- (а) `computeFingerprint` вернул `fluxradar-fp-v1:cedea5e5a080e49706f18ac36d631a7606633029022b18dbe5a2eaaa3803f4a4` — совпадает с ожидаемым
- (б) `normalizeUrl('https://Example.com:443/a/../b/?utm_source=x&b=2&a=1#frag')` → `https://example.com/b/?a=1&b=2` — совпадает
- (в) Повторный вызов на результате вернул то же значение — идемпотентность подтверждена

## Вердикт

**PASSED**
