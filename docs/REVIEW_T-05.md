# REVIEW_T-05 — Security Review: packages/safe-fetch

**Дата:** 2026-09-03  
**Ревьювер:** security-reviewer (агент)  
**Объект:** `packages/safe-fetch/src/` (ip-guard.ts, safe-fetch.ts, rate-limit.ts, resolver.ts, errors.ts)  
**Вердикт:** APPROVED WITH FIXES — 2 уязвимости исправлены (HIGH + MEDIUM), тесты расширены с 68 до 84.

---

## Итоговый вердикт

Архитектура SSRF-защиты грамотная: DNS-pin через lookup-callback закрывает TOCTOU, fail-closed-классификатор корректно обрабатывает все нестандартные формы IPv4 и большинство IPv6 переходных механизмов. Найдены и исправлены две пропущенных записи в blocklist IPv6-туннелей — реальные векторы обхода при управляемом DNS.

---

## Таблица векторов атак

| Вектор | Метод обхода | Результат | Статус |
|---|---|---|---|
| `http://2130706433/` | decimal IPv4 | URL-парсер нормализует → `127.0.0.1` → loopback blocker | Защищён |
| `http://0177.0.0.1/` | octal IPv4 | URL-парсер нормализует → `127.0.0.1` → loopback blocker | Защищён |
| `http://0x7f000001/` | hex IPv4 | URL-парсер нормализует → `127.0.0.1` → loopback blocker | Защищён |
| `http://127.1/` | short-form IPv4 | URL-парсер нормализует → `127.0.0.1` → loopback blocker | Защищён |
| `http://127.0.1/` | 3-octet IPv4 | URL-парсер нормализует → `127.0.0.1` → loopback blocker | Защищён |
| `fe80::1%eth0` | zone-id в DNS-ответе | `parseIpv6Words` не распознаёт `%`, возвращает null → `invalid` → blocked | Защищён |
| `[fe80::1%25eth0]` в URL | zone-id в URL | URL-парсер бросает `ERR_INVALID_URL` → `UrlValidationError` до DNS | Защищён |
| `::FFFF:127.0.0.1` (uppercase) | uppercase hex | `isIPv6` + `parseIpv6Side` regex `[0-9a-fA-F]` корректно распознают | Защищён |
| `::ffff:127.0.0.1` (IPv4-mapped) | embedded IPv4 | `classifyEmbeddedIpv4(127, 0, 0, 1)` → loopback → blocked | Защищён |
| `::ffff:169.254.169.254` | IPv4-mapped metadata | `classifyEmbeddedIpv4` → link-local → blocked | Защищён |
| `64:ff9b::0a00:0001` | NAT64 embedding 10.0.0.1 | `classifyEmbeddedIpv4` → private → blocked | Защищён |
| `64:ff9b:1::7f00:1` | NAT64 local-use (RFC 8215) + loopback | **БЫЛ PUBLIC — ИСПРАВЛЕНО** | Исправлено |
| `64:ff9b:1::a00:1` | NAT64 local-use + private (10.0.0.1) | **БЫЛ PUBLIC — ИСПРАВЛЕНО** | Исправлено |
| `64:ff9b:1::a9fe:a9fe` | NAT64 local-use + metadata (169.254.169.254) | **БЫЛ PUBLIC — ИСПРАВЛЕНО** | Исправлено |
| `2002:7f00:1::` | 6to4 embedding 127.0.0.1 | **БЫЛ PUBLIC — ИСПРАВЛЕНО** | Исправлено |
| `2002:0a00:1::` | 6to4 embedding 10.0.0.1 | **БЫЛ PUBLIC — ИСПРАВЛЕНО** | Исправлено |
| `2002:c0a8:101::` | 6to4 embedding 192.168.1.1 | **БЫЛ PUBLIC — ИСПРАВЛЕНО** | Исправлено |
| `2002:a9fe:a9fe::` | 6to4 embedding 169.254.169.254 | **БЫЛ PUBLIC — ИСПРАВЛЕНО** | Исправлено |
| `2002:0808:0808::` | 6to4 embedding 8.8.8.8 (публичный) | PUBLIC → запрос разрешён | Защищён |
| `::0102:0304` | deprecated IPv4-compatible ::/96 | `ipv4-compatible` category → blocked | Защищён |
| `::` | unspecified | `unspecified` → blocked | Защищён |
| `fc00::1`, `fd12:3456::1` | unique-local fc00::/7 | `unique-local` → blocked | Защищён |
| `fe80::1`, `febf::1` | link-local fe80::/10 | `link-local` → blocked | Защищён |
| `ff02::1` | multicast ff00::/8 | `multicast` → blocked | Защищён |
| `2001:db8::1` | documentation 2001:db8::/32 | `documentation` → blocked | Защищён |
| redirect → `169.254.169.254` | redirect SSRF | каждый hop через `resolveAndGuard` | Защищён |
| DNS rebinding (TOCTOU) | смена IP после проверки | pinnedLookup фиксирует те же адреса | Защищён |
| `dangerouslyAllowLoopback` обход | флаг пропускает non-loopback? | только `category === 'loopback'` → metadata заблокирована | Защищён |
| Body limit gzip bypass | сервер игнорирует `accept-encoding: identity` | `node:http` не декомпрессирует; байты считаются на проводе | Защищён |
| `data:`/`javascript:` в Location | нестандартная схема redirect | `validateUrl` проверяет `http:`/`https:` → `UrlValidationError` | Защищён |
| `//evil.com/` protocol-relative redirect | relative Location | `new URL(location, base)` + `validateUrl` + `resolveAndGuard` | Защищён |
| Rate-limit token leak при исключении | release не вызван | idempotent release-fn; ответственность crawler (T-07) | Задокументировано |
| Credentials leak в redirect | Authorization forwarded | см. Проблему M-2 ниже | Задокументировано |

