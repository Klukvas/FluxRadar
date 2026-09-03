# REVIEW_T-09 — Review: packages/rules (passive-модули: SEC/REL/A11Y/CONTENT/PRIVACY, 14 правил)

**Дата:** 2026-09-03
**Ревьювер:** review-агент T-09
**Объект:** `packages/rules/src/{security,reliability,accessibility,content,privacy,shared}/` + изменения движка (`engine/types.ts` — ApiRule/apiChecks, `engine/evidence-group.ts`, `engine/finding.ts` — apiFinding, `engine/run-module.ts`, `engine/site-context.ts`, `registry.ts`, `seo/seo-onpage-005.ts`, `testing/fixture-harness.ts`) + 30 fx-фикстур
**Контекст:** план §6, §8–§11, §9 Reliability contract v1, §14 cross-module policy; D-023, D-025, D-026, D-160..D-169; REVIEW_T-08.
**Вердикт:** APPROVED WITH FIXES — 1 HIGH (FP PRIVACY-003 на собственных поддоменах) и 1 LOW (FP PRIVACY-001 на сравнении `document.cookie`) исправлены, тесты расширены со 107 до 109, добавлено D-170.

---

## Итоговый вердикт

Passive-модули сделаны в том же качестве, что и T-08. Ключевые контракты плана выполнены:

- **REL-API-003 / §9 verdict precedence** — единственная точка матчинга `isExpectedStatus`
  (api-checks.ts): фактический статус ∈ явного `expected_status` → pass, включая ожидаемые
  3xx/404/5xx; без явного списка — любой 2xx. Фикстуры закрывают оба края критерия T-09:
  «ожидаемый 404 → pass» (negative) и «неожиданный 404 → finding» (positive).
- **REL-API-005 no-credentials** — severity **High** из реестра (не хардкод); детекция по
  ИМЕНАМ заголовков (`authorization`/`cookie`/`proxy-authorization` + паттерны
  api-key/token/secret), значения не читаются и не логируются — тест ассертит отсутствие
  `Bearer` и значения токена в excerpt. Заблокированная проверка исключается из applicable
  REL-API-003 (вердикта по статусу у невыполненного запроса нет) — есть отдельный тест.
- **SEC-PASSIVE-005** — `parseSetCookie` возвращает только имя и имена атрибутов; значение
  куки в evidence не попадает никогда (тест: `abc123` отсутствует). Сплиттер склеенного
  Set-Cookie не режет запятую внутри Expires (тест с датой RFC 1123).
- **SEC-PASSIVE-003 HSTS** — applicable только для https-origin (`ctx.domain.startsWith('https://')`);
  http-сайт → Not applicable 0/0 (D-162), интеграция на loopback-http это подтверждает,
  оракул закрыт юнитами с https-моками (positive/negative/max-age=0/http-N/A).
- **evidence_group_id (§14, D-167)** — `computeFingerprint` принимает фиксированные 8 полей,
  `evidenceGroupId` в них не входит физически; scoring читает `ScoredFinding` структурно —
  лишнее поле на score не влияет. Тесты (юнит + интеграция): у A11Y-002 и SEO-ONPAGE-005
  общий `evg-v1:`-id и разные fingerprint.
- **Движок не сломал T-08** — `ApiRule` добавлен третьей веткой `evaluateRule`, page/site-пути
  не тронуты; полный прогон `pnpm --filter @fluxradar/rules test`: 11 файлов, 109 тестов
  (включая все тесты T-08 и литеральные fingerprint-хэши) — зелёные.

Найден один high — false positive PRIVACY-003: поддомены собственного сайта
(`cdn.example.com` при сайте `example.com`) считались third-party (трактовка была
зафиксирована в D-169, но это ложный сигнал на самом распространённом сетапе со своим
статик/CDN-поддоменом). Исправлено + 1 low (PRIVACY-001 матчил сравнение
`document.cookie === ...` как присваивание). Оба фикса — с регрессионными тестами, D-170.

---

## Таблица правил (правило → оракул → вердикт)

