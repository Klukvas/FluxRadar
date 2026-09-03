# REVIEW_T-07 — Review: packages/crawler + fixture-сайт

**Дата:** 2026-09-03
**Ревьювер:** review-агент T-07
**Объект:** `packages/crawler/src/` (crawler.ts, robots.ts, robots-host-cache.ts, scope.ts, sitemap.ts, link-extractor.ts, fixture-server.ts, types.ts) + `fixtures/site/`
**Контекст:** план §3, §25 (Scope и crawl safety), D-028, D-030, D-141..D-145.
**Вердикт:** APPROVED WITH FIXES — 1 HIGH и 3 MEDIUM исправлены, тесты расширены с 28 до 33.

---

## Итоговый вердикт

Ядро краулера сделано добротно: весь транспорт идёт через safeFetch (обходных fetch нет), `dangerouslyAllowLoopback` по умолчанию выключен, robots-парсер соответствует Google/RFC 9309 (longest-match, `*`/`$`, Allow при равной длине), дедуп на этапе enqueue, maxPages/maxDepth без off-by-one, redirect-петли гасятся лимитом redirect-ов safeFetch, HostLimiter захватывается на каждый фетч (страницы, robots, sitemap). Найдена одна дыра crawl safety (страница после redirect на чужой origin оставалась источником ссылок) и три средних несоответствия — все исправлены, на каждое добавлен регрессионный тест.

---

## Проверка по чек-листу

| Пункт | Результат |
|---|---|
| Весь трафик через safeFetch | ✅ единственный транспорт — `buildDefaultFetcher` → `safeFetch`; `fetcher` инъектируется только в тестах |
| `dangerouslyAllowLoopback` по умолчанию | ✅ `options.dangerouslyAllowLoopback ?? false` |
| Scope: чужие хосты | ✅ `isHostInScope` на enqueue; ❌ пере-проверка после redirect отсутствовала → **H-1, исправлено** |
| Path traversal fixture-server | ✅ проверено пробами (`/../`, `%2e%2e`, `..%2f`, raw-socket `../`, `//host/`): URL-парсер нормализует dot-segments (включая `%2e`-формы), backstop — `path.resolve` + prefix-check. Утечек нет |
| robots: longest-match / wildcard / `$` / tie | ✅ соответствует Google spec: длиннейший шаблон побеждает, при равной длине Allow сильнее; `*` → `[^]*`, `$` только в конце; путь сверяется с query. Матч UA — по подстроке токена (чуть лояльнее спецификации, безопасно) |
| robots: per-host | ❌ robots.txt origin-а применялся к поддомёнам → **M-3, исправлено** (ленивый per-host кэш) |
| Дедуп по normalizedUrl | ✅ на enqueue (D-142); ❌ raw-варианты дублей терялись — данных для SEO-TECH-007 «duplicate URL» не хватало → **M-2, исправлено** (`urlVariants`) |
| BFS-глубина | ✅ FIFO-очередь ⇒ первое обнаружение = минимальная глубина; origin=0, sitemap-seed=1 (D-142), фильтр `depth > maxDepth` |
| maxPages off-by-one | ✅ `pages.length >= maxPages` до фетча; снимок = фетч-попытка (D-143), robots-блок не тратит лимит |
| Sitemap-лимит | ❌ лимит 1000 применялся к каждому sitemap отдельно, а не суммарно (D-142) → **M-4, исправлено**; ❌ child-URL из sitemapindex не проверялись по scope → **M-1, исправлено** |
| HostLimiter реально используется | ✅ `acquire/release` вокруг каждого фетча (страницы + robots/sitemap через `fetchThrottled`); release в `finally` |
| Авто-throttle 5xx | ✅ D-144: ≥5 последовательных 5xx → стоп хоста, сброс не-5xx, только фетчи страниц, всё в `errors` |
| Redirect-петли A→B→A | ✅ safeFetch: `maxRedirects=5` (D-028) → `RedirectLimitError` → снимок с `fetchError`; ссылочные циклы гасятся `seen` |
| Тесты: детерминизм/изоляция | ✅ порт динамический, ожидания строятся от `site.origin`; обход последовательный ⇒ порядок стабилен; сравнение — сортированные наборы; смоук: два прогона идентичны |
| Качество | ✅ файлы ≤ 374 строк (robots-кэш вынесен в отдельный модуль); ошибки не глотаются: сетевые — в `errors`, «мусор веба» (кривые ссылки, недоступный sitemap) осознанно тих (D-142) с комментариями |

---

## Проблемы и исправления

### H-1 (HIGH) — страница после redirect на чужой origin оставалась источником ссылок [ИСПРАВЛЕНО]

**Описание.** `processEntry` извлекал ссылки из `snapshot.html` без проверки, куда увёл redirect. safeFetch легально следует redirect-ам на любой публичный хост, поэтому чужая страница (например, `evil.test`) могла инжектировать в обход абсолютные ссылки на наш origin. Воспроизведено мок-fetcher-ом: `/offsite` → 301 → `evil.test/landing`, ссылка `http://site.test/injected-from-evil` попадала в очередь и фетчилась. Нарушение плана §25 («в один прогон попадает только один основной домен и явно разрешённые поддомены»).

**Исправление.** `mayUseAsLinkSource(finalUrl)`: host `finalUrl` пере-проверяется через `isHostInScope`; чужая страница остаётся снимком-evidence (redirectChain нужен SEO-TECH-005), но ссылки из неё не извлекаются; событие логируется. Тест: `crawler-safety.test.ts` («чужая страница остаётся снимком-evidence, но не источником ссылок»).

### M-1 (MEDIUM) — sitemapindex мог увести фетч на чужой host [ИСПРАВЛЕНО]

