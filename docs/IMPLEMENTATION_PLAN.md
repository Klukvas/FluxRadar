# IMPLEMENTATION_PLAN — FluxRadar v0.1 (локальный public-only audit release)

**Основание:** `FluxRadar-Feature-Plan.md` (исходная спецификация полного релиза, не изменялась)
и результаты валидации (`docs/PLAN_REVIEW.md`). Трактовки противоречий — `docs/DECISIONS.md`.

**Цель v0.1:** локально работающая pay-per-scan платформа, реализующая все load-bearing
контракты спецификации (`fingerprint-v1`, URL-нормализация v1, score-формулы §15, scan/billing
state machine §18, export schema v1 §16) на детерминированном субсете правил `rules-mvp-0.1`,
с реальными внешними адаптерами там, где интеграция настроена, тестовыми mock-адаптерами и
честными ветками `Unavailable`, когда внешнего результата нет.

---

## 1. Стек и структура

pnpm workspaces, TypeScript strict, Vitest. Однонаправленные зависимости:

```
fluxradar/
  packages/
    contracts/      # типы, enums, zod-схемы, тарифная матрица, реестр правил rules-mvp-0.1
    fingerprint/    # URL-нормализация v1 + fingerprint-v1 (golden vectors §14 как тесты)
    scoring/        # module/overall score, coverage, статусы (golden vectors §15/§25)
    safe-fetch/     # SSRF-guard fetch: IPv4+IPv6 blocklist, redirect-контроль, лимиты D-028
    crawler/        # scope, robots.txt, sitemap, dedup по нормализованному URL, лимиты тарифа
    rules/          # rule engine + правила rules-mvp-0.1 (чистые функции над PageSnapshot)
    ai/             # adapter-контракт §5, Anthropic + MockAiProvider, caps/truncation,
                    # quota and consent
    export/         # канонические records, JSON Schema §16, semantic validator, CSV
  apps/
    api/            # Express + Prisma(PostgreSQL): auth, профили, биллинг (FastSpring),
                    # scan orchestrator + in-process worker, integrations, issues,
                    # dashboard and export API
    web/            # React + Vite, дизайн-система Mac OS 8/9 + terminal (DESIGN_SYSTEM.md)
  docs/             # статусные документы процесса
```

- `contracts` — единственный общий низ, без зависимостей.
- `fingerprint`, `scoring`, `export` — чистые пакеты без I/O, покрыты golden-фикстурами.
- Внешние сервисы только через интерфейсы: `BillingProvider` (FastSpring; MockPaddle — dev-only), `AiProvider`
  (Anthropic/Mock), OAuth connections and private object storage. Cloudflare и
  WordPress не входят в текущий scope.

## 2. Матрица scope v0.1