---

## Проблемы и исправления

### H-1 (HIGH) — 64:ff9b:1::/96 не в blocklist [ИСПРАВЛЕНО]

**Описание.** RFC 8215 определяет `64:ff9b:1::/96` как «local-use» NAT64-префикс с той же семантикой вложения IPv4, что и `64:ff9b::/96`. Условие в `classifyIpv6` проверяло только `w2 === 0` (классический NAT64 `64:ff9b::/96`), но не `w2 === 0x0001` (RFC 8215). Адрес вида `64:ff9b:1::a00:1` (= 10.0.0.1) классифицировался как PUBLIC.

**Эксплуатация.** Атакующий, управляющий DNS и имеющий `64:ff9b:1::/96` маршрутизацию в целевой сети, мог направить запрос на внутренний хост.

**Исправление.** Добавлена отдельная ветка в `classifyIpv6`:
```typescript
if (w0 === 0x0064 && w1 === 0xff9b && w2 === 0x0001 && w3 === 0 && w4 === 0 && w5 === 0) {
  return classifyEmbeddedIpv4(w6, w7, 'NAT64 local-use 64:ff9b:1::/96 (RFC 8215)');
}
```
Публичный вложенный IPv4 → PUBLIC; приватный → blocked, как у `64:ff9b::/96`.

**Файл:** `packages/safe-fetch/src/ip-guard.ts`

---

### M-1 (MEDIUM) — 2002::/16 (6to4) не в blocklist [ИСПРАВЛЕНО]

**Описание.** RFC 3056 (6to4) определяет формат `2002:AA:BB:CC:DD::/48`, где `AA.BB.CC.DD` — вложенный IPv4. Адрес `2002:7f00:0001::` вложен `127.0.0.1`, `2002:0a00:0001::` — `10.0.0.1`. Ни одна ветка в `classifyIpv6` не обрабатывала `w0 === 0x2002`. Эти адреса классифицировались как PUBLIC.

**Эксплуатация.** Требует 6to4-relay инфраструктуры в целевой сети (RFC 7526 deprecated 6to4 в 2015, но поддержка встречается). При наличии relay — DNS-мок с `2002::/16` адресом мог обойти SSRF-гард.

**Исправление.** Добавлена ветка в `classifyIpv6`:
```typescript
if (w0 === 0x2002) {
  return classifyEmbeddedIpv4(w1, w2, '6to4 2002::/16 (RFC 3056)');
}
```
`w1` = верхние 16 бит IPv4, `w2` = нижние 16 бит IPv4 (по формату RFC 3056).

**Файл:** `packages/safe-fetch/src/ip-guard.ts`

---

### M-2 (MEDIUM) — Пользовательские заголовки не очищаются на redirect [Задокументировано, не исправлено]

**Описание.** `options.headers` передаются во все hop-ы redirect-цепочки без изменений. Если вызывающий код передаёт заголовок `Authorization`, он будет отправлен всем redirect-целям, включая кросс-доменные или HTTP-цели после HTTPS.

**Оценка риска для текущего use-case.** Crawler (T-07) использует `safeFetch` с заголовками вида `User-Agent`, `Accept` — без credentials. Риск реализации в текущем контексте низкий. Для generic HTTP-клиента — HIGH.