**Описание.** `fetchSitemapUrls` скачивал child-sitemap-ы из sitemapindex без проверки хоста: враждебный/кривой индекс мог заставить краулер фетчить чужие домены (scope-утечка; SSRF-гард safeFetch защищает только от приватных IP). Фильтр по scope применялся только к кандидатам из robots-директив.

**Исправление.** `fetchSitemapUrls` получил предикат `isSitemapUrlAllowed`, применяемый и к корневому, и к каждому child-URL до фетча; краулер передаёт `isSitemapInScope`. Тест: `sitemap.test.ts` («чужой host в sitemapindex не фетчится…») — проверяет и результат, и отсутствие самого фетча.

### M-2 (MEDIUM) — терялись raw-варианты дублей URL (данные для SEO-TECH-007) [ИСПРАВЛЕНО]

**Описание.** Дедуп на enqueue молча отбрасывал повторные raw-формы одного normalizedUrl (`/dup-a.html` и `/dup-a.html?utm_source=y`). Для правила «duplicate URL» (T-08, SEO-TECH-007) краулер не оставлял никаких данных о том, что страница обнаружена под несколькими URL.

**Исправление.** `CrawlResult.urlVariants: Record<normalizedUrl, rawVariants[]>` — копится на enqueue после scope-фильтров, в результат попадают только ключи с ≥2 вариантами, варианты отсортированы (детерминизм). Дубли по-прежнему не фетчатся. Тест: `crawler.test.ts` («urlVariants: raw-варианты дубликата собраны…»).

### M-3 (MEDIUM) — robots.txt origin-а применялся к поддоменам [ИСПРАВЛЕНО]

**Описание.** По RFC 9309 robots.txt действует только на свой host. При `includeSubdomains=true` пути поддоменов проверялись по robots основного хоста, а собственный robots.txt поддомена игнорировался — краулер мог фетчить то, что поддомен запретил («robots.txt соблюдается по умолчанию», план §3/§25).

**Исправление.** Новый модуль `robots-host-cache.ts`: ленивый кэш `RobotsHostCache` (один фетч на `protocol//host`, политика D-141: 200 → парсинг, не-200 → открыт, сетевая ошибка → `errors` + открыт). Sitemap-директивы и `result.robotsTxt` по-прежнему берутся из robots origin-а; robots-фетчи не тратят maxPages и не участвуют в 5xx-throttle (D-143/D-144). Тест: `crawler-safety.test.ts` («поддомен блокируется собственным robots.txt…»).

### M-4 (MEDIUM) — sitemap-лимит 1000 не был суммарным [ИСПРАВЛЕНО]

**Описание.** D-142 фиксирует «суммарный лимит 1000 URL», но при нескольких Sitemap-директивах в robots.txt каждый кандидат получал собственный лимит `SITEMAP_MAX_URLS` — суммарно можно было насобирать N×1000 seed-ов.

**Исправление.** `loadSitemaps` передаёт в каждый вызов остаток бюджета (`SITEMAP_MAX_URLS - collected.length`) и останавливается при исчерпании. Тест: `crawler-safety.test.ts` («лимит применяется ко всем sitemap-ам вместе…»).

### Замечания без изменений кода

- **L-1** — матч User-agent-токена по подстроке (`includes`), а не по префиксу product token. Лояльнее спецификации в сторону соблюдения robots — принято как есть.
- **L-2** — `urlVariants` может содержать ключ, отсутствующий в `pages` (вариант глубже maxDepth либо цель redirect-а, помеченная посещённой). Для SEO-TECH-007 консумер (T-08) должен джойнить по `normalizedUrl`/`finalUrl` — задокументировано в `types.ts`.
- **L-3** — D-141 стоит дополнить: robots теперь per-host (ленивый кэш), поведение origin-а не изменилось. Оставлено имплементационному агенту при следующем обновлении DECISIONS.md.

---

## Смоук-прогон

Скрипт: поднять fixture-сайт → два независимых `crawl` → сравнить наборы.

Результат: **17 страниц**, `blockedByRobots: [/private/secret.html]`, `errors: []`, 3 sitemap-seed-а (включая `/orphan.html` без входящих ссылок), utm-дубли не фетчились, `urlVariants` содержит ровно `/dup-a.html` с двумя raw-вариантами. **Два прогона идентичны** (стабильность не зависит от порта/порядка).

Пробы path traversal fixture-server (`/../package.json`, `..%2f`, `%2e%2e/`, `%2e%2e%2f`, raw-socket `GET /../…`, `//host/…`) — все 404, утечек нет.

---

## Команды

```bash
pnpm --filter @fluxradar/crawler test   # 4 файла, 33 теста — pass
pnpm lint                               # pass
pnpm typecheck                          # pass (все пакеты)
pnpm --filter @fluxradar/crawler build  # pass
```

## Изменённые файлы

- `packages/crawler/src/crawler.ts` — H-1 (link-source гард), M-2 (`urlVariants`), M-4 (суммарный sitemap-бюджет), переход на `RobotsHostCache`.
- `packages/crawler/src/robots-host-cache.ts` — новый: per-host кэш robots.txt (M-3).
- `packages/crawler/src/sitemap.ts` — M-1: предикат `isSitemapUrlAllowed` для root/child sitemap-URL.
- `packages/crawler/src/types.ts` — `CrawlResult.urlVariants` (+doc для T-08).
- `packages/crawler/src/crawler-safety.test.ts` — новый: тесты H-1, M-3, M-4.
- `packages/crawler/src/crawler.test.ts` — тест `urlVariants`.
- `packages/crawler/src/sitemap.test.ts` — тест фильтра child-sitemap.