| Возможность плана | v0.1 | Как |
|---|---|---|
| fingerprint-v1 + нормализация URL (§14) | ✅ полностью | golden vectors 6/6 + equivalence table как CI-тесты |
| Score engine (§15) | ✅ полностью | все формулы, coverage, Provisional/Insufficient data, Basic 60/40 |
| Scan/billing state machine (§18) | ✅ полностью | все переходы, идемпотентность, refund-инварианты |
| Оплата FastSpring | 🔶 код готов, live-режим закрыт | Серверная checkout-сессия + подписанный webhook (`X-FS-Signature`, base64 HMAC-SHA256), см. [FASTSPRING.md](FASTSPRING.md). `FASTSPRING_MODE=live` не включается, пока владелец аккаунта FastSpring не проверит магазин и не выставит `FASTSPRING_STORE_VERIFIED=verified` — этот шаг вне репозитория. MockPaddle остаётся только для локальной разработки |
| Crawler (§3) | ✅ базово | HTTP, robots.txt, sitemap, лимиты; без JS-рендеринга |
| SEO (§4) | ✅ субсет | SEO-TECH-001..008,013 + SEO-ONPAGE-001,002,003,005 + JSON-LD/social preview |
| AI SEO/GEO (§5) | ✅ Anthropic, fail-closed when absent | AI генерирует neutral domain-specific вопросы из сохранённого профиля, затем отдельные provider-вызовы проверяют упоминание бренда/домена; caps, truncation, quota, consent; production без ключа не подменяется фиктивными ответами |
| Security passive (§6) | ✅ субсет | SEC-PASSIVE-002,003,005 + OWASP ASVS Public Profile (HTTP/DOM) |
| Security active (§6) | ❌ | за launch gate по самому плану |
| Performance (§7) | ✅ external runner | PageSpeed Insights normalized lab snapshot работает без ключа; CrUX дополняет его field metrics при наличии `CRUX_API_KEY` |
| Accessibility (§8) | ✅ WCAG 2.2 AA automated/static | A11Y-001..011 + EN 301 549/Section 508 mappings, explicit manual-review boundary and report disclaimer |
| Reliability (§9) | ✅ субсет | REL-URL-001,003,009 + REL-API-003,005 |
| Content Quality (§10) | ✅ субсет | CONTENT-003,004 |
| Privacy (§11) | ✅ public technical subset | PRIVACY-001..004: cookies, third-party scripts, consent signal, policy discoverability; not legal advice |
| UX/Conversion (§12) | ✅ hybrid static + Anthropic | bounded static HTML signals plus consent-gated, strict-JSON AI review; AI findings are advisory and outside the overall score |
| Analytics (§13) | 🔶 OAuth foundation | Google/Bing OAuth connections and status; full analytics rule runner remains a follow-up |
| Issue Center (§14) | ✅ | статусы, фильтры, Resolved/Reopened по fingerprint |
| Дашборд (§15) | ✅ | score, coverage, веса, вклад проблем |
| Экспорт (§16) | ✅ JSON+CSV + S3 archive | schema v1 + semantic validator; private Hetzner S3 archive when configured; PDF вне v0.1 |
| Аккаунты (§17) | ✅ базово | email/пароль, сессии; Google sign-in remains separate from Google data OAuth |
| Тарифы Free/Basic/Complete (§18) | ✅ | гейтирование модулей, лимиты URL/AI, retention-метки |
| ECON-001 (§18) | ✅ CLI | чистый валидатор экономики |
| Админка (§20) | ❌ | вне v0.1 |
| Backend E2E | ✅ | Supertest + disposable PostgreSQL: Complete checkout → worker → UX/Conversion → Issue Center/export, включая consent-gated Partial |
| E2E Playwright | ✅ Google bindings | browser-rendered Integrations flow покрывает отдельные связки всех профилей; полный paid audit flow остаётся отдельным follow-up |

## 3. Реализуемый набор правил `rules-mvp-0.1` (65 позиций: 55 сканирующих/GEO/UX + 10 платформенных)

Severity и оракулы фиксируются в реестре `packages/contracts` (замена несуществующих
`RULES-<module>-v1`); фикстуры `fx-<rule_id>-{positive|negative|boundary}`.

| Группа | Правила | Оракул |
|---|---|---|
| SEO technical | SEO-TECH-001 robots.txt; 002 sitemap; 003 HTTP status; 004 canonical; 005 redirect chains; 006 4xx/5xx; 007 duplicate URL; 008 index/noindex; 013 HTTPS/mixed content | HTTP/HTML детерминированно |
| SEO on-page | SEO-ONPAGE-001 title; 002 meta description; 003 H1–H6; 005 image alt | DOM |
| SEO discovery | SEO-STRUCT-001 JSON-LD syntax; SEO-STRUCT-002 JSON-LD completeness; SEO-SOCIAL-001 social preview | статический HTML; JS-injected markup не объявляется отсутствующим |
| GEO | GEO-PROVIDER-001 adapter-контракт; GEO-VIS-003 brand presence; GEO-VIS-004 site link; GEO-METHOD-002 metadata capture; GEO-METHOD-005 unavailable без штрафа | нормализованный AI-ответ реального provider-а; mock только в тестах |
| UX/Conversion | UX-CONV-STATIC-001..003; UX-CONV-AI-001..003 | узкие DOM-факты + consent-gated AI interpretation, без штрафа score |
| Security passive/ASVS | SEC-PASSIVE-002 security headers; 003 HSTS; 005 cookie attributes; SEC-ASVS-001 CSP; 002 Permissions-Policy; 003 CORS credentials | заголовки ответа + HTML |
| Reliability | REL-URL-001 availability; 003 4xx/5xx verdict; 009 response time; REL-API-003 expected-status precedence; REL-API-005 no-credentials policy | HTTP + контракт §9 |
| Accessibility | A11Y-001 contrast; A11Y-002 alt text; A11Y-003 language/headings; A11Y-004 form labels; A11Y-005 keyboard risks; A11Y-006 focus; A11Y-007 ARIA; A11Y-008 interactive names; A11Y-009 form errors; A11Y-010 landmarks/media; A11Y-011 report transparency | DOM/CSS + report contract |
| Content | CONTENT-003 empty/low-value (порог: <200 видимых символов текста); CONTENT-004 broken media | DOM+HTTP |
| Privacy | PRIVACY-001 cookies; PRIVACY-002 consent signal; PRIVACY-003 third-party scripts; PRIVACY-004 policy discoverability | заголовки/DOM; технический сигнал, не legal advice |
| Platform | BILLING-001..006 (инварианты биллинга); EXPORT-001..003 (schema+semantic+CSV); ECON-001 | fixtures/тесты |

