# REVIEW_T-08 — Review: packages/rules (движок + 13 SEO-правил)

**Дата:** 2026-09-03
**Ревьювер:** review-агент T-08
**Объект:** `packages/rules/src/` (engine/{types,finding,evidence,run-module,site-context,descriptor}.ts, registry.ts, seo/*.ts, testing/fixture-harness.ts) + `fixtures/fx-*`
**Контекст:** план §4, §14 (fingerprint, поля issue), §15/§16; D-016, D-019, D-025, D-121, D-150..D-156.
**Вердикт:** APPROVED WITH FIXES — 1 HIGH и 2 MEDIUM (+1 LOW) исправлены, тесты расширены с 52 до 53, добавлено D-157.

---

## Итоговый вердикт

Движок и правила сделаны аккуратно: fingerprint строится единственным вызовом `computeFingerprint`
из T-03 со всеми 8 полями в порядке §14 (site-level → `normalized_url` = '' по D-019 — двойная
защита в `siteFinding` и в `fingerprintFor`), дедуп Issue-кандидатов по полному fingerprint внутри
модуля (ruleId в составе fingerprint даёт rule-namespace, D-156), applicable/affected — агрегаты
уровня правила, одинаковые у всех findings одного `ruleId` (D-016/D-121), coverage-счётчики
учитывают fetchError-снимки как applicable-но-не-completed (D-156, закрывает дыру «лежащий сайт →
coverage 1» из D-026), evidence-обрезка — по Unicode code points (астральные пары не рвутся).
Severity/scoring везде из реестра contracts (`requireDescriptor`/`ruleById`), хардкодов нет. HTML
парсится один раз на снимок (WeakMap-кэш в `parsePage`), site-индексы (ссылки/sitemap) — один раз
на CrawlResult. Оракулы всех 13 правил детерминированы и зафиксированы комментариями + D-150..D-155.

Найден один high — false positive TECH-013 на protocol-relative `//host` при http-странице —
и два medium (совместимость со scoring не проверялась фактическим импортом; normalized*-поля
finding не проходили normalizeField до записи). Всё исправлено, на каждое — регрессионная защита.

---

## Таблица правил (правило → оракул → вердикт)

| Правило | Оракул (как реализован) | Вердикт |
|---|---|---|
| SEO-TECH-001 robots.txt | site-level; finding, если нет ни `ctx.robotsTxt`, ни `crawl.robotsTxt` (краулер кладёт только при HTTP 200, D-141); контент не валидируется (D-150) | ✅ детерминирован; evidence http; 1/1 |
| SEO-TECH-002 sitemap.xml | site-level; finding при `crawl.sitemapUrls` пуст — недоступный/невалидный/пустой sitemap неразличимы (D-150) | ✅; evidence http; 1/1 |
| SEO-TECH-003 HTTP status | page-level; финальный статус ≥ 400 → finding; applicable — любой HTTP-ответ; fetchError → незавершённый check | ✅; 3xx не бывает финальным (safe-fetch раскручивает цепочку) |
| SEO-TECH-004 canonical | отсутствует / не резолвится в http(s) / чужой host (www ≠ apex, D-151); другой path/query/scheme того же host — НЕ finding | ✅; canonical с query не даёт FP (сравнение только host) |
| SEO-TECH-005 redirect chains | ≥ 2 hop-ов → finding (boundary: ровно 2 — finding); RedirectLimitError → finding с `targetUnreachable` (вход D-026) | ✅; маркер `redirect limit` совпадает с сообщением safe-fetch |
| SEO-TECH-006 битые ссылки | `<a href>` на цель со снимком и финальным статусом ≥ 400 → finding на источнике; без снимка/с fetchError — не оценивается (D-152) | ✅; ссылка на redirect 3xx→200 НЕ finding (статус снимка — финальный 200); дедуп href на странице |
| SEO-TECH-007 дубли URL | site-level; каждая группа `crawl.urlVariants` (≥2 raw-варианта) → finding, parameter = normalizedUrl группы (различает fingerprint-ы при пустом url D-019) | ✅; сортировка групп — детерминизм; affected 1/1 при любом числе групп (D-150) |
| SEO-TECH-008 noindex | finding только при противоречии: noindex (meta robots noindex/none ИЛИ X-Robots-Tag) + (в sitemap ИЛИ внешние внутренние ссылки, self не в счёт) (D-153) | ✅; просто noindex — не finding; при обоих сигналах evidence dom |
| SEO-TECH-013 mixed content | https-страница + http-субресурс; http-страница + http-субресурс чужого host (D-154); субресурсы: img/script/iframe[src], link[href] c resource-rel | ✅ после фикса H-1 (protocol-relative на http-странице исключён, D-157) |
| SEO-ONPAGE-001 title | первый `<title>`: пуст/отсутствует или длина вне 10–70 code points после trim; границы включительны (D-155) | ✅; boundary-фикстура ровно 10 симв. проверена пересчётом |
| SEO-ONPAGE-002 meta description | первый `<meta name=description>`: пуст/отсутствует или вне 50–160; границы включительны (D-155) | ✅; boundary ровно 50 симв. проверена пересчётом |
| SEO-ONPAGE-003 H1–H6 | нет h1 / h1 > 1 / пропуск уровня вверх; все нарушения — один finding на страницу; понижение уровня — норма (D-155) | ✅; «нет h1» на почти пустой странице — осознанный оракул D-155 (fixture `/empty.html`), не FP |
| SEO-ONPAGE-005 image alt | `<img>` без атрибута alt; пустой alt="" — норма; один finding на страницу, selector — первый нарушитель (D-155) | ✅ |

Все 13 правил берут severity/scoring из реестра contracts; confidence по умолчанию 1 (детерминированные
DOM/HTTP-оракулы, без эвристик) с валидацией диапазона 0..1 в билдере — разумно для v0.1.

---

## Проверка по чек-листу

| Пункт | Результат |
|---|---|
| fingerprint: computeFingerprint, 8 полей, порядок §14 | ✅ единственная точка — `fingerprintFor` (run-module.ts); поля передаются объектом `FingerprintFields`, порядок фиксирует T-03 |
| site-level → normalized_url = '' (D-019) | ✅ `siteFinding` пишет '' + `fingerprintFor` принудительно обнуляет для `site`/`environment`; тест ассертит `normalizedUrl === ''` и пересчитывает fingerprint независимо |
| Дедуп по fingerprint в module/rule namespace | ✅ `dedupByFingerprint` (первый побеждает) на уровне модуля; ruleId в составе fingerprint исключает межправиловые коллизии; сырые findings остаются в `RuleEvaluation` |
| applicable/affected по D-121 | ✅ агрегаты уровня правила у всех findings одного ruleId; page: affected = уникальные normalizedUrl findings; site: 1/1; scoring-валидация «site-level = 1/1» проходит |
| coverage: fetchError → applicable-not-completed | ✅ `unreachableOutside` в `evaluatePageRule`; юнит-тест 25/15 + интеграция 165/165; исключение — RedirectLimitError, который TECH-005 берёт в работу (completed) |
| evidence excerpt ≤ 2048 code points | ✅ `truncateExcerpt` по `[...text]`; тесты: астральные симв., ровно лимит, длинный TECH-007 |
| IssueCandidate ↔ ScoredFinding | ❌ не проверялось фактическим импортом → **M-1, исправлено**: devDep `@fluxradar/scoring` + компайл- и рантайм-тест `computeModuleScore(result.findings)` |
| severity из реестра, не хардкод | ✅ `requireDescriptor` при создании правила + `ruleById` в движке (throw при отсутствии); тесты ассертят severity по реестру |
| FP: TECH-004 canonical с query | ✅ не FP — сравнивается только host (D-151), query/path/scheme свободны |
| FP: ONPAGE-003 на странице без контента | ✅ принятый оракул D-155 («нет h1» — нарушение); подтверждено интеграцией (`/empty.html`) |
| FP: TECH-013 protocol-relative `//host` | ❌ был FP в ветке http-страницы → **H-1, исправлено** (D-157) |
| FP: TECH-006 ссылка на redirect 3xx→200 | ✅ не FP — `PageSnapshot.status` — статус финального ответа; интеграция подтверждает (ссылка `/redirect-a` с index не даёт finding) |
| Фикстуры действительно позитив/негатив | ✅ вскрыты все 29: boundary-строки пересчитаны по code points (title 10, description 50 — ровно на границе); негативы TECH-013 (https/relative/protocol-relative + canonical-http как не-субресурс), TECH-008 (noindex без противоречия), TECH-005 (1 hop) — по краю оракула |
| Интеграция: точный набор findings | ✅ `toEqual` на полный `{ruleId → normalizedUrl[]}` (12 правил, 34 finding-а), уникальность fingerprint-ов, счётчики coverage, длина 34 |
| Literal fingerprints | ✅ TECH-001, TECH-013, ONPAGE-001 — литеральные хэши; TECH-007 — независимый пересчёт `computeFingerprint`; после фикса M-2 не изменились (доказывает, что значения уже были нормализованы) |
| Сверка с fixture-сайтом краулера | ✅ пропущенных findings нет: trackers.html — все субресурсы https (не TECH-013); broken-image `/img/missing.png` — img, не `<a>` (D-152); `/private/secret.html` robots-blocked — снимка нет; dup-b — один raw-вариант (не группа); 15 страниц без canonical → 15 TECH-004 |
| Качество: файлы < 400 строк, чистые функции | ✅ max 116 строк (seo-tech-013); правила — чистые функции от (page, ctx); ошибки не глотаются (throw при неизвестном модуле/правиле/confidence вне 0..1) |
| Дублирование парсинга DOM | ✅ HTML парсится 1 раз на снимок (WeakMap в `parsePage`); site-индексы — 1 раз на CrawlResult; ❌ `pageLinks` считался дважды (TECH-006 + internalLinkSources) → **L-1, кэш добавлен** |

---

## Проблемы и исправления

### H-1 (HIGH) — TECH-013: false positive на protocol-relative `//host` при http-странице [ИСПРАВЛЕНО]

**Описание.** В ветке (b) D-154 (http-страница + http-ресурс чужого host) `isInsecure` смотрел
только на резолвнутый URL: `//cdn.example/pic.png` на http-странице резолвится в
`http://cdn.example/...` → чужой host → finding. Но protocol-relative URL наследует схему
страницы: при переходе сайта на https он автоматически станет https — «сломаться при миграции»
(единственное обоснование ветки (b) в D-154) ему нечем. Рекомендация самого правила прямо
предлагает protocol-relative как корректный вариант — правило противоречило собственному тексту.
Для v0.1 это боевой кейс: fixture-сайт живёт на loopback-http.

**Исправление.** `isInsecure` в ветке http-страницы пропускает refs с `rawUrl.startsWith('//')`
(на https-странице такой ref резолвится в https и в mixed-content-ветку не попадает по
определению). Зафиксировано как **D-157**. Тест: расширен кейс «http-страница» в
`seo-tech.test.ts` — protocol-relative внешняя картинка больше не даёт finding, явный
`http://outside.example` — даёт.

### M-1 (MEDIUM) — совместимость IssueCandidate ↔ ScoredFinding не проверялась импортом [ИСПРАВЛЕНО]

**Описание.** Контракт T-08 → T-04 («IssueCandidate совместим со ScoredFinding») держался только
на структурном сходстве: `@fluxradar/scoring` не был даже devDependency пакета rules — дрейф типа
в scoring (переименование поля, ужесточение) не ломал бы ни typecheck, ни тесты rules.

**Исправление.** `@fluxradar/scoring` добавлен в devDependencies; в `run-module.test.ts` — тест
с компайл-тайм присваиванием `const scored: readonly ScoredFinding[] = result.findings` и
рантайм-вызовом `computeModuleScore(scored)` (заодно проверяет, что site-level агрегаты 1/1
проходят валидацию scoring и penalty начисляется).

### M-2 (MEDIUM) — normalized*-поля finding не проходили normalizeField до записи [ИСПРАВЛЕНО]

**Описание.** `fingerprintFor` нормализовал resource/selector/parameter (`normalizeField`: trim →
NFC → CRLF→LF) только на входе хэша, а в `IssueCandidate` (→ issue record T-11/T-12) уходили
сырые значения из правила. Правило, отдавшее значение с NFD/краевым пробелом, породило бы record,
чьи normalized*-поля не совпадают байт-в-байт со входом fingerprint — независимый пересчёт
fingerprint по record дал бы другой хэш (риск ложных Resolved/Reopened).

**Исправление.** `buildFinding` (engine/finding.ts) применяет `normalizeField` к
resource/selector/parameter при создании finding; повторная нормализация в `fingerprintFor`
оставлена как идемпотентная защита для findings, собранных мимо билдеров. Литеральные
fingerprint-тесты не изменились — существующие правила уже отдавали нормализованные значения
(фикс закрывает будущие правила T-09).

### L-1 (LOW) — pageLinks извлекался дважды на страницу [ИСПРАВЛЕНО]

**Описание.** DOM-парсинг кэширован, но извлечение+нормализация ссылок выполнялись и в TECH-006
(по каждой странице), и в `internalLinkSources` (для TECH-008) — двойной прогон
`querySelectorAll('a')` + `normalizeUrl` на каждый снимок.

**Исправление.** WeakMap-кэш `pageLinksCache` в `site-index.ts` — извлечение один раз на снимок.

---

## Замечания без фикса (принятые трактовки)

- **ONPAGE-003 на пустой странице** — «нет h1» срабатывает и на странице почти без контента
  (`/empty.html`): осознанный оракул D-155; порог «малоценного контента» — зона CONTENT-003 (T-09).
- **TECH-002 неразличимость** «sitemap отсутствует / недоступен / пуст» — зафиксировано D-150 как
  ограничение уровня сигнала v0.1.
- **confidence = 1 у всех правил** — оправдано: все оракулы — точные DOM/HTTP-проверки без
  эвристик; при появлении эвристических правил (T-09/T-10) билдер уже валидирует диапазон.

---

## Команды

```bash
pnpm --filter @fluxradar/rules test   # 5 файлов, 53 теста — pass
pnpm lint                             # pass
pnpm typecheck                        # pass
pnpm -r build                         # pass
```

Изменённые при ревью файлы: `packages/rules/src/seo/seo-tech-013.ts`,
`packages/rules/src/engine/finding.ts`, `packages/rules/src/seo/site-index.ts`,
`packages/rules/src/engine/run-module.test.ts`, `packages/rules/src/seo/seo-tech.test.ts`,
`packages/rules/package.json` (+ `pnpm-lock.yaml`), `docs/DECISIONS.md` (D-157),
`docs/TASK_BOARD.md`.