| Правило | Оракул (как реализован) | Вердикт |
|---|---|---|
| SEC-PASSIVE-002 security headers | 2xx-HTML без nosniff / framing-защиты (XFO ЛИБО CSP frame-ancestors) / непустого Referrer-Policy → 1 finding на страницу, resource=`security-headers` (D-160) | ✅; не-HTML/не-2xx скипается (`isSuccessfulHtmlPage`; краулер кладёт `html: null` при не-`text/html`) |
| SEC-PASSIVE-003 HSTS | site-level; только https-origin (http → N/A 0/0, D-162); homepage без HSTS либо без положительного max-age (max-age=0 = отсутствие) → finding; нет снимка homepage → applicable без finding | ✅; юниты на https-моках, интеграция подтверждает N/A на loopback-http |
| SEC-PASSIVE-005 cookie-атрибуты | каждая кука из Set-Cookie без Secure/HttpOnly/SameSite → finding, parameter = имя куки; значение куки в evidence не попадает (D-161) | ✅; applicable — любой HTTP-ответ (куки бывают на не-HTML); Expires-запятая не режет |
| REL-URL-001 availability | fetchError любого рода → fail-finding c `targetUnreachable: true` (D-026); applicable — ВСЕ снимки (проверка недостижимого URL завершена вердиктом fail, coverage не занижается, D-163) | ✅; High из реестра |
| REL-URL-003 4xx/5xx | финальный ≥ 500 → fail-finding; неожиданный 4xx — warning-verdict §9, scored finding не создаётся (D-163; evidence 4xx уже несёт SEO-TECH-003) | ✅; negative-фикстура содержит и 200, и 404 |
| REL-URL-009 response time | `timingMs > 1800` строго → finding; ровно 1800 — норма | ✅; boundary-фикстура 1800/1801 |
| REL-API-003 expected status | applicable — выполненные проверки с чистыми заголовками; статус ∈ expected → pass (ожидаемый 404 — pass), вне списка → finding; без списка — любой 2xx; parameter = метод (D-164) | ✅; §9 precedence — точное соответствие плану |
| REL-API-005 no-credentials | applicable — все сконфигурированные проверки; credentials по именам заголовков → High-finding; выполненный вопреки policy запрос отмечается в excerpt; значения не логируются | ✅; parameter = первый offending заголовок |
| A11Y-002 alt-тексты | `<img>` без alt (пустой alt="" — норма) → 1 finding на страницу; общий `evidenceGroupId('img-alt')` с SEO-ONPAGE-005 (§14, D-167) | ✅; те же findings, разные fingerprint — по политике |
| A11Y-004 form labels | input/select/textarea без label[for]/обёртки/aria-label/aria-labelledby → finding на элемент; hidden/submit/button/reset/image не требуют label; placeholder — не подпись (D-168); дубли селекторов схлопываются | ✅; negative-фикстура покрывает все 4 способа связи + hidden/submit |
| CONTENT-003 малосодержательные | видимый текст body (без script/style, collapse whitespace, code points) < 200 строго → finding; ровно 200 — норма (D-166); обход без мутации кэшированного DOM | ✅; boundary 199/200; script-текст не считается |
| CONTENT-004 битые media | media со снимком 4xx/5xx/fetchError/text/html → confidence 1; внутренняя media без снимка → confidence 0.6 «не подтверждён обходом»; внешняя без снимка не оценивается (D-165) | ✅; признанный trade-off D-165: живой pixel.png на fixture-сайте попадает в unconfirmed-перечень |
| PRIVACY-001 cookies | Set-Cookie и/или присваивание document.cookie в inline-скрипте → 1 finding на страницу; evidence http/dom/mixed; значения кук не логируются (D-169) | ✅ после фикса L-1 (сравнение `===` больше не маркер, D-170) |
| PRIVACY-003 third-party scripts | `<script src>` с чужим hostname → 1 finding, отсортированные домены в excerpt; normalized-поля пусты (fingerprint стабилен при смене CDN, D-169) | ✅ после фикса H-1 (поддомены своего сайта — не third-party, D-170) |

Severity всех 14 правил — из реестра contracts (`requireDescriptor` + `ruleById` в движке);
интеграционный тест дополнительно ассертит severity по правилам.

---

## Проверка по чек-листу

| Пункт | Результат |
|---|---|
| REL-API-003: expected-status precedence §9 (ожидаемый 404/3xx/5xx → pass) | ✅ `isExpectedStatus`; фикстуры: ожидаемый 404 → pass, неожиданный 404 → finding, default 2xx |
| REL-API-005: High, значения секретов не в evidence | ✅ реестр High; детекция по именам; тест `not.toContain('Bearer')` |
| SEC-PASSIVE-005 не логирует значения cookies | ✅ `parseSetCookie` не возвращает value; тест `not.toContain('abc123')` |
| HSTS applicability: https-only | ✅ D-162; http → 0/0; юниты — https-моки, интеграция — N/A |
| evidence_group_id вне fingerprint и score | ✅ фиксированные 8 полей `computeFingerprint`; тесты: общий id, разные fingerprint; scoring структурно игнорирует поле |
| FP: SEC-002 на не-HTML ответах | ✅ скипается: `isSuccessfulHtmlPage` требует `html !== null`, краулер пишет `html: null` при не-`text/html` (crawler.ts:292) |
| FP: CONTENT-003 на страницах-редиректах | ✅ не FP: safe-fetch раскручивает цепочку, снимок несёт финальный 2xx-ответ цели; 3xx-статус финальным не бывает → редирект-стабы не оцениваются. Alias-URL с коротким контентом цели даёт второй finding на свой normalizedUrl — принятая трактовка (это контент, отдаваемый по этому URL) |
| FP: PRIVACY-003 — поддомены собственного сайта | ❌ был FP (D-169 «поддомены тоже чужие») → **H-1, исправлено** (D-170) |
| FP: A11Y-004 на input type=hidden | ✅ hidden (и submit/button/reset/image) в `NO_LABEL_INPUT_TYPES`; negative-фикстура содержит hidden+submit |
| REL-URL-009 boundary | ✅ строгий `>` 1800; boundary-фикстура 1800 (норма) / 1801 (finding) |
| Движок: ApiRule/apiChecks/evidenceGroupId не сломали T-08 | ✅ полный прогон: 11 файлов, 109 тестов (все T-08 включая литеральные fingerprint) — pass; page/site-ветки движка не изменены |
| Интеграционные ожидания точны | ✅ `toEqual` на полный `{ruleId → paths[]}` каждого модуля; coverage-счётчики пересчитаны в комментарии (33/51/32/32/33) и совпадают; уникальность fingerprint по всем 5 модулям |
| Юниты не тавтологичны | ✅ все через реальный движок (`runModuleRules` + фильтр); ассерты на поведение (excerpt/parameter/selector/агрегаты), не на внутренности |
| Фикстуры по D-025 | ✅ 30 файлов `fx-<RULE>-{positive,negative,boundary}`; boundary там, где числовой порог (REL-URL-009, CONTENT-003); прочие — positive+negative |
| severity из реестра, файлы < 400 строк | ✅ max 205 строк (integration-тест), max правило — 115 (content-004); severity только через descriptor |
| Секреты не утекают в evidence | ✅ SEC-005/PRIVACY-001 — только имена кук; REL-API-005 — только имена заголовков. Ограничение: секрет, встроенный в сам URL api-проверки (`?api_key=...`), попал бы в evidence — §9 запрещает credentials только в заголовках, отмечено как известное ограничение v0.1 |