**Решение.** Задокументировать как caller-контракт в JSDoc `SafeFetchOptions.headers`. Исправление в crawler: не передавать Authorization-заголовки в `safeFetch`.

---

### L-1 (LOW) — Teredo 2001::/32 не в blocklist [Принято как есть]

**Описание.** `2001::/32` — Teredo-префикс (RFC 4380). Teredo-адреса кодируют IPv4 в специфическом формате с obfuscation (XOR). Эксплуатация требует наличия Teredo-сервера, клиентской конфигурации и специфической сетевой среды. Практическая реализуемость в облачном развёртывании минимальна.

**Решение.** Не блокировать в данной итерации; при необходимости добавить в будущем.

---

## Верификация: что работает корректно

- **IPv4 decimal/octal/hex формы** (`2130706433`, `0177.0.0.1`, `0x7f000001`, `127.1`): URL-парсер Node.js нормализует к dotted-decimal до передачи в резолвер.
- **Zone-id** (`fe80::1%eth0` из DNS): `parseIpv6Words` не распознаёт `%` в part → null → `invalid` → blocked. URL-парсер отклоняет `[fe80::1%25eth0]` как невалидный URL.
- **TOCTOU**: `pinnedLookup` использует те же адреса, что прошли через `resolveAndGuard`; DNS rebinding между проверкой и connect невозможен.
- **Redirect SSRF**: каждый redirect-hop проходит полный цикл `validateUrl → resolveAndGuard → performRequest`. Проверено тестом `redirect на metadata IP блокируется даже с dangerouslyAllowLoopback`.
- **dangerouslyAllowLoopback**: пропускает только `category === 'loopback'`; RFC1918, link-local, CGNAT и metadata блокируются даже с флагом.
- **Body limit / gzip bypass**: `node:http` не декомпрессирует автоматически; `accept-encoding: identity` устанавливается принудительно; байты считаются на проводе.
- **data:/javascript: в Location**: `validateUrl` проверяет `http:`/`https:` → `UrlValidationError`.
- **Timeout**: единственный `AbortController` на весь redirect-loop; дедлайн-приоритет корректен.
- **Rate-limit**: token bucket — корректная реализация; release идемпотентен; один timer per host; независимые лимиты по хостам.

---

## Добавленные тесты

Новые кейсы в `ip-guard.test.ts` (параметрические):
- `64:ff9b:1::808:808` → public (NAT64 local-use с публичным вложенным)
- `2002:0808:0808::` → public (6to4 с публичным вложенным)
- `64:ff9b:1::7f00:1` → loopback (NAT64 local-use + 127.0.0.1)
- `64:ff9b:1::a00:1` → private (NAT64 local-use + 10.0.0.1)
- `64:ff9b:1::a9fe:a9fe` → link-local (NAT64 local-use + 169.254.169.254)
- `2002:7f00:1::` → loopback (6to4 + 127.0.0.1)
- `2002:0a00:1::` → private (6to4 + 10.0.0.1)
- `2002:c0a8:101::` → private (6to4 + 192.168.1.1)
- `2002:a9fe:a9fe::` → link-local (6to4 + 169.254.169.254)

Именованные тесты в `ip-guard.test.ts`:
- reason для NAT64 local-use содержит вложенный IPv4 и имя префикса
- reason для 6to4 содержит вложенный IPv4 и имя префикса

Новые кейсы в `safe-fetch.test.ts`:
- NAT64 local-use с loopback вложенным → `SsrfBlockedError`
- NAT64 local-use с private вложенным → `SsrfBlockedError`
- 6to4 с loopback вложенным → `SsrfBlockedError`
- 6to4 с private RFC1918 вложенным → `SsrfBlockedError`

---

## Команды

```bash
# Тесты (68 → 84, все green)
pnpm --filter @fluxradar/safe-fetch test

# Lint
pnpm --filter @fluxradar/safe-fetch exec eslint src/

# Typecheck (весь workspace)
pnpm typecheck
```

Все три команды завершаются без ошибок.

---

## Изменённые файлы

- `packages/safe-fetch/src/ip-guard.ts` — добавлены блоки 64:ff9b:1::/96 и 2002::/16; расширен `BlockedIpCategory` двумя новыми значениями (`nat64`, `six-to-four`)
- `packages/safe-fetch/src/ip-guard.test.ts` — +9 параметрических кейса + 2 именованных теста
- `packages/safe-fetch/src/safe-fetch.test.ts` — +4 интеграционных теста на новые векторы