Free-проверка = SEO-ONPAGE-001 (title), SEO-ONPAGE-003 (H1), SEO-ONPAGE-002 (meta description),
SEO-TECH-008 (индексация) только для homepage — ровно по §18 плана. Новые проверки входят в
Basic/Complete по существующей модульной матрице и не требуют токенов клиента.

### Public-only profiles

- `Accessibility`: WCAG 2.2 AA automated/static с отображаемым mapping на EN 301 549 и Section 508;
  это не юридическая сертификация.
- `Security`: OWASP ASVS Public Security Profile — только внешне наблюдаемые HTTP/DOM-сигналы;
  source code, authenticated flows и server-side configuration явно не проверяются.
- `AI SEO / GEO`: public AI crawler readiness (robots policy, extractable content, structured data,
  social preview) работает без provider token. Provider visibility остаётся отдельным consent-gated слоем.

### Remaining follow-up: context inference when the form is empty

Domain-specific GEO query generation is now implemented for saved profile context. The remaining
follow-up is to infer a proposal from public content when the user leaves the form empty. The
proposal must be shown for confirmation before payment and scan launch. The implemented behavior:

- accept saved profile context: business/domain topic, services or products, target city or region,
  audience, and target languages;
- always include brand/official-site awareness checks; in a separate provider call, generate two to
  four bounded domain-specific questions from neutralized structured profile context, then ask those
  questions as independent visibility checks; query generation and discovery prompts do not receive
  the brand, domain, free-form description or crawled page titles, because those values would teach
  the provider which site to mention;
- keep generated GEO questions and observations separate from measured Search Console queries and
  metrics;
- ask the generated discovery questions during the scan instead of offering a separate on-demand
  query-ideas generator; the report shows them, with the provider's answers, among the checks the
  AI SEO / GEO card opens to.

### Implemented: hybrid UX/Conversion review

Complete scans now run a public-only UX/Conversion module. The deterministic half collects bounded
HTML evidence (headings, visible text, actions, forms, links, and contact signals) from up to twelve
reachable pages. The AI half receives that evidence plus the saved profile context only when the
scan's existing Anthropic consent covers the provider. It must return strict JSON using an allowlist
of UX rule IDs and URLs supplied by the crawler; malformed or unsupported output is discarded as
`ProviderContract`, never shown as a result. Findings become ordinary Issue Center items with
evidence and recommendations, but have zero score penalty because the module cannot measure a real
conversion rate. The report explicitly states the static-HTML limitation and why the AI half was
unavailable when that happens.

### Implemented: backend E2E coverage

`apps/api/src/api.e2e.test.ts` covers the public backend seam with Supertest, the disposable
PostgreSQL test database, the crawler fixture site, and the real worker pipeline. The happy path
starts at Complete checkout and verifies the persisted UX module, an Issue Center finding, and a
Complete export. The consent-gated path verifies that static UX evidence remains usable while the
AI half is stored as `Partial` with `UxAiConsentMissing` and produces no fabricated issue. Run these
tests with `TEST_DATABASE_URL` pointing at the disposable PostgreSQL database. Browser-rendered
coverage is provided separately by Playwright.

### Implemented: Playwright Google bindings coverage

`e2e/google-bindings.spec.ts` starts the real Vite web app and intercepts only the authenticated
API seam with deterministic Google fixtures. It verifies that every saved profile can be selected,
that its Search Console and GA4 binding are loaded independently, and that saving a changed
binding for one profile does not silently change another profile. This is browser-rendered UI
coverage, not a live OAuth or Google quota test; the authenticated provider contract remains
covered by the API and component tests.

### Planned follow-up: Google bindings overview

The current Integrations screen configures only the selected profile and does not make the
account's existing Google bindings visible as a list. The follow-up must:

- show one row per FluxRadar profile with its Search Console and GA4 binding status;
- distinguish linked, partially linked, and not linked profiles in the row itself;
- provide a clear "Configure" action for each profile that opens the existing property selectors;
- keep one binding per profile while allowing different profiles to use different Google
  properties.

### Implemented: profiles as saved Complete-run configurations

A profile is not just a site name and URL. It must be the complete, reusable configuration for
running an audit on the Complete plan. The profile now:

- persist the site identity together with the full run configuration, including plan, subdomain
  scope, page/depth limits, query-parameter policy, robots policy and user-agent;
- keeps the user's AI-provider consent per run rather than storing it in the reusable profile;
- create and edit profiles through one complete configuration surface, so a saved profile can be
  launched without silently falling back to defaults or losing advanced settings;
- shows the effective configuration before payment and before starting a scan;
- marks unsaved edits explicitly, explains that a run saves them, and labels the resulting
  profile configuration revision on the profile, checkout, scan and report;
- keep profile identity/configuration separate from Google bindings, while allowing each profile
  to have its own Complete-run settings and Google properties.

## 4. Ключевые контракты (обязательные к дословной реализации)

1. **fingerprint-v1** (§14): сериализация с length-prefix + NUL, SHA-256, префикс
   `fluxradar-fp-v1:`; 6 golden-векторов и equivalence-таблица — блокирующие CI-тесты.
2. **URL-нормализация v1** (§14 + D-018): lowercase, punycode, порты, dot-segments,
   NFC, сортировка query по UTF-8 байтам, вырезание `utm_*`/`gclid`/`fbclid`/`msclkid`/`yclid`/`mc_cid`/`mc_eid`.
3. **Score** (§15 + D-016/17/20/21/22): penalty {25,10,3,1} × min(1, affected/applicable),
   dedup по fingerprint, max severity per rule, effective weights × coverage, нормализация к 100%,
   пороги 0.80/0.50, `round2` half-up, Basic 60/40, `Insufficient data` при нулевом знаменателе.
4. **State machine** (§18): `Pending→Queued→Running→{Partial,Completed,Failed,Cancelled}`,
   atomic claim, `platform_retry_count ≤ 1`, `module_retry_count ≤ 1`, webhook dedup по
   `(provider, provider_event_id)` (unique), один purchase → один entitlement → один scan,
   `refund_idempotency_key = refund:{purchase_id}`, refund reason enum из §18.
5. **Export schema v1** (§16 + D-014/15/16/19/24): 4 record types, JSON Schema дословно из
   плана, semantic validator (инварианты 1–9 из `EXPORT-001`), CSV: UTF-8 без BOM, LF, RFC 4180,
   порядок summary→module→ai_response→issue (severity → fingerprint lexicographic),
   zero-issue → одна summary-строка, экранирование формул (`= + - @`).
6. **AI-контракт** (§5; mock только в тестах): normalized response contract, caps 8000/2000, детерминированная
   truncation `[TRUNCATED]`, `finish_reason=length`, `ai_request_key`, consent per-scan,
   pre-response отказ → module `Unavailable` без `ai_response` record и без списания квоты.
7. **safe-fetch** (§6/§21 + находки security): резолв всех A+AAAA адресов до соединения,
   blocklist loopback/private/link-local/metadata/IPv4-mapped, проверка каждого redirect,
   лимиты D-028, per-host лимиты D-030.

## 5. Последовательность реализации

Задачи и зависимости — в `docs/TASK_BOARD.md`. Порядок: скелет → contracts →
fingerprint → scoring → safe-fetch → БД/биллинг → crawler → правила → AI provider (mock в тестах) → export →
API/оркестратор → дизайн-система UI → экраны → интеграционные тесты → финальная проверка.

## 6. Definition of Done v0.1

- [ ] `pnpm install && pnpm test && pnpm build && pnpm lint && pnpm typecheck` — зелёные.
- [ ] Golden-векторы fingerprint (6/6) и score (96.50 + state-фикстуры) проходят.
- [ ] Webhook-идемпотентность: двойная доставка/out-of-order → один entitlement, один scan.
- [ ] Integration: скан fixture-сайта → ожидаемый набор issues → export проходит
  JSON Schema + semantic validator; CSV корректен.
- [ ] Тарифное гейтирование: Free — только homepage-проверка; Basic — без экспорта/истории;
  Complete — история/сравнение/CSV.
- [ ] UI: happy path (регистрация → профиль → dev-checkout → скан → дашборд → Issue Center →
  CSV) работает вручную; стиль соответствует `DESIGN_SYSTEM.md`.
- [ ] Секреты только в env, `.env.example` без значений; логи без raw HTML/credentials.
- [x] До публичных продаж Terms, Privacy и Cookie Policy называют фактического продавца/контролёра: полное
  юридическое имя, страну и почтовый адрес, применимые регистрационные/налоговые данные и
  юрисдикцию; формулировки проверены с учётом стран, где сервис целенаправленно продаётся.

v0.1 не претендует на launch gates §26 — они остаются условиями public launch полного релиза.