---

## Проблемы и исправления

### H-1 (HIGH) — PRIVACY-003: false positive на поддоменах собственного сайта [ИСПРАВЛЕНО]

**Описание.** `thirdPartyScriptHosts` сравнивал host скрипта только с host страницы на
строгое равенство: `cdn.example.com` при сайте `example.com` (или скрипт с apex при странице
на `www.`) помечался third-party. D-169 фиксировал это как трактовку («v0.1 не ведёт
allowlist»), но собственный статик/CDN-поддомен — самый распространённый сетап: правило
выдавало бы ложный privacy-сигнал почти каждому реальному сайту, а PRIVACY-003 — scored.

**Исправление.** «Свой» hostname — равен hostname страницы или сайта (`ctx.domain`) либо
связан с ним поддоменной цепочкой (dot-suffix в любую сторону); сравнение по hostname,
порт стороны не различает. Без PSL registrable-суффиксы не выделяются (родительский хост
платформы тоже свой) — осознанный trade-off, зафиксирован как **D-170**. Регрессионный
тест: `cdn.fixture.test` не в excerpt, `stats.example.com` — в excerpt. Fingerprint-контракт
D-169 (пустые normalized-поля) не затронут; интеграция не изменилась (единственный внешний
скрипт fixture-сайта — `stats.example.com`).

### L-1 (LOW) — PRIVACY-001: сравнение `document.cookie === ...` считалось присваиванием [ИСПРАВЛЕНО]

**Описание.** Regex `document\.cookie\s*=\s*...` матчил первый `=` из `==`/`===` — inline-скрипт,
*читающий* куку (типичный consent-баннер: `if (document.cookie === '') ...`), давал ложный
маркер `document.cookie` в инвентаризации.

**Исправление.** Negative lookahead: `document\.cookie\s*=(?!=)\s*...`. Тест: страница со
сравнением не даёт findings. Включено в **D-170**.

---

## Замечания без фикса (принятые трактовки)

- **REL-URL-003 молчит на неожиданный 4xx** — warning-verdict §9 не рождает scored finding
  (D-163), evidence 4xx уже несёт SEO-TECH-003. У REL-API-003 неожиданный 4xx *даёт* finding —
  это не противоречие: для явно сконфигурированной проверки несовпадение с expected — сам
  сигнал правила (D-164), как и превышение порога у REL-URL-009.
- **CONTENT-004 unconfirmed media** — живой `/img/pixel.png` попадает в excerpt рядом с
  битым `/img/missing.png` (confidence 0.6): краулер v0.1 media не фетчит, деривативно их не
  различить — признанный trade-off D-165, устраняется media-probe в будущем релизе.
- **SEC-PASSIVE-002** засчитывает любой непустой X-Frame-Options и любой CSP с подстрокой
  `frame-ancestors` (CSP-Report-Only не учитывается) — уровень сигнала v0.1.
- **REL-API-005** не проверяет лимит 16 KB заголовков и request body (§9) — в v0.1 body
  отсутствует в типе `ApiCheck` физически, лимит заголовков — валидация конфига уровня API (T-12).
- **Дублирование `single()`-хелпера** в 5 тест-файлах — кандидат на вынос в fixture-harness
  при следующем касании; на корректность не влияет.

---

## Команды

```bash
pnpm --filter @fluxradar/rules test   # 11 файлов, 109 тестов — pass
pnpm lint                             # pass
pnpm typecheck                        # pass
pnpm -r build                         # pass
```

Изменённые при ревью файлы: `packages/rules/src/privacy/privacy-003.ts`,
`packages/rules/src/privacy/privacy-001.ts`, `packages/rules/src/privacy/privacy.test.ts`,
`docs/DECISIONS.md` (D-170), `docs/TASK_BOARD.md`.
