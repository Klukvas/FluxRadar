# FluxRadar — функциональный план продукта

**Компания:** FluxLab  
**Продукт:** FluxRadar  
**Статус документа:** финализируемая спецификация текущего релиза  
**Формат продукта:** pay-per-scan SaaS-платформа

> FluxRadar — единая платформа для одноразовой комплексной проверки и улучшения состояния публичного сайта: SEO, безопасности, производительности, доступности, контента, AI-видимости и надёжности.

**Коммерческая модель FluxLab:** один прогон — один платёж. Подписочная модель пока не используется.

## 0. Границы текущего релиза

### Входит в текущий релиз

- Free: одна регистрационная проверка главной страницы по четырём базовым SEO-параметрам.
- Basic Scan: SEO и AI SEO / GEO, один домен, до 5 000 URL и 50 AI-запросов.
- Complete Scan: все модули текущего релиза, один домен, до 50 000 URL и 500 AI-запросов.
- Модули текущего релиза: SEO, AI SEO / GEO, пассивный Security, синтетический Performance, Accessibility, Content Quality, Privacy, Reliability для выбранных публичных URL, статические UX/Conversion-проверки и Analytics через подключённые Search Console/Analytics.
- Контролируемые проверки публичной поверхности Security доступны только в Complete после прохождения security launch gate, описанного ниже.

### Не входит в текущий релиз

- регулярный мониторинг, расписания, уведомления и плановая отправка отчётов;
- команды, рабочие пространства, роли, назначение ответственных, комментарии и audit log для клиентов;
- авторизованные разделы и пользовательские сценарии;
- browser automation для AI-систем;
- RUM через CDN/reverse proxy;
- внешний поиск backlinks, reputation и упоминаний в социальных сетях;
- Google Business Profile и другие каталоги;
- checkout-flow, login-flow и другие интерактивные сценарии;
- visual regression.

Complete означает «все модули текущего релиза». Отложенные возможности не рекламируются как доступные в Complete до отдельного запуска и проверки их источников данных, стоимости и безопасности.

---

## 1. Цель продукта

Пользователь добавляет сайт в FluxRadar и получает единую картину его состояния. Платформа:

1. сканирует сайт и подключённые источники данных;
2. обнаруживает проблемы и возможности для улучшения;
3. объясняет влияние каждой проблемы;
4. предлагает способ исправления;
5. позволяет повторно проверить результат новым оплаченным прогоном;
6. сохраняет результат и сравнение сканов в пределах тарифа.

FluxRadar текущего релиза — центр диагностики и принятия решений по сайту. Совместная работа команды и постоянный мониторинг являются отдельным будущим продуктовым слоем.

## 2. Основные режимы работы

### Первичный аудит

Полное сканирование выбранной области сайта с формированием:

- общего Website Health Score;
- оценок по отдельным направлениям;
- списка проблем с приоритетами;
- отчёта для пользователя или передачи клиенту;
- списка рекомендаций, привязанных к найденным проблемам.

Перед каждым платным сканированием пользователь выбирает домен и область URL, а набор модулей определяется тарифом. Basic запускает SEO и AI SEO / GEO; Complete по умолчанию запускает все модули текущего релиза, без выбора subset. Free работает по фиксированной одноразовой проверке главной страницы. Optional sources (например, Search Console/Analytics или active Security до gate) получают `Unavailable`/`Not applicable`, если их нельзя использовать, но не превращаются в скрыто отключённые модули.

### Регулярный мониторинг

**Статус:** будущая возможность, не входит в текущую pay-per-scan версию.

Повторные проверки по расписанию с отслеживанием:

- новых проблем;
- исчезнувших проблем;
- ухудшения показателей;
- регрессий после релиза;
- доступности сайта и ключевых сценариев;
- изменений AI-видимости.

### Проверка после исправления

Повторная проверка является новым оплаченным прогоном того же домена. Пользователь повторяет полный скан или выбранную область, а Complete дополнительно сравнивает результат с предыдущим сканом и показывает: исправлено, частично исправлено или проблема всё ещё существует. Free повторные проверки не поддерживает.

---

## 3. Сканирование и добавление сайта

### Добавление профиля сайта

Пользователь должен иметь возможность:

- создать один или несколько независимых профилей сайтов в своём аккаунте;
- указать основной домен;
- добавить поддомены;
- указать название проекта и отрасль;
- выбрать одну или несколько отраслей для AI SEO и отраслевых проверок;
- выбрать один основной регион и один основной язык;
- настроить часовой пояс и язык интерфейса.

Каждый оплаченный прогон относится ровно к одному основному домену. Регулярное расписание и общий командный workspace в текущем релизе отсутствуют.

### Подтверждение владения

Поддержать подтверждение домена через:

- DNS TXT-запись;
- загрузку файла в корень сайта;
- HTML meta-тег.

Пассивные проверки публичных страниц могут выполняться без подтверждения владения. Для активных Security-проверок и приватных интеграций подтверждение домена обязательно.

### Настройка области сканирования

- сканировать весь домен;
- использовать sitemap.xml;
- ограничить сканирование списком URL;
- включать или исключать поддомены;
- задавать шаблоны URL для включения и исключения;
- ограничивать количество страниц;
- задавать глубину обхода;
- учитывать или игнорировать параметры URL;
- по умолчанию соблюдать robots.txt;
- разрешать override robots.txt только после отдельного подтверждения пользователя;
- выбирать desktop/mobile user agent;
- включать JavaScript-рендеринг для SPA и динамических сайтов.

### Управление сканированием

- запустить сканирование вручную;
- поставить сканирование на паузу;
- остановить сканирование;
- возобновить прерванное сканирование;
- видеть прогресс и количество обработанных URL;
- видеть ошибки краулера;
- повторить неудачные проверки;
- запускать ограниченный повторный прогон в рамках оплаченного скана, если отдельный модуль завершился технической ошибкой.

Delta scan по истории изменений относится к будущему мониторингу и не обещается в текущем релизе.

### Авторизованные разделы

Поддержка сканирования закрытых страниц и пользовательских сценариев отмечена как перспективное расширение. В текущий обязательный scope она не входит.

---

## 4. SEO-аудит

### Техническое SEO

- robots.txt;
- sitemap.xml;
- HTTP status codes;
- canonical URL;
- цепочки и циклы редиректов;
- 4xx и 5xx ошибки;
- дубли URL;
- index/noindex;
- pagination;
- orphan pages;
- crawl depth;
- некорректные или отсутствующие hreflang;
- HTTPS и смешанный контент;
- корректность URL.

### On-page SEO

- title;
- meta description;
- H1–H6;
- длина и уникальность метаданных;
- alt у изображений;
- Open Graph и social metadata;
- структурированные данные;
- внутренняя перелинковка;
- релевантность заголовка и содержания страницы.

### Контентное SEO

- дублированный контент;
- thin content;
- страницы без полезного содержания;
- устаревшие страницы;
- читаемость;
- тематические пробелы;
- частота и естественность ключевых фраз;
- контент, который может конкурировать сам с собой;
- рекомендации по новым страницам и внутренним ссылкам.

### Расширенные SEO-направления

- local SEO по данным сайта;
- e-commerce SEO для публичных карточек товаров;
- Product и Review Schema;
- image и video SEO;
- анализ поисковых запросов через Search Console.

Проверки local SEO через Google Business Profile, внешние backlinks, reputation monitoring, blacklist/domain reputation, RUM, visual regression и server log analysis не входят в текущий релиз. Они остаются отдельными будущими модулями до подтверждения источников данных, покрытия, стоимости и юридических ограничений.

---

## 5. AI SEO / GEO

Модуль показывает, насколько бренд и сайт представлены в ответах AI-поиска и насколько контент удобен для цитирования.

### Проверка готовности сайта

- доступность важного контента для AI-краулеров;
- обнаружение контента, доступного только после сложного JavaScript-рендеринга;
- структурированные данные;
- описания организации, продуктов и экспертов;
- наличие авторов, дат публикации и обновления;
- ясность фактов, определений и ответов;
- наличие источников и ссылок;
- согласованность информации о бренде на сайте.

### Снимок AI-видимости в рамках скана

- готовая библиотека FluxRadar с отраслевыми вопросами и промптами;
- проверка ответов по выбранным темам в рамках оплаченного прогона;
- наличие или отсутствие бренда в ответе;
- наличие ссылки на сайт;
- цитируемые страницы;
- упомянутые конкуренты;
- позиция и контекст упоминания;
- сравнение с предыдущими сохранёнными сканами в Complete.

В обязательный scope текущего скана входят ответы через официальные API OpenAI, Google и Perplexity. Остальные AI-системы пока не входят в обязательный scope.

Browser automation для систем, где API недостаточно, остаётся будущим расширением и не используется как скрытая зависимость оплаченного скана.

### Реестр AI-провайдеров v1

Для каждого провайдера создаётся отдельный adapter с версионированным контрактом. В конфигурации adapter до запуска фиксируются официальная операция API, endpoint/SDK-метод, model ID, authentication mode, timeout, retry policy, input limit и output limit. В продуктовый отчёт сохраняются фактические operation, model ID, provider request ID и параметры, использованные в запросе.

- OpenAI: `POST https://api.openai.com/v1/responses`, однократный text response;
- Google: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, однократная генерация текста;
- Perplexity: `POST https://api.perplexity.ai/v1/sonar`, однократный ответ с источниками, если provider их возвращает.

В adapter registry также фиксируются provider API version, допустимые model IDs, request schema, response parser, timeout и цена единицы usage. Если provider меняет endpoint или схему, сначала выпускается новая версия adapter, затем выполняется совместимость на fixtures; silent fallback на другой endpoint запрещён.

Для registry v1 зафиксированы следующие production defaults: OpenAI `gpt-5-mini`, API `v1`; Google `gemini-3.6-flash`, API `v1beta`; Perplexity `sonar-pro`, API `v1`. Эти model IDs не являются пользовательской настройкой. Замена модели требует новой версии registry, повторного прогона fixtures и записи изменения в release record `AI-001`.

Нормализованный response contract содержит `provider`, `api_version`, `model_id`, `request_id`, `request_id_source`, `created_at`, `raw_text`, `citations[]`, `usage.input_tokens`, `usage.output_tokens`, `usage.total_tokens`, `usage_source`, `tokenizer_version` и `finish_reason`. В normalized contract `total_tokens` всегда равен `input_tokens + output_tokens`; provider-specific reasoning/search/citation units хранятся отдельными полями usage и в evidence. При отсутствии usage в ответе токены считаются соответствующим pinned tokenizer provider; значения, версия tokenizer и способ подсчёта сохраняются в evidence.

Request schemas v1: OpenAI использует `model`, `input`, `max_output_tokens` и явно отключённое server-side storage; Google использует `model`, `contents`, `generationConfig.maxOutputTokens` и зафиксированные safety settings; Perplexity использует `model`, `messages`, `max_tokens` и зафиксированную search/citation configuration. Provider обязан поддерживать требуемый no-storage/data-control режим: если это нельзя проверить или явно отключить, adapter не допускается в production и возвращает `Unavailable`, а не делает fail-open запрос. Provider отвергнутый параметр не удаляется молча: adapter получает новую совместимую версию или возвращает `Unavailable`.

Если provider не возвращает request ID, FluxRadar сохраняет локальный UUID и `request_id_source=local` вместе с hash raw response. Если provider не возвращает usage, adapter использует pinned tokenizer/version из `AI-001`, сохраняет `usage_source=estimated` и не выдаёт результат как точный billing fact.

Для каждого запроса используются только public-site data и готовый prompt FluxRadar. Пользовательские cookies, поисковая история, скрытые профили и персонализация по IP не передаются. На запуске применяются hard caps: до 8 000 input tokens, 2 000 output tokens, 4 000 reasoning units, 8 search units и 32 citation units на один AI-запрос. Adapter обязан передать поддерживаемые provider caps или отклонить запрос; если provider не умеет ограничить конкретную дорогую операцию, она не запускается. Если input превышает cap, сохраняются system instructions, вопрос, факты бренда и заголовки страниц в этом порядке; остальной текст обрезается по границе токена с явным маркером `[TRUNCATED]`. Если output достигает cap, ответ сохраняется с `finish_reason=length` и пометкой о неполноте.

Usage/cost accounting выполняется по фактическому provider usage: input, output, reasoning, search/citation units и request ID, если provider их возвращает; иначе применяется tokenizer и price-card estimate с явной пометкой. До запроса cost guard резервирует worst-case стоимость по всем установленным caps; если резерв превышает остаток бюджета, запрос не запускается. Retry использует тот же reservation и не списывает AI-квоту повторно; после успешного или окончательно неуспешного запроса резерв атомарно закрывается, фактическая/оценочная стоимость списывается, а неиспользованный остаток освобождается. При отсутствии provider usage после запроса против бюджета списывается worst-case estimate, а не ноль; в записи сохраняются `price_card_version`, `budget_before`, `reserved_amount`, `actual_or_estimated_amount`, `released_amount` и причина выбора оценки. При достижении hard cost ceiling новые AI-запросы и дорогие rendering-задачи не запускаются, модуль получает `Partial` с причиной `CostGuard`, а пользователь видит использованный budget и пропущенные операции.

Перед отправкой данных provider запускается redaction pipeline v1: email, phone, API keys, JWT, cookies, Authorization headers, session IDs, private IP/metadata и похожие секреты заменяются на типизированные маркеры `[REDACTED:<type>]`. В audit log сохраняются только тип и количество замен, не исходные значения. До первого AI-запроса пользователь видит notice о передаче публично извлечённого контента внешним provider и подтверждает использование AI-модуля; без согласия AI-модуль получает `Unavailable` и не списывает AI-квоту.

Redaction работает fail-closed: если pipeline завершился с ошибкой, обнаружил неуверенный secret-like фрагмент или не смог доказать отсутствие credentials, provider request не отправляется, AI-модуль получает `Unavailable` с причиной `RedactionBlocked`, а quota/cost не списываются. Consent evidence сохраняет `consent_id`, `account_id`, `scan_id`, список provider-ов, версию notice/Terms, timestamp UTC и версию privacy policy; отсутствие или несоответствие записи блокирует запрос.

`ai_response` export record создаётся только когда provider request был отправлен и получен ответ, который прошёл normalized response contract. Такой record имеет `module_status=Completed` или `Partial`; при отсутствии consent, блокировке redaction, неподтверждённом data-control режиме, provider timeout до отправки или другом pre-response отказе создаётся только module record `AI SEO / GEO` со статусом `Unavailable` и `status_reason`, без пустого `ai_response` record и без AI quota/cost. Поэтому отсутствие `provider`, `request_id`, usage или deletion evidence в blocked/unavailable ветке не является нарушением export schema: эти поля обязательны только для реально созданного `ai_response` record.

При создании реального `ai_response` record одновременно создаётся durable deletion-control record `AI-001` с immutable reference, который сразу записывается в `deletion_evidence_ref`; эта ссылка означает наличие контрольного lifecycle record, а не уже завершённое удаление. Provider deletion request, completion confirmation и verification timestamp добавляются к тому же control record позже по `AI-001`/`DATA-006`. Поэтому `deletion_evidence_ref` обязателен как непустая ссылка уже при export, но его referenced control может иметь status `Pending` до наступления retention/deletion event; для pre-response module `Unavailable` такая ссылка не создаётся.

Полные ответы Complete хранятся 12 месяцев в зашифрованном хранилище с доступом только владельцу соответствующего аккаунта и FluxLab support по audit-логируемому запросу. До запуска для каждого provider в `AI-001` фиксируются Terms of Service, data-control/обучение, регион обработки, срок хранения у provider, способ удаления и подтверждение отсутствия передачи credentials или пользовательских cookies. Удаление из FluxRadar удаляет raw answers, redacted inputs, exports, caches и references; резервные копии удаляются в пределах 30 дней после истечения retention. Provider без подтверждённой конфигурации не включается в Complete.
Процедура provider deletion в `AI-001` обязательна: для каждого `scan_id` сохраняются provider deletion request ID или support ticket, время запроса, заявленный SLA, подтверждение завершения и verification timestamp; если API provider не возвращает подтверждение, используется документированный support workflow. Неподтверждённое удаление считается failed control и блокирует production adapter до privacy sign-off.

AI API оплачивает FluxRadar; стоимость этих запросов включается в цену оплаченного прогона и учитывается в расчёте себестоимости Basic Scan и Complete Scan.

Каждый результат должен фиксировать дату, модель, источник и текст проверочного запроса. FluxRadar не должен обещать гарантированное попадание в ответы AI-систем.

Пользователь видит полный текст ответа каждой AI-системы. На Basic полные ответы доступны только в текущем результате и не сохраняются в истории. На Complete полные ответы сохраняются как часть истории GEO-проверок.

### Рекомендации GEO

- какие вопросы покрыть контентом;
- какие факты сделать более явными;
- какие страницы дополнить источниками;
- какие сущности описать через Schema.org;
- какие страницы могут стать источниками для AI-ответов.

### Методика текущего AI/GEO-скана

- библиотека вопросов фиксируется версией FluxRadar и зависит от выбранных отраслей, региона и языка;
- каждый запрос сохраняет provider/model ID, версию промпта, регион, язык, дату, источник и полный ответ;
- измеряются только проверяемые признаки: наличие бренда, ссылка на домен, цитируемые страницы, упомянутые конкуренты и контекст упоминания;
- результат является снимком AI-ответов, а не гарантированным рейтингом или позицией бренда;
- недоступный provider или отдельный запрос получает статус `Unavailable` и не уменьшает score как найденная проблема;
- повторяемость обеспечивается одинаковым набором вопросов и параметров, но вариативность ответов AI явно показывается пользователю.

---

## 6. Security-аудит

### Пассивная проверка публичной поверхности

- SSL/TLS;
- security headers;
- HSTS;
- CSP;
- cookies и их атрибуты;
- CORS;
- DNS-записи;
- открытые или ошибочно опубликованные файлы;
- directory listing;
- публичные debug/endpoints;
- утечки секретов в клиентском коде;
- устаревшие frontend-зависимости;
- небезопасные third-party scripts;
- базовые проверки распространённых веб-рисков.

### Сравнение состояния безопасности

В Complete эти признаки сравниваются только с предыдущими сохранёнными сканами в пределах 12-месячной истории. Постоянный мониторинг и уведомления относятся к будущему релизу.

### Авторизованные проверки

Контролируемое активное тестирование публичной поверхности является Complete-only функцией и доступно только после прохождения security launch gate. До запуска каждого активного скана обязательны:

- подтверждение домена через DNS TXT, файл или meta-тег;
- явное указание разрешённых host/URL в scope;
- отдельное подтверждение пользователя о наличии разрешения именно на этот запуск;
- безопасный профиль только неразрушающих проверок;
- фиксированные rate limits, ограничение параллелизма и kill switch;
- запись пользователя, времени, домена, scope и подтверждения в audit log;
- автоматическая остановка при превышении лимита ошибок или нагрузки.

Измеримые ограничения активного профиля v1: не более 1 запроса в секунду на host, не более 2 одновременных запросов на host, timeout 10 секунд на запрос и не более 500 явно разрешённых target URL за один активный модуль. Kill switch останавливает новые запросы не позднее 5 секунд после команды. Baseline latency — P95 первых 20 успешных запросов каждого host; если успешных запросов меньше 20, latency stop threshold не применяется. После baseline считаются непересекающиеся окна по 100 запросов на host: скан останавливается после 5 последовательных ответов 5xx, при не менее 5% ответов 5xx в одном полном окне или при росте P95 времени ответа более чем в 3 раза относительно baseline в двух последовательных полных окнах.

Перед каждым запросом hostname повторно разрешается и проверяется: loopback, private, link-local, multicast, metadata и другие non-public IP блокируются; redirect разрешён только в allowlist; DNS rebinding и cross-origin переходы блокируются. Все сработавшие ограничения попадают в результат и audit log.

Активные проверки не включают brute force, обход авторизации, эксплуатацию уязвимостей, отправку разрушающих payloads, стресс-тестирование или тесты отказа в обслуживании. Проверка закрытых разделов и тестирование аутентификации остаются будущим расширением.

FluxRadar не позиционируется как инструмент для несанкционированного проникновения или полноценной red-team операции.

---

## 7. Performance

- Core Web Vitals;
- время до первого байта;
- LCP, INP и CLS;
- размер HTML, CSS и JavaScript;
- изображения и форматы изображений;
- блокирующие ресурсы;
- third-party scripts;
- кеширование;
- CDN;
- мобильные и desktop-проверки;
- performance budget;
- сравнение показателей текущего и предыдущего Complete-скана;
- обнаружение performance-регрессий между двумя сохранёнными Complete-сканами.

### Performance contract v1

- desktop runner: image `fluxradar/performance-runner:v1` pinned by digest, Chromium and Lighthouse versions recorded in `PERF-001`, viewport 1 350×940, 4 vCPU, 10 Mbps downlink, 1.5 Mbps uplink, 40 ms RTT;
- mobile runner: the same pinned image with Moto G4 profile, viewport 360×640, 4× CPU slowdown, 1.6 Mbps downlink, 750 Kbps uplink, 150 ms RTT;
- runner region — `eu-central-1`; timezone UTC, locale `en-US`, headless Chromium without extensions, service-worker state reset between cold runs, browser flags и OS image фиксируются в `PERF-001`;
- cold-cache: новый browser context и очищенный cache перед каждым измерением; warm-cache: один priming run, затем новый context не создаётся и выполняются 3 измерения; priming не входит в median;
- для каждой комбинации `profile × cache mode` каждый URL прогоняется ровно 3 измерительных раза, в отчёт попадает median; при включённых desktop+mobile и cold+warm это 12 измерений на URL, priming не считается измерением; порядок всегда `desktop-cold`, `desktop-warm`, `mobile-cold`, `mobile-warm` и сохраняется в evidence;
- измерение считается settled после `load` и 2 секунд без in-flight network requests; WebSocket/EventSource и явно объявленные long-poll requests исключаются из idle-счётчика, либо по hard timeout 30 секунд; lazy-loaded content после этого условия не считается загруженным без явного правила страницы;
- good thresholds: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.10, TTFB ≤ 0.80 s; warning thresholds: LCP ≤ 4.0 s, INP ≤ 500 ms, CLS ≤ 0.25, TTFB ≤ 1.80 s; превышение warning threshold создаёт finding;
- verdict mapping: `PERF-RULE-001` формирует только aggregate Core Web Vitals availability/summary и всегда имеет `score_delta=0`; individual LCP/INP/CLS findings принадлежат только `PERF-RULE-003`. `PERF-RULE-014` сравнивает snapshots и всегда имеет `score_delta=0`. Для metric rule значение в good threshold — `pass` без penalty; выше good, но не выше warning — `warning` без penalty с объяснением; выше warning — `finding` с severity `Medium` и score penalty по module formula; `Unavailable` из-за runner/network не штрафует. `PERF-RULE-015` — regression `High`: его penalty применяется только если соответствующий current metric из source rule (`PERF-RULE-002` для TTFB, `PERF-RULE-003` для LCP/INP/CLS и соответствующий `PERF-RULE-004..013` для остальных performance metrics) имеет `pass`/`warning`; если current metric уже имеет finding, `PERF-RULE-015` остаётся видимым regression record, но его `score_delta=0`, чтобы один metric не штрафовался дважды;
- если страница не загрузилась за 30 секунд или runner потерял сеть, результат получает `Unavailable` и не штрафует score;
- для 3 измерений outlier не удаляется: итогом является median; если `MAD / median > 0.30` при median > 0, metric получает `Unstable`, не создаёт regression и показывает пользователю разброс. Для CLS используется `MAD > 0.05`, если median > 0;
- performance regression создаётся только при ухудшении median минимум на 20% и одновременно минимум на 100 ms для LCP/TTFB, 50 ms для INP или 0.05 для CLS; сравниваются только одинаковые URL, runner и cache mode. При baseline отсутствующем или равном 0 процентная проверка не применяется: для LCP/TTFB/INP regression требует соответственно current median ≥ 100/100/50 ms, для CLS — current median ≥ 0.05; иначе verdict `Not comparable`.

Для каждого metric finding и regression сохраняется обязательный top-level `metric_key = normalized_url|profile|cache_mode|metric_name`; для не-performance issue он равен `null`. В fingerprint тот же ключ кодируется через `rule_variant` вида `v1:metric=LCP:profile=desktop:cache=cold`, а validator проверяет равенство сохранённого и закодированного значения. `PERF-RULE-014` и `PERF-RULE-015` обязаны ссылаться на тот же metric key и source rule: `PERF-RULE-002` для TTFB, `PERF-RULE-003` для LCP/INP/CLS, `PERF-RULE-004..013` для соответствующего resource/budget metric; validator отклоняет mismatched comparison и не допускает penalty между разными profile/cache/metric.

`PERF-001` обязан содержать фактический image digest, Chromium build, Lighthouse version, OS image, browser flags, region, network/CPU emulator config, cache protocol, settle logs и commit SHA runner. Пока эти значения не записаны и не подписаны Engineering owner, performance module не проходит Quality gate.

Real user monitoring, включая сбор web-vitals через собственный скрипт или CDN/reverse proxy, не входит в текущий релиз. Google Analytics в текущем релизе используется только для аналитических данных, доступных через подключение пользователя.

---

## 8. Accessibility

- контрастность;
- alt-тексты;
- заголовки и структура документа;
- labels у форм;
- keyboard navigation;
- focus states;
- ARIA-атрибуты;
- доступность интерактивных элементов;
- ошибки форм;
- использование screen reader;
- отчёт с уровнем серьёзности и ссылкой на конкретный элемент.

Accessibility FluxRadar должен быть ориентирован на обнаружение проблем и рекомендации, а не на обещание автоматического юридического соответствия.

---

## 9. Reliability и техническое состояние

- одноразовая availability-проверка страниц и API;
- доступность выбранных публичных URL;
- 4xx/5xx ошибки;
- DNS;
- срок действия SSL;
- ошибки редиректов;
- broken links;
- broken images;
- время ответа;
- проверка выбранных ключевых публичных URL в рамках оплаченного скана;
- фиксация HTTP-статуса, времени ответа и даты проверки.

Uptime по расписанию, login/form/checkout-сценарии, visual regression и уведомления об инцидентах относятся к будущему релизу.

### Reliability contract v1

- текущий модуль проверяет только HTTP/HTTPS публичных URL и публичные API endpoints, которые пользователь явно добавил в список;
- для API пользователь указывает method из allowlist `GET`, `HEAD`, `OPTIONS`, URL и expected status (по умолчанию 2xx); `HEAD` может быть заменён на `GET`, если сервер его не поддерживает;
- request headers ограничены 16 KB и не могут содержать `Authorization`, `Cookie`, API keys или другие credentials; request body в текущем релизе отсутствует;
- redirects ограничены 5 переходами, конечный host должен быть в allowlist, cross-origin redirect запрещён; на каждом DNS resolve применяются private-IP и DNS-rebinding проверки из Security;
- timeout одного запроса — 10 секунд; это одна initial attempt плюс не более 3 retries (до 4 попыток всего) только для сетевых ошибок и 5xx с exponential backoff; 3xx и 4xx не повторяются;
- verdict precedence после завершения разрешённых попыток: `pass`, если фактический status входит в явно заданный `expected_status` (включая ожидаемые 3xx, 404 и 5xx); только при отсутствии совпадения с expected status применяется общий fallback — `warning` для 3xx или неожиданного 4xx либо времени ответа выше 1.8 секунды и `fail` для 5xx, DNS/SSL error, timeout или недоступности URL. Таким образом, ожидаемый 404/3xx/5xx — `pass`, а неожиданный 404 — `warning`;
- форма, login, checkout и другие state-changing API не выполняются; credentials и секреты в текущий релиз не принимаются. Этот запрет является частью `REL-API-005` и проверяется отдельным negative/boundary fixture.

---

## 10. Content Quality

- дубли страниц;
- устаревший контент;
- пустые и малосодержательные страницы;
- битые изображения и media;
- нечитаемый или чрезмерно сложный текст;
- неестественные повторения ключевых фраз;
- противоречия между страницами;
- отсутствие автора или даты там, где это важно;
- неработающие ссылки на источники;
- рекомендации по структуре и обновлению контента.

AI-рекомендации должны показываться как предложения для редактора и не менять опубликованный контент автоматически без подтверждения.

---

## 11. Privacy и compliance

- обнаружение cookies;
- обнаружение trackers;
- third-party scripts;
- consent banner;
- формы, собирающие персональные данные;
- проверка privacy/legal-страниц;
- сравнение заявленных и фактически используемых трекеров;
- обнаружение потенциальных утечек персональных данных;
- экспорт технического отчёта для дальнейшей юридической проверки.

FluxRadar не выдаёт юридическую сертификацию и не заменяет консультацию специалиста по законодательству.

---

## 12. UX/Conversion

- мобильная удобность выбранных публичных страниц;
- видимость и понятность CTA;
- ошибки форм;
- обязательные и необязательные поля;
- потенциальные dead ends по статической структуре страницы;
- визуальные проблемы важных страниц;
- базовые рекомендации по повышению конверсии.

Интерактивная проверка регистрации, покупки, checkout и фактической конверсии относится к будущему релизу и не должна подразумеваться в текущем UX/Conversion-модуле.

---

## 13. Analytics

Интеграции и проверки должны позволять:

- подключать Google Search Console;
- подключать Google Analytics;
- анализировать падение органического трафика;
- видеть страницы без трафика;
- находить запросы без подходящей страницы;
- обнаруживать неработающие события;
- проверять data layer;
- отслеживать аномалии конверсий;
- связывать технические проблемы с бизнес-показателями.

Search Console и Google Analytics являются опциональными источниками. Без подключения соответствующий блок получает статус `Unavailable`, объяснение причины и не уменьшает общий score. Analytics не выполняет постоянное отслеживание аномалий в текущем pay-per-scan релизе: данные анализируются только в рамках оплаченного скана.

---

## 14. Единый Issue Center

Все проверки используют единую модель проблемы.

### Поля проблемы

- название;
- категория и подкатегория;
- URL или элемент, где найдена проблема;
- дата обнаружения;
- источник обнаружения;
- серьёзность;
- влияние на SEO, безопасность, скорость, конверсию или доход;
- описание простым языком;
- технические детали;
- доказательство проблемы: URL, HTTP-ответ, DOM-фрагмент, скриншот или trace, если применимо;
- confidence и версия правила аудита;
- стабильный fingerprint проблемы для сравнения между сканами;
- рекомендация по исправлению;
- статус;
- идентификатор скана и дата последнего наблюдения.

Ответственные, сроки, комментарии, связанные задачи и клиентский audit log относятся к будущему командному режиму. В Complete доступна история наблюдений по проблеме в пределах 12-месячной истории сканов.

### Статусы

- New;
- Acknowledged;
- Resolved;
- Ignored;
- False Positive.

Если проблема после статуса Resolved снова найдена в новом Complete-скане, она отображается как `Reopened` в сравнении результатов.

Авторитетное определение `fingerprint-v1`: fingerprint — это SHA-256 только от точной canonical serialization восьми полей ниже; текст рекомендации в него не входит. Если `rule_id` или объект проверки изменились, создаётся новый fingerprint. Статус `Resolved` назначается только при успешном Complete-скане, в котором прежний fingerprint отсутствует; `Reopened` — если тот же fingerprint появляется снова.

Для `fingerprint-v1` payload сериализуется без JSON и с collision-free length prefixes: `UTF8("fluxradar-fp-v1") + NUL + (ASCII(decimal byte_length(field_i)) + ":" + UTF8(field_i) + NUL)` для каждого из восьми полей. Поля идут в порядке `domain`, `rule_id`, `target_kind`, `normalized_url`, `normalized_resource`, `normalized_selector`, `normalized_parameter`, `rule_variant`; `byte_length` считается по UTF-8 до добавления framing. Literal NUL и backslash внутри field не экранируются, потому что граница однозначно определяется длиной; пустое значение сериализуется как `0:`. Хэш — `SHA-256(payload)` в lowercase hex; хранимое значение имеет вид `fluxradar-fp-v1:<sha256-hex>`.

URL-нормализация v1: scheme и hostname переводятся в lowercase, hostname — в punycode, default port удаляется, non-default port сохраняется, userinfo запрещён, fragment отбрасывается, dot-segments разрешаются, percent-encoding декодируется только для unreserved characters, путь приводится к NFC, trailing slash сохраняется, query-пары сортируются по `(name, value)` с сохранением duplicate pairs, а `utm_*`, `gclid`, `fbclid`, `msclkid`, `yclid`, `mc_cid` и `mc_eid` удаляются. Resource, selector, parameter и variant trim-ятся, переводятся в NFC и CRLF приводится к LF; literal NUL внутри поля не заменяется и не экранируется, а разбирается по byte length framing. Любое изменение этих правил требует новой версии fingerprint.

Golden vectors для `fingerprint-v1` хранятся в виде input, canonical payload и expected SHA-256 до изменения ruleset. В notation `NUL` означает один байт `0x00` (не текст `NUL`), `len:value` использует UTF-8 byte length, а `0x00` внутри value показывается hex-байтом:

| Вход / нормализованные поля | Canonical payload notation | Expected SHA-256 |
|---|---|---|
| `https://Example.com/a/`; остальные поля: `SEO-TECH-001`, `page`, пустые resource/selector/parameter, `v1` | `fluxradar-fp-v1 NUL 19:https://example.com NUL 12:SEO-TECH-001 NUL 4:page NUL 22:https://example.com/a/ NUL 0: NUL 0: NUL 0: NUL 2:v1 NUL` | `cedea5e5a080e49706f18ac36d631a7606633029022b18dbe5a2eaaa3803f4a4` |
| тот же vector, URL `/a` без trailing slash | `fluxradar-fp-v1 NUL 19:https://example.com NUL 12:SEO-TECH-001 NUL 4:page NUL 21:https://example.com/a NUL 0: NUL 0: NUL 0: NUL 2:v1 NUL` | `ed5ae2f899ffa133946d371e58e2ca22c4a77efbb315be10255e6a9fe74364e0` |
| query `?b=2&utm_source=x&a=1` после нормализации | `fluxradar-fp-v1 NUL 19:https://example.com NUL 12:SEO-TECH-001 NUL 4:page NUL 30:https://example.com/a/?a=1&b=2 NUL 0: NUL 0: NUL 0: NUL 2:v1 NUL` | `80378bf104df952b786b227fbecdf3b6f88ba8f7ce44406a82ba315f45e40c62` |
| тот же домен/rule/target, selector `div.hero` | `fluxradar-fp-v1 NUL 19:https://example.com NUL 12:SEO-TECH-001 NUL 4:page NUL 21:https://example.com/a NUL 0: NUL 8:div.hero NUL 0: NUL 2:v1 NUL` | `e7d4e04573dc75bc51cdbf726bcfd6be752e52632193ecec1c248c903b2aa03b` |
| настоящий NUL в selector `a<0x00>b` при `SEC-PASSIVE-001` и URL `/a` | `fluxradar-fp-v1 NUL 19:https://example.com NUL 15:SEC-PASSIVE-001 NUL 4:page NUL 21:https://example.com/a NUL 0: NUL 3:a 0x00 b NUL 0: NUL 2:v1 NUL` | `7835e6a2b09391bad2a24376f9b126794146746a7aada376a8765be87c018a92` |
| literal six-byte text `[backslash]u0000` в selector при `SEC-PASSIVE-001` и URL `/a` (`[backslash]` = один ASCII byte) | `fluxradar-fp-v1 NUL 19:https://example.com NUL 15:SEC-PASSIVE-001 NUL 4:page NUL 21:https://example.com/a NUL 0: NUL 6:[backslash]u0000 NUL 0: NUL 2:v1 NUL` | `9b7c5ac89a9d4e51f78743f5aa0f5eb9c5e37b3a25a79e92d3b1db580b459164` |

Дополнительные equivalence/difference vectors: `https://Example.com/a/` = `https://example.com/a/`; `/a` ≠ `/a/`; `?utm_source=x&b=2&a=1` = `?a=1&b=2`; duplicate query pairs сохраняются после сортировки; `https://example.com:443/a` = `https://example.com/a`; `https://example.com:8443/a` ≠ default-port URL; NFC = NFD после NFC-нормализации; empty resource/selector/parameter дают стабильные пустые поля; dot-segments дают canonical path; userinfo отклоняется.

Cross-module policy v1: deduplication выполняется только внутри одного module/rule namespace по полному fingerprint. Одинаковое evidence в SEO и Accessibility намеренно остаётся двумя findings, потому что это разные измерения и разные тарифные веса; penalty не дублируется внутри одного модуля. Для UI/экспорта такие случаи связываются отдельным non-scoring `evidence_group_id`, который не входит в fingerprint и не меняет score.

### Работа с проблемами

- поиск и фильтры;
- группировка по URL, типу и приоритету;
- экспорт только в Complete;
- отметка False Positive или Ignored;
- запуск нового оплаченного скана для проверки исправления;
- сравнение с предыдущими результатами только в Complete.

Массовое назначение, комментарии, внутренние заметки и рабочие задачи относятся к будущему командному режиму.

---

## 15. Score и дашборд

Главный дашборд должен показывать:

- Website Health Score с указанием версии методики и полноты данных;
- оценки SEO, Security, AI Visibility, Performance, Accessibility, Content, Privacy, Reliability, UX/Conversion и Analytics;
- количество критических проблем;
- динамику по сравнению с предыдущим сканированием, если это Complete и есть сохранённая история;
- наиболее важные изменения;
- рекомендованный следующий шаг;
- состояние текущего скана, завершённые модули и ошибки источников.

Методика расчёта score фиксированная и прозрачная для всех пользователей. Для каждого модуля берётся 100 баллов и вычитаются подтверждённые нарушения: Critical −25, High −10, Medium −3, Low −1. Для page-level проблемы вычет умножается на долю затронутых уникальных URL; site-level проблема учитывается полностью. Итог модуля ограничен диапазоном 0–100.

Точная формула module score: для каждого `rule_id` берётся максимальная severity его уникальных *scored findings*, рассчитывается `rule_penalty = severity_weight × min(1, affected_targets / applicable_targets)` для page-level правила или `severity_weight` для site-level правила. Rule resolver может явно назначить finding `score_delta=0` (информационный finding), и такой finding не входит в Σ; повторяющиеся findings с одним fingerprint считаются один раз. `module_score = round2(max(0, 100 − Σ rule_penalty))`. `round2` означает округление до двух знаков после запятой; отображение в UI округляется до целого только после хранения точного значения.

Термины score имеют формальное значение: `applicable check` — одна оценка одного `rule_id` для одной нормализованной цели в конфигурации скана; `applicable target` — цель, которая входит в scope и для которой правило должно быть оценено; `affected target` — applicable target с подтверждённым finding. Для page-level rules `applicable_targets` — число применимых нормализованных целей, а `affected_targets` не может его превышать; для site-level rules оба значения равны `1`. Проверка, не выполненная из-за ошибки загрузки, не становится affected, но остаётся в знаменателе coverage только если была применимой. При `applicable_targets=0` rule не штрафует score и получает `Not applicable` с обязательной причиной.

В Complete общий score рассчитывается по фиксированным весам: SEO 20%, AI Visibility 15%, Security 20%, Performance 15%, Accessibility 10%, Reliability 10%, Content 5%, Privacy 5%. UX/Conversion и Analytics являются дополнительными оценками 0–100 и не входят в общий score текущего релиза, потому что зависят от необязательных данных и не должны искусственно менять техническую оценку. В Basic показывается отдельный Basic Score: SEO 60% и AI Visibility 40%. Free score не рассчитывается.

Для каждого модуля рассчитывается coverage: доля завершённых проверок от общего числа применимых проверок. `Completed` имеет coverage 100%, `Partial` — от 1% до 99%, `Unavailable` — 0%. Для итогового score используется эффективный вес `module weight × coverage` только если модуль имеет usable output; для `Unavailable`, `Not applicable` и completed-but-unusable module effective weight равен `0`. После этого веса доступных и пригодных для score модулей нормализуются к 100%. Таким образом, недоступный или завершённый без валидного результата модуль не превращается в нулевой балл, но его отсутствие output и coverage видны пользователю.

Точная формула общего score: `effective_weight_i = tariff_weight_i × coverage_i`, если у модуля есть usable output, иначе `effective_weight_i = 0`; `weighted_coverage = Σ effective_weight_i / Σ tariff_weight_i`; `overall_score = round2(Σ(module_score_i × effective_weight_i) / Σ effective_weight_i)`. В знаменатель `Σ tariff_weight_i` входят все модули тарифа, включая `Unavailable`, `Not applicable` и completed-but-unusable modules; в знаменатель итоговой дроби входят только модули с `effective_weight_i > 0`, у которых есть числовой `module_score_i`. Поэтому отсутствие всех пригодных для score модулей корректно даёт `Insufficient data`, а не деление на ноль.

Если weighted coverage составляет не менее 80%, показывается обычный score. При coverage от 50% до 79.99% score показывается с пометкой `Provisional`. При coverage ниже 50% общий score не рассчитывается и заменяется состоянием `Insufficient data`. Это правило одинаково применяется к Complete и Basic, но с разными фиксированными весами модулей. В отчёте всегда видны coverage, применённые веса, найденные проблемы и их вклад в score.

Для `Partial` module score рассчитывается только по завершённым применимым проверкам, а coverage уменьшает его эффективный вес. Для `Failed` и `Cancelled` незавершённые проверки не получают баллов, а завершённая часть сохраняется как `Partial`; если не завершена ни одна применимая проверка, модуль получает `Unavailable`. Если все applicable checks модуля завершены, но ни один результат не образует валидный usable output, модуль остаётся `Completed` с coverage `1`, score `null` и без issue records; причина отсутствия usable output фиксируется на уровне scan как `NoUsableOutput`, а не как искусственный `Partial`/`Unavailable`. При нулевом количестве применимых проверок модуль получает `Not applicable`, имеет нулевой effective weight и остаётся в общем знаменателе tariff weights. Если все модули, входящие в тариф, имеют `Unavailable` или `Not applicable`, effective-weight denominator равен нулю, поэтому общий score не рассчитывается и показывается `Insufficient data`. Наличие `Partial` модулей само по себе не запрещает score: для них применяется общий порог weighted coverage из предыдущего абзаца. Для Complete при наличии хотя бы одного корректно завершённого модуля остальные состояния и причины видны в summary.

Для скана со статусом `Failed` или `Cancelled` score показывается только если хотя бы один модуль имеет usable output; наличие завершённых, но непригодных результатов само по себе score не создаёт, иначе показывается `Insufficient data`. Для `Not applicable` модулей причина и количество применимых проверок обязательны в summary. Для Basic порог `Provisional` применяется отдельно к SEO и AI Visibility, как указано выше; для Complete он применяется к weighted coverage всего тарифа.

Для Basic используется ровно та же effective-weight формула: `tariff_weight_SEO=0.60`, `tariff_weight_AI=0.40`, `effective_weight_i = tariff_weight_i × coverage_i` только при usable output, иначе `0`, `weighted_coverage = (effective_weight_SEO + effective_weight_AI) / 1.00`, а итоговый score считается только по модулям с effective weight больше нуля и числовым module score. При `weighted_coverage >= 0.80` Basic Score обычный, при `0.50 <= weighted_coverage < 0.80` — `Provisional`, при `weighted_coverage < 0.50` или нулевом знаменателе — `Insufficient data`. Отдельный модуль с coverage ниже 80% помечается `Provisional`, но это не меняет итоговое правило; при недоступности или completed-but-unusable одного модуля доступный score не превращается в ноль.

Coverage/status contract v1: `coverage = completed_applicable_checks / applicable_checks`, округление для отображения — до двух знаков, расчёт — по точному значению. Runtime-статусы `Pending`, `Queued` и `Running` не экспортируются в Complete records; до завершения score не публикуется. Для terminal export records `Completed` имеет coverage `1` при `applicable_checks > 0`; `Partial` имеет `0 < coverage < 1`; `Unavailable` имеет coverage `0` и обязательный `status_reason`; `Not applicable` имеет coverage `0`, `applicable_checks=0`, effective weight `0` и обязательный `status_reason`. Scan status `Failed` или `Cancelled` после частичного выполнения экспортирует модули с незавершёнными применимыми проверками как `Partial`, а полностью завершённые модули оставляет `Completed` даже если у них нет usable output. Нулевой usable output остаётся в summary как `Failed`/`Cancelled` с reason, даже если отдельные модули завершили проверки без валидного результата. Завершённый модуль с coverage `1` может иметь `score=null` и не иметь issue records только в этом completed-but-unusable случае; scan-level `NoUsableOutput` определяет отсутствие результата и refund. Для `Unavailable` и `Not applicable` score отсутствует; `status_reason` обязателен для summary и module records во всех состояниях, кроме обычного `Completed`, и для `ai_response` только при `Partial` (этот record создаётся лишь после нормализованного provider response). У `issue` record `status_reason` всегда `null`: причина частичного или недоступного модуля хранится в соответствующем module/ai_response record, а не дублируется в каждой issue-записи.

### Мониторинг и уведомления

**Статус:** будущая возможность, не входит в текущую pay-per-scan версию.

- регулярные сканирования;
- уведомления обо всех новых проблемах;
- уведомления обо всех изменениях score;
- уведомления об инцидентах uptime, SSL и DNS;
- email;
- Slack;
- webhooks;
- история уведомлений.

Уведомления планируются для будущей версии с регулярным мониторингом. В текущей pay-per-scan версии автоматический мониторинг и уведомления не предоставляются.

---

## 16. Отчёты

- Complete: отчёт по одному сайту, выбранному модулю, текущему скану и сравнению с сохранённым предыдущим сканом;
- Complete: PDF, CSV и ссылка на онлайн-отчёт;
- Basic: только dashboard текущего скана, без PDF/CSV, истории и ссылки на сохранённый отчёт;
- Free: только экран результата бесплатной проверки;
- плановая отправка отчётов — будущая возможность после добавления регулярного мониторинга;
- в Complete доступны техническое резюме и executive summary;
- отчёт можно передать клиенту ссылкой или файлом, но white-label и настройка брендинга не входят в текущий scope;
- внутренние диагностические детали не скрываются автоматически: пользователь выбирает технический или сокращённый вид отчёта.

### Export schema v1

Экспорт доступен только Complete. CSV, PDF и online report строятся из одной канонической модели records, но имеют разные представления. CSV имеет одну строку на `record_type`: сначала одна `summary`, затем по одной `module` на модуль, затем `ai_response` для каждого provider/request в порядке `provider`, `request_id`, затем `issue` по severity `Critical → High → Medium → Low` и fingerprint в лексикографическом порядке. Если проблем нет, CSV всё равно содержит одну summary-строку; AI-ответы при наличии остаются отдельными records и не смешиваются с issue records.

CSV contract v1: UTF-8 без BOM, LF line endings, RFC 4180 quoting (поле в кавычках при наличии comma, quote или newline; quote удваивается), первая строка — фиксированный header в порядке полей data dictionary, числа используют точку и два знака после запятой для score/penalty/delta, timestamps — UTC RFC3339 с `Z`, `null` сериализуется пустым полем. `record_type` и фиксированный header отличают пустое значение от отсутствующего record. `evidence_ref` — стабильный reference внутри отчёта, а не raw evidence; online report выдаёт защищённую signed URL на 15 минут после авторизации.

PDF contract v1: титульная страница, scan summary, module score/coverage, затем issues в том же порядке severity/fingerprint, что и CSV. Для каждой проблемы PDF показывает ровно одно ключевое evidence и `evidence_ref`; полный screenshot/trace доступен только в online report. При нулевом числе issues PDF всё равно содержит summary и таблицу модулей. PDF и CSV должны строиться из одной версии canonical records и иметь одинаковые scan ID, module statuses, scores и issue set.

Data dictionary v1:

| Поле | Тип и nullability | Допустимые значения / правило |
|---|---|---|
| `schema_version` | string, required | только `1.0` |
| `record_type` | enum, required | `summary`, `module`, `ai_response`, `issue` |
| `scan_id` | string, required | immutable ID оплаченного прогона |
| `domain` | string, required | normalized public origin |
| `plan` | enum, required | для export records только `Complete Scan`; Free/Basic export не создаётся |
| `started_at`, `completed_at`, `observed_at` | RFC3339 string, required | только UTC с суффиксом `Z`; export schema — только terminal snapshot, поэтому все три timestamp обязательны |
| `ruleset_version` | string, required | immutable ruleset ID |
| `module` | enum, required for module/ai_response/issue; null for summary | current release module name |
| `module_status` | enum, required for module/ai_response/issue; null for summary | module: `Completed`, `Partial`, `Unavailable`, `Not applicable`; issue: `Completed` or `Partial`; ai_response: only `Completed` or `Partial` after a normalized provider response |
| `scan_status` | enum, required for summary; null otherwise | terminal scan status: `Partial`, `Completed`, `Failed`, `Cancelled`; summary-only |
| `request_id_source`, `usage_source` | enum, nullable | `provider`, `local` / `provider`, `estimated`; AI-only |
| `tokenizer_version` | string, nullable | required when `usage_source=estimated` |
| `coverage` | number `0..1`, nullable | required for module/summary; null for issue |
| `applicable_checks`, `completed_applicable_checks` | integer `>=0`, nullable | required for module; null for summary/ai_response/issue; completed cannot exceed applicable |
| `score` | number `0..100`, nullable | null for `Unavailable`, `Insufficient data`, issue records и `Completed` module без валидного usable output |
| `applicable_targets`, `affected_targets` | integer `>=0`, nullable | issue-only accounting fields; `affected_targets <= applicable_targets` for page-level rules |
| `rule_penalty`, `score_delta` | number, nullable | issue-only; `rule_penalty >= 0`, `score_delta = -rule_penalty` |
| `issue_id`, `fingerprint` | string, nullable | required for issue; null for summary/module/ai_response |
| `rule_id`, `target_kind`, `normalized_url`, `normalized_resource`, `normalized_selector`, `normalized_parameter`, `rule_variant` | string, nullable | issue-only fingerprint inputs; empty normalized component is serialized as `0:`, not omitted |
| `metric_key` | string, nullable | issue-only; required and non-empty for every performance metric finding/regression, canonical form `normalized_url|profile|cache_mode|metric_name`; `null` for non-performance issues; `rule_variant` must encode the same value |
| `evidence_group_id` | string, nullable | issue-only non-scoring link for the same evidence across modules |
| `category`, `severity`, `confidence`, `status` | enum/string, nullable | issue-only; severity `Critical/High/Medium/Low`, status из Issue Center |
| `target_url`, `evidence_type`, `evidence_ref`, `evidence_excerpt`, `recommendation` | string, nullable | issue-only; `evidence_excerpt` не более 2 048 Unicode characters; evidence type `none/http/dom/screenshot/trace/mixed` |
| `status_reason` | string, nullable | required for summary `Partial`/`Failed`/`Cancelled`, module `Partial`/`Unavailable`/`Not applicable` and ai_response `Partial`; null for ordinary `Completed` and always null for issue records, где причина хранится в module/ai_response record; pre-response AI unavailability представлена module `Unavailable` record с непустой причиной, а ai_response record отсутствует |
| `provider`, `api_version`, `model_id`, `prompt_version`, `request_id`, `ai_request_key`, `raw_text`, `provider_created_at`, `finish_reason` | string, nullable | ai_response-only; values copied from normalized AI response contract |
| `citations` | array of strings, nullable | ai_response-only; provider-returned citations in response order |
| `usage` | object, nullable | ai_response-only; `input_tokens`, `output_tokens`, `total_tokens`, `reasoning_units`, `search_units`, `citation_units`; `usage_source` хранится отдельным top-level полем |
| `deletion_evidence_ref` | string, nullable | ai_response-only; non-empty reference to the durable `AI-001` deletion-control record; the referenced control may be `Pending` at scan export and later receives provider completion evidence |

Канонический JSON record имеет те же поля и типы:

```json
{
  "schema_version": "1.0",
  "record_type": "issue",
  "scan_id": "scan_01J...",
  "domain": "https://example.com",
  "plan": "Complete Scan",
  "started_at": "2026-09-03T10:00:00Z",
  "completed_at": "2026-09-03T10:12:00Z",
  "observed_at": "2026-09-03T10:05:00Z",
  "ruleset_version": "rules-v1",
  "module": "SEO",
  "module_status": "Completed",
  "scan_status": null,
  "status_reason": null,
  "rule_id": "SEO-TECH-004",
  "target_kind": "page",
  "normalized_url": "https://example.com/page",
  "normalized_resource": "",
  "normalized_selector": "",
  "normalized_parameter": "",
  "rule_variant": "v1",
  "evidence_group_id": "eg_01J...",
  "coverage": null,
  "applicable_checks": null,
  "completed_applicable_checks": null,
  "score": null,
  "applicable_targets": 1,
  "affected_targets": 1,
  "rule_penalty": 10.00,
  "score_delta": -10.00,
  "issue_id": "iss_01J...",
  "fingerprint": "fluxradar-fp-v1:...",
  "category": "canonical",
  "severity": "High",
  "confidence": 0.98,
  "status": "New",
  "target_url": "https://example.com/page",
  "evidence_type": "http",
  "evidence_ref": "/reports/report_01J/evidence/iss_01J",
  "evidence_excerpt": "HTTP 200; canonical points to https://example.com/other",
  "recommendation": "Set a self-referencing canonical URL.",
  "metric_key": null
}
```

Машинный контракт `fluxradar-export-1.0-record.schema.json` фиксирует типы и обязательность на уровне API:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://fluxradar.com/schemas/export/1.0/record.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema_version", "record_type", "scan_id", "domain", "plan", "started_at", "completed_at", "observed_at", "ruleset_version", "module_status", "scan_status"],
  "allOf": [
    {
      "if": {
        "properties": {
          "record_type": {"const": "module"},
          "module_status": {"enum": ["Partial", "Unavailable", "Not applicable"]}
        }
      },
      "then": {
        "required": ["status_reason"],
        "properties": {"status_reason": {"type": "string", "minLength": 1}}
      }
    },
    {
      "if": {
        "properties": {
          "record_type": {"const": "ai_response"},
          "module_status": {"const": "Partial"}
        }
      },
      "then": {
        "required": ["status_reason"],
        "properties": {"status_reason": {"type": "string", "minLength": 1}}
      }
    },
    {
      "if": {
        "properties": {
          "record_type": {"const": "summary"},
          "scan_status": {"enum": ["Partial", "Failed", "Cancelled"]}
        }
      },
      "then": {
        "required": ["status_reason"],
        "properties": {"status_reason": {"type": "string", "minLength": 1}}
      }
    },
    {
      "if": {
        "properties": {
          "record_type": {"const": "summary"},
          "scan_status": {"const": "Completed"}
        }
      },
      "then": {
        "properties": {"status_reason": {"const": null}}
      }
    },
    {
      "if": {
        "properties": {
          "record_type": {"enum": ["module", "ai_response"]},
          "module_status": {"const": "Completed"}
        }
      },
      "then": {
        "properties": {"status_reason": {"const": null}}
      }
    }
  ],
  "oneOf": [
    {
      "title": "summary record",
      "required": ["record_type", "module", "coverage", "score", "issue_id", "fingerprint", "category", "severity", "confidence", "status", "target_url", "evidence_type", "evidence_ref", "recommendation", "status_reason"],
      "properties": {
        "record_type": {"const": "summary"},
        "module": {"const": null},
        "module_status": {"const": null},
        "scan_status": {"enum": ["Partial", "Completed", "Failed", "Cancelled"]},
        "coverage": {"type": "number", "minimum": 0, "maximum": 1},
        "applicable_checks": {"const": null},
        "completed_applicable_checks": {"const": null},
        "issue_id": {"const": null},
        "fingerprint": {"const": null},
        "category": {"const": null},
        "severity": {"const": null},
        "confidence": {"const": null},
        "status": {"const": null},
        "target_url": {"const": null},
        "evidence_type": {"const": null},
        "evidence_ref": {"const": null},
        "recommendation": {"const": null},
        "evidence_excerpt": {"const": null},
        "status_reason": {"type": ["string", "null"]},
        "rule_id": {"const": null},
        "target_kind": {"const": null},
        "normalized_url": {"const": null},
        "normalized_resource": {"const": null},
        "normalized_selector": {"const": null},
        "normalized_parameter": {"const": null},
        "rule_variant": {"const": null},
        "metric_key": {"const": null},
        "evidence_group_id": {"const": null},
        "request_id_source": {"const": null},
        "usage_source": {"const": null},
        "tokenizer_version": {"const": null},
        "provider": {"const": null},
        "api_version": {"const": null},
        "model_id": {"const": null},
        "prompt_version": {"const": null},
        "request_id": {"const": null},
        "ai_request_key": {"const": null},
        "raw_text": {"const": null},
        "provider_created_at": {"const": null},
        "citations": {"const": null},
        "usage": {"const": null},
        "finish_reason": {"const": null},
        "deletion_evidence_ref": {"const": null},
        "applicable_targets": {"const": null},
        "affected_targets": {"const": null},
        "rule_penalty": {"const": null},
        "score_delta": {"const": null}
      }
    },
    {
      "title": "module record",
      "required": ["record_type", "module", "module_status", "coverage", "applicable_checks", "completed_applicable_checks", "score", "issue_id", "fingerprint", "category", "severity", "confidence", "status", "target_url", "evidence_type", "evidence_ref", "recommendation", "status_reason"],
      "properties": {
        "record_type": {"const": "module"},
        "module": {"type": "string", "minLength": 1},
        "module_status": {"enum": ["Completed", "Partial", "Unavailable", "Not applicable"]},
        "scan_status": {"const": null},
        "coverage": {"type": "number", "minimum": 0, "maximum": 1},
        "applicable_checks": {"type": "integer", "minimum": 0},
        "completed_applicable_checks": {"type": "integer", "minimum": 0},
        "issue_id": {"const": null},
        "fingerprint": {"const": null},
        "category": {"const": null},
        "severity": {"const": null},
        "confidence": {"const": null},
        "status": {"const": null},
        "target_url": {"const": null},
        "evidence_type": {"const": null},
        "evidence_ref": {"const": null},
        "recommendation": {"const": null},
        "evidence_excerpt": {"const": null},
        "status_reason": {"type": ["string", "null"]},
        "rule_id": {"const": null},
        "target_kind": {"const": null},
        "normalized_url": {"const": null},
        "normalized_resource": {"const": null},
        "normalized_selector": {"const": null},
        "normalized_parameter": {"const": null},
        "rule_variant": {"const": null},
        "metric_key": {"const": null},
        "evidence_group_id": {"const": null},
        "request_id_source": {"const": null},
        "usage_source": {"const": null},
        "tokenizer_version": {"const": null},
        "provider": {"const": null},
        "api_version": {"const": null},
        "model_id": {"const": null},
        "prompt_version": {"const": null},
        "request_id": {"const": null},
        "ai_request_key": {"const": null},
        "raw_text": {"const": null},
        "provider_created_at": {"const": null},
        "citations": {"const": null},
        "usage": {"const": null},
        "finish_reason": {"const": null},
        "deletion_evidence_ref": {"const": null},
        "applicable_targets": {"const": null},
        "affected_targets": {"const": null},
        "rule_penalty": {"const": null},
        "score_delta": {"const": null}
      }
    },
    {
      "title": "ai_response record",
      "required": ["record_type", "module", "module_status", "scan_status", "coverage", "score", "applicable_targets", "affected_targets", "rule_penalty", "score_delta", "issue_id", "fingerprint", "category", "severity", "confidence", "status", "target_url", "evidence_type", "evidence_ref", "evidence_excerpt", "recommendation", "status_reason", "provider", "api_version", "model_id", "prompt_version", "request_id", "ai_request_key", "request_id_source", "usage_source", "raw_text", "provider_created_at", "citations", "usage", "finish_reason", "deletion_evidence_ref"],
      "properties": {
        "record_type": {"const": "ai_response"},
        "module": {"const": "AI SEO / GEO"},
        "module_status": {"enum": ["Completed", "Partial"]},
        "scan_status": {"const": null},
        "coverage": {"const": null},
        "applicable_checks": {"const": null},
        "completed_applicable_checks": {"const": null},
        "score": {"const": null},
        "applicable_targets": {"const": null},
        "affected_targets": {"const": null},
        "rule_penalty": {"const": null},
        "score_delta": {"const": null},
        "issue_id": {"const": null},
        "fingerprint": {"const": null},
        "category": {"const": null},
        "severity": {"const": null},
        "confidence": {"const": null},
        "status": {"const": null},
        "target_url": {"const": null},
        "evidence_type": {"const": null},
        "evidence_ref": {"const": null},
        "evidence_excerpt": {"const": null},
        "recommendation": {"const": null},
        "status_reason": {"type": ["string", "null"]},
        "rule_id": {"const": null},
        "target_kind": {"const": null},
        "normalized_url": {"const": null},
        "normalized_resource": {"const": null},
        "normalized_selector": {"const": null},
        "normalized_parameter": {"const": null},
        "rule_variant": {"const": null},
        "metric_key": {"const": null},
        "evidence_group_id": {"const": null},
        "provider": {"type": "string", "minLength": 1},
        "api_version": {"type": "string", "minLength": 1},
        "model_id": {"type": "string", "minLength": 1},
        "prompt_version": {"type": "string", "minLength": 1},
        "request_id": {"type": "string", "minLength": 1},
        "ai_request_key": {"type": "string", "minLength": 1},
        "usage_source": {"enum": ["provider", "estimated"]},
        "request_id_source": {"enum": ["provider", "local"]},
        "raw_text": {"type": "string"},
        "provider_created_at": {"type": ["string", "null"], "format": "date-time", "pattern": "Z$"},
        "citations": {"type": "array", "items": {"type": "string"}},
        "usage": {
          "type": "object",
          "additionalProperties": false,
          "required": ["input_tokens", "output_tokens", "total_tokens"],
          "properties": {
            "input_tokens": {"type": "integer", "minimum": 0},
            "output_tokens": {"type": "integer", "minimum": 0},
            "total_tokens": {"type": "integer", "minimum": 0},
            "reasoning_units": {"type": ["integer", "null"], "minimum": 0},
            "search_units": {"type": ["integer", "null"], "minimum": 0},
            "citation_units": {"type": ["integer", "null"], "minimum": 0}
          }
        },
        "finish_reason": {"enum": ["stop", "length", "safety", "error", null]},
        "deletion_evidence_ref": {"type": "string", "minLength": 1}
      }
    },
    {
      "title": "issue record",
      "required": ["record_type", "module", "module_status", "coverage", "score", "applicable_targets", "affected_targets", "rule_penalty", "score_delta", "rule_id", "target_kind", "normalized_url", "normalized_resource", "normalized_selector", "normalized_parameter", "rule_variant", "metric_key", "evidence_group_id", "issue_id", "fingerprint", "category", "severity", "confidence", "status", "target_url", "evidence_type", "evidence_ref", "evidence_excerpt", "recommendation", "status_reason"],
      "properties": {
        "record_type": {"const": "issue"},
        "module": {"type": "string", "minLength": 1},
        "module_status": {"enum": ["Completed", "Partial"]},
        "scan_status": {"const": null},
        "coverage": {"const": null},
        "applicable_checks": {"const": null},
        "completed_applicable_checks": {"const": null},
        "score": {"const": null},
        "applicable_targets": {"type": "integer", "minimum": 0},
        "affected_targets": {"type": "integer", "minimum": 0},
        "rule_penalty": {"type": "number", "minimum": 0, "maximum": 25},
        "score_delta": {"type": "number", "minimum": -25, "maximum": 0},
        "rule_id": {"type": "string", "minLength": 1},
        "target_kind": {"enum": ["page", "site", "api", "environment"]},
        "normalized_url": {"type": "string"},
        "normalized_resource": {"type": "string"},
        "normalized_selector": {"type": "string"},
        "normalized_parameter": {"type": "string"},
        "rule_variant": {"type": "string", "minLength": 1},
        "metric_key": {"type": ["string", "null"]},
        "evidence_group_id": {"type": ["string", "null"]},
        "issue_id": {"type": "string", "minLength": 1},
        "fingerprint": {"type": "string", "pattern": "^fluxradar-fp-v1:.+"},
        "category": {"type": "string", "minLength": 1},
        "severity": {"enum": ["Critical", "High", "Medium", "Low"]},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "status": {"enum": ["New", "Acknowledged", "Resolved", "Reopened", "Ignored", "False Positive"]},
        "target_url": {"type": "string", "format": "uri"},
        "evidence_type": {"enum": ["none", "http", "dom", "screenshot", "trace", "mixed"]},
        "evidence_ref": {"type": "string", "minLength": 1},
        "evidence_excerpt": {"type": ["string", "null"], "maxLength": 2048},
        "recommendation": {"type": "string", "minLength": 1},
        "status_reason": {"const": null},
        "request_id_source": {"const": null},
        "usage_source": {"const": null},
        "tokenizer_version": {"const": null},
        "provider": {"const": null},
        "api_version": {"const": null},
        "model_id": {"const": null},
        "prompt_version": {"const": null},
        "request_id": {"const": null},
        "ai_request_key": {"const": null},
        "raw_text": {"const": null},
        "provider_created_at": {"const": null},
        "citations": {"const": null},
        "usage": {"const": null},
        "finish_reason": {"const": null},
        "deletion_evidence_ref": {"const": null}
      }
    }
  ],
  "properties": {
    "schema_version": {"const": "1.0"},
    "record_type": {"enum": ["summary", "module", "ai_response", "issue"]},
    "scan_id": {"type": "string", "minLength": 1},
    "domain": {"type": "string", "format": "uri"},
    "plan": {"const": "Complete Scan"},
    "started_at": {"type": "string", "format": "date-time", "pattern": "Z$"},
    "completed_at": {"type": "string", "format": "date-time", "pattern": "Z$"},
    "observed_at": {"type": "string", "format": "date-time", "pattern": "Z$"},
    "ruleset_version": {"type": "string", "minLength": 1},
    "module": {"enum": ["SEO", "AI SEO / GEO", "Security", "Performance", "Accessibility", "Reliability", "Content Quality", "Privacy", "UX/Conversion", "Analytics", null]},
    "module_status": {"enum": [null, "Completed", "Partial", "Unavailable", "Not applicable"]},
    "scan_status": {"enum": [null, "Partial", "Completed", "Failed", "Cancelled"]},
    "request_id_source": {"enum": ["provider", "local", null]},
    "usage_source": {"enum": ["provider", "estimated", null]},
    "tokenizer_version": {"type": ["string", "null"]},
    "coverage": {"type": ["number", "null"], "minimum": 0, "maximum": 1},
    "applicable_checks": {"type": ["integer", "null"], "minimum": 0},
    "completed_applicable_checks": {"type": ["integer", "null"], "minimum": 0},
    "score": {"type": ["number", "null"], "minimum": 0, "maximum": 100},
    "applicable_targets": {"type": ["integer", "null"], "minimum": 0},
    "affected_targets": {"type": ["integer", "null"], "minimum": 0},
    "rule_penalty": {"type": ["number", "null"], "minimum": 0, "maximum": 25},
    "score_delta": {"type": ["number", "null"], "minimum": -25, "maximum": 0},
    "rule_id": {"type": ["string", "null"]},
    "target_kind": {"enum": ["page", "site", "api", "environment", null]},
    "normalized_url": {"type": ["string", "null"]},
    "normalized_resource": {"type": ["string", "null"]},
    "normalized_selector": {"type": ["string", "null"]},
    "normalized_parameter": {"type": ["string", "null"]},
    "rule_variant": {"type": ["string", "null"]},
    "metric_key": {"type": ["string", "null"]},
    "evidence_group_id": {"type": ["string", "null"]},
    "issue_id": {"type": ["string", "null"]},
    "fingerprint": {"type": ["string", "null"], "pattern": "^fluxradar-fp-v1:"},
    "category": {"type": ["string", "null"]},
    "severity": {"enum": ["Critical", "High", "Medium", "Low", null]},
    "confidence": {"type": ["number", "null"], "minimum": 0, "maximum": 1},
    "status": {"enum": ["New", "Acknowledged", "Resolved", "Reopened", "Ignored", "False Positive", null]},
    "target_url": {"type": ["string", "null"], "format": "uri"},
    "evidence_type": {"enum": ["none", "http", "dom", "screenshot", "trace", "mixed", null]},
    "evidence_ref": {"type": ["string", "null"]},
    "recommendation": {"type": ["string", "null"]},
    "evidence_excerpt": {"type": ["string", "null"], "maxLength": 2048},
    "status_reason": {"type": ["string", "null"]},
    "provider": {"type": ["string", "null"]},
    "api_version": {"type": ["string", "null"]},
    "model_id": {"type": ["string", "null"]},
    "prompt_version": {"type": ["string", "null"]},
    "request_id": {"type": ["string", "null"]},
    "ai_request_key": {"type": ["string", "null"]},
    "raw_text": {"type": ["string", "null"]},
    "provider_created_at": {"type": ["string", "null"], "format": "date-time", "pattern": "Z$"},
    "citations": {"type": ["array", "null"], "items": {"type": "string"}},
    "usage": {"type": ["object", "null"]},
    "finish_reason": {"type": ["string", "null"]},
    "deletion_evidence_ref": {"type": ["string", "null"]}
  }
}
```

`confidence` находится в диапазоне `0..1`. Схема намеренно использует `oneOf` и `additionalProperties: false`: summary, module, ai_response и issue records нельзя смешать, а Complete — единственный экспортируемый план. Для summary/module records issue-поля и issue accounting fields имеют `null`; для issue records score/coverage имеют `null`, а `applicable_targets`, `affected_targets`, `rule_penalty`, `score_delta`, `metric_key` и evidence-поля обязательны по issue contract. Для performance issue semantic validator дополнительно требует непустой `metric_key` и его соответствие `rule_variant`; для остальных issue `metric_key=null`. Для `ai_response` обязательны provider/model/prompt/request/usage/raw response и deletion evidence из нормализованного AI contract. `score_delta` всегда равен `-rule_penalty`; для site-level rule `applicable_targets=affected_targets=1`. JSON Schema проверяет типы и форму record, а cross-field invariants (`affected_targets <= applicable_targets`, `score_delta = -rule_penalty`, site-level targets = 1 и `usage.total_tokens = input_tokens + output_tokens`, если provider вернул все значения) проверяются отдельным semantic validator в `EXPORT-001`/CI. Полные screenshots и traces не встраиваются в CSV/PDF: `evidence_ref` ведёт на защищённый online report, который выдаёт временную signed URL на 15 минут после авторизации. После retention или удаления ссылка возвращает `410 Gone`. Изменение схемы требует новой `schema_version` и обратной совместимости для сохранённых Complete-отчётов.
`EXPORT-001` обязан отклонять record при нарушении любого cross-field invariant. Полный список обязательных проверок: (1) record-type nullability и Complete-only plan; (2) `started_at <= observed_at <= completed_at` для непустых timestamp-ов, UTC `Z` и `completed_at` обязателен для terminal scan status; (3) branch-aware `scan_status`/`module_status`/`status_reason` consistency, включая обязательный non-empty reason для summary non-terminal status и module/ai_response non-Completed status, `status_reason=null` для ordinary Completed и `status_reason=null` для всех issue records; (4) coverage/counts consistency: `0 <= completed_applicable_checks <= applicable_checks`, `coverage = completed/applicable` при applicable > 0, `Not applicable=0 applicable checks`; (5) module score присутствует только у terminal Completed/Partial с usable checks, отсутствует у unavailable/not-applicable и у completed-but-unusable module; для completed-but-unusable effective weight обязан быть `0`, а summary score присутствует только при weighted coverage >= 0.50 и наличии usable output; при `NoUsableOutput` summary score отсутствует; (6) `affected_targets <= applicable_targets`, site-level targets равны `1`; (7) `score_delta = -rule_penalty`; (8) fingerprint пересчитывается из точного набора `domain + rule_id + target_kind + normalized_url + normalized_resource + normalized_selector + normalized_parameter + rule_variant`; (9) module aggregation не считает fingerprint дважды, использует max severity по rule, применяет верную severity weight и honour-ит explicit non-scoring resolver; для каждого performance metric finding/regression `metric_key` обязателен, непуст, имеет каноническое значение `normalized_url|profile|cache_mode|metric_name` и совпадает с metric-компонентами в `rule_variant`; `PERF-RULE-014` всегда zero penalty, а `PERF-RULE-015` получает `score_delta=0` только если у него совпадают тот же `metric_key` и тот же source rule (`PERF-RULE-002` для TTFB, `PERF-RULE-003` для LCP/INP/CLS и соответствующий `PERF-RULE-004..013` для остальных metrics) с уже scored current finding; finding LCP не подавляет regression INP, и наоборот; (10) `usage.total_tokens = input_tokens + output_tokens`, caps соблюдены, а `usage_source=estimated` требует `tokenizer_version`; (11) для `ai_response` records AI metadata совпадает с `AI-001`, а `ai_request_key` и deletion evidence присутствуют; module `Unavailable` pre-response records не требуют AI metadata и не создают ai_response record; (12) evidence excerpt и export ordering соответствуют CSV/PDF contract; (13) cross-record summary/module/issue/ai_response set совпадает с dashboard и не содержит второй terminal scan/refund record. Semantic validator запускается после JSON Schema и до записи CSV/PDF; в export не попадает record, который прошёл только синтаксическую schema-проверку.

---

## 17. Аккаунты и профили сайтов

- регистрация и вход через email/пароль и Google OAuth;
- Free предоставляет одну бесплатную проверку одного домена;
- Basic Scan проверяет один домен за один платёж;
- Complete Scan проверяет один домен за один платёж;
- пользователь управляет собственными профилями сайтов и отдельными прогонами;
- команда, приглашение участников, роли, назначение ответственных, комментарии и клиентский audit log относятся к будущей подписке;
- настройка часового пояса и языка.

2FA для клиентов, Apple OAuth и корпоративный SSO не входят в текущий релиз. Для администраторов FluxLab 2FA обязательна до запуска production.

---

## 18. Pay-per-scan и биллинг

### Модель доступа

- бесплатная одноразовая минимальная проверка только главной страницы по базовым SEO-параметрам: title, H1, meta description и индексация; полный функционал недоступен; для запуска требуется регистрация; результат сохраняется, повторное сканирование недоступно;
- Basic Scan с SEO и AI SEO / GEO;
- Complete Scan со всеми модулями текущего релиза;
- каждый оплаченный прогон является отдельной покупкой;
- регулярный мониторинг и уведомления не входят в текущую версию.

### Платёжная часть

- self-service оплата через Paddle;
- trial-период не используется;
- пользователь начинает с бесплатной проверки главной страницы;
- после бесплатной проверки пользователь покупает Basic Scan или Complete Scan;
- один прогон — один платёж;
- подписка, upgrade/downgrade и cancellation не используются;
- регулярная частота сканирования и месячные квоты запусков не используются.

### Жизненный цикл покупки и скана

1. Пользователь выбирает один домен, тариф и область сканирования.
2. Скан запускается только после подтверждённого webhook от Paddle со статусом `paid`.
3. До подтверждения оплаты доступны только checkout и статус ожидания; entitlement и результаты не создаются.
4. Статусы прогона: `Pending`, `Queued`, `Running`, `Partial`, `Completed`, `Failed`, `Cancelled`.
5. Если FluxRadar не смог начать скан или не завершил ни одного модуля по своей технической ошибке, покупка не считается использованной: пользователь получает повторный запуск без доплаты. Если повторный запуск также невозможен, применяется полный refund по опубликованной политике.
6. Если часть модулей не выполнилась из-за недоступности сайта, внешнего provider или ограничений самого сайта, но хотя бы один модуль дал usable output, результат получает статус `Partial` с причиной и доступным повтором проблемного модуля в рамках той же покупки. Это не маскируется как успешный полный скан. Если после одного разрешённого retry по внешней причине не получен ни один usable module, результат получает `Failed` с причиной `NoUsableOutput` и полный refund; partial refund не поддерживается.
7. Отмена до постановки в очередь возвращает оплату. Остановка пользователем после начала обработки считается использованным прогоном; незапущенные модули не выполняются. Недоступность сайта или provider сама по себе не считается основанием для автоматического возврата, если результат с частичным статусом сформирован.

Refund policy v1 для продукта: entitlement активен 30 дней с момента оплаты; отмена до `Queued` возвращает 100% оплаты; технический отказ FluxRadar даёт один повторный запуск без доплаты и затем полный возврат при повторном отказе; внешний отказ сайта/provider после начала обработки даёт один retry, а при хотя бы одном usable module — `Partial` без автоматического возврата, при нулевом usable output — полный refund; пользовательская остановка после начала обработки приводит к `Cancelled` без автоматического возврата. Обязательные требования закона и индивидуальные решения поддержки имеют приоритет и фиксируются в release record.

Эта policy, срок действия entitlement и текст пользовательского согласия должны быть опубликованы до production-запуска и дословно синхронизированы с поведением Paddle checkout.

Refund/scan state machine v1:

| Состояние | Разрешённый переход | Условие и идемпотентность |
|---|---|---|
| `Pending` | `Queued` или `Cancelled` | ровно один атомарный compare-and-set; `paid` webhook с проверенными signature, amount, currency и price ID допускает `Queued`, пользовательская отмена до queue допускает `Cancelled` |
| `Queued` | `Running` или `Cancelled` | worker claim атомарен и выдаётся только одному worker; остановка после queue не даёт автоматический refund |
| `Running` | `Completed`, `Partial`, `Failed` или `Cancelled` | scan result записывается один раз; остановка пользователя после начала — использованный прогон |
| `Partial` | `Running` для одного бесплатного retry проблемного модуля или terminal `Partial` | retry не создаёт новый платёж и не продлевает entitlement |
| `Failed` | `Queued` для одного platform retry или billing `Refunded` | platform fault: retry без доплаты, затем полный refund при повторном отказе |
| `Cancelled` | terminal | новые jobs не создаются; refund возможен только если причиной была отмена до `Queued` или platform fault по policy |
| `Completed` | billing `Refunded` только по platform/legal/support policy | обычный пользовательский refund после начала не разрешён |

`Refunded` — billing-состояние, а не второй scan terminal state; `Disputed` — billing overlay, который может прийти из любого нетерминального состояния, приостанавливает entitlement и запрещает новые jobs. Out-of-order и повторные Paddle events обрабатываются по event ID и monotonic state rules: старое событие не откатывает состояние, повтор не создаёт второй entitlement, scan, refund или retry. Для refund обязательно сохраняются `paddle_transaction_id`, `paddle_event_id`, verified signature, product/price ID, amount, currency, tax amount, `refund_request_id`, `refund_reason_code`, status `requested/processing/paid/failed`, timestamps и причина.

`usable output` определён объективно: для модуля существует хотя бы одна completed applicable check и сохранён хотя бы один валидный metric, score или finding с evidence; один только error/status record usable output не считается. `NoUsableOutput` устанавливается после всех разрешённых retry, если ни один модуль не имеет usable output, даже когда некоторые проверки завершились, но не создали валидный metric, score или finding с evidence; ноль completed checks — достаточный, но не единственный случай. Для `Partial → Running` разрешённый retry после завершения возвращает `Completed`, если все applicable checks закрыты и есть usable output, `Partial`, если закрыта только часть или usable output есть только у части модулей, или `Failed/NoUsableOutput`, если usable output по-прежнему отсутствует; platform failure вместо этого возвращает `Failed` с последующим platform retry/refund flow. В billing fixture отдельно проверяется completed check без валидного usable output.

Idempotency contract v1: `purchase_id` — внутренний immutable ID, уникальный `paddle_transaction_id` допускает ровно один `purchase_id`, а unique constraint `(purchase_id)` допускает ровно один entitlement и один `scan_id`. Webhook handler в одной database transaction проверяет signature/amount/currency/price ID, вставляет `paddle_event_id` в dedup table с unique constraint, создаёт entitlement/scan и коммитит side effect; повторный event возвращает тот же результат без повторного создания. Worker claim использует atomic compare-and-set по `scan_id`; `platform_retry_count <= 1`, `module_retry_count <= 1`, а retry одного внешнего отказа не создаёт новый purchase. Стабильный logical key — `refund_idempotency_key = refund:{purchase_id}`; `refund_reason_code` — закрытый immutable enum `PRE_QUEUE_CANCEL`, `PLATFORM_FAILURE_AFTER_RETRY`, `EXTERNAL_NO_USABLE_OUTPUT` или `LEGAL_SUPPORT`. Отдельные API attempts получают `refund_attempt_id = {refund_idempotency_key}:{attempt_number}`, но не новый refund key; database unique constraint на `purchase_id` и refund record запрещает второй refund независимо от reason code. Повтор webhook refund возвращает сохранённый статус.

AI ambiguous-timeout contract: каждый provider request получает deterministic `ai_request_key = ai:{scan_id}:{provider}:{prompt_hash}:{sequence}`. Если provider поддерживает idempotency, key передаётся в API и повтор безопасен; если не поддерживает, timeout после отправки считается `Unknown` и автоматический retry запрещён до reconciliation по provider request ID/usage. Reservation сохраняется в durable store с lease 15 минут, watchdog продлевает lease только живому worker, после expiry reconciliation получает provider usage/status; если подтвердить отсутствие запроса нельзя, до закрытия incident сохраняется worst-case charge и новый дорогой запрос не запускается. Это предотвращает двойной provider charge и не позволяет обойти hard cost ceiling через crash/retry.

Полный refund возвращает сумму, фактически списанную с пользователя, включая отображённые налоги; внутренние Paddle fees не удерживаются с пользователя при ошибке FluxRadar. FluxRadar создаёт refund request не позднее 1 рабочего дня, показывает его статус, а финальное зачисление зависит от Paddle и банка. Entitlement истекает через 30 дней: после expiry новые scans/retries не ставятся в очередь, уже `Running` scan может завершиться, автоматический refund из-за expiry не выполняется.

Policy разделяет причины отказа: внутренняя ошибка FluxRadar (queue, worker, billing или runner) даёт один retry и затем полный refund; внешний provider или сайт даёт один retry, затем `Unavailable`/`Partial` без refund при наличии usable output или `Failed/NoUsableOutput` с полным refund при его отсутствии; пользовательская остановка после `Queued` даёт `Cancelled` без refund. Ни одна ветка не должна одновременно считаться platform failure и external failure.

Data lifecycle v1: queued jobs и их payloads отзываются не позднее 1 часа после delete/refund; временные файлы удаляются не позднее 24 часов; object versions, exports и caches удаляются не позднее 7 дней; CDN cache очищается не позднее 1 часа, а защищённые evidence links требуют повторной авторизации. Логи не содержат raw HTML, AI-ответов, cookies или credentials и хранят только IDs/status/timestamps до 12 месяцев. Provider-side deletion подтверждается записью в `AI-001`; provider, который не позволяет выполнить требуемое удаление или retention, отключается до отдельного privacy sign-off.

### Ограничения одного прогона

- количество URL в одном прогоне;
- количество AI-запросов в одном прогоне;
- один домен на один прогон;
- поддомены входят в область домена, если разрешены настройками сканирования.

Basic открывает только SEO и AI SEO / GEO. Complete открывает все модули текущего релиза; отложенные модули не считаются частью Complete до отдельного запуска.

Единая тарифная матрица v1:

| План | Доступные модули | Score weights | Лимит прогона |
|---|---|---|---|
| Free | фиксированная SEO-проверка homepage: title, H1, meta description, индексация | score не рассчитывается | 1 домен, 1 homepage check, 30 дней, повтор запрещён |
| Basic Scan | SEO, AI SEO / GEO | SEO 60%, AI SEO / GEO 40% | 1 домен, 5 000 URL, 50 AI-запросов, 30 дней, текущий результат без history/export |
| Complete Scan | все текущие модули; active Security только после launch gate | SEO 20%, AI 15%, Security 20%, Performance 15%, Accessibility 10%, Reliability 10%, Content 5%, Privacy 5%; UX/Conversion и Analytics отдельно | 1 домен, 50 000 URL, 500 AI-запросов, 12 месяцев, history/comparison/PDF/CSV/online report |

Любой модуль, отсутствующий в строке плана, не запускается, не создаёт findings и не попадает в знаменатель score этого плана. UX/Conversion и Analytics для Complete показываются отдельно и не входят в общий score текущего релиза.

Лимиты одного прогона:

- Basic: 5 000 уникальных нормализованных URL и 50 AI-запросов;
- Complete: 50 000 уникальных нормализованных URL и 500 AI-запросов;
- URL сверх лимита не добавляются в очередь, а пользователь видит достигнутый лимит и список пропущенных URL;
- повтор запроса из-за временной ошибки provider не расходует AI-квоту повторно;
- один оплаченный прогон относится ровно к одному домену; поддомены входят только при явном разрешении в области сканирования;
- скрытых overage-платежей нет.

### Хранение и доступ к результатам

- Free: результат главной страницы хранится 30 дней;
- Basic: текущий результат доступен 30 дней, но не появляется в истории, сравнении или экспорте; полные AI-ответы не сохраняются после срока текущего результата;
- Complete: сканы, score, проблемы, доказательства и AI-ответы хранятся 12 месяцев и доступны для сравнения и экспорта;
- удаление аккаунта: primary data, caches и exports удаляются не позднее 7 дней после подтверждения запроса, backup copies — не позднее 30 дней; в audit log остаётся только минимальный факт операции без содержимого скана;
- refund до начала обработки удаляет entitlement и все созданные метаданные в течение 7 дней; refund после технического отказа удаляет частичные результаты в тот же срок, если они не нужны для открытого dispute;
- удаление аккаунта и возврат не отменяют уже подтверждённый платёжный факт в Paddle и обязательные финансовые записи.

### Цены и экономика

- цены показываются в USD;
- Basic Scan — $55 за один прогон;
- Complete Scan — $120 за один прогон;
- для предварительного расчёта используется модель Paddle 5% + $0.50 за checkout-транзакцию; фактические условия FluxLab подтверждаются до запуска;
- расчёт должен отдельно показывать переменную себестоимость сканирования, комиссию Paddle, распределённые постоянные расходы, поддержку, маркетинг и развитие продукта;
- economics model обязана отдельно учитывать gross/net revenue, tax pass-through по receipt Paddle, refunds, chargebacks, FX buffer, Paddle fee, p95 variable cost, fixed costs и support reserve; налог не считается прибылью FluxLab, а refund/chargeback уменьшает net revenue в месяце события;
- целевая маржа 50% считается после переменных расходов и комиссии Paddle; операционная прибыль считается отдельно после постоянных расходов и support reserve;
- для первого 30-дневного forecast support reserve считается по консервативному правилу `max($500/month, 10% от forecast gross revenue)` и может быть изменён только через `ECON-001`.

При указанных ценах комиссия Paddle составляет ориентировочно $3.25 для Basic и $6.50 для Complete. Чтобы сохранить 50% contribution margin до постоянных расходов, прочие переменные затраты не должны превышать $24.25 на Basic и $53.50 на Complete.

Эти значения являются верхним hard ceiling для всей переменной себестоимости одного прогона, включая AI, browser rendering, crawler, storage и retries; внутренний cost budget может быть ниже. Система не выполняет overage-операции и не перекладывает перерасход на пользователя.

Сценарий из 10 прогонов при миксе 80% Basic / 20% Complete даёт $680 выручки и около $39 комиссии Paddle до инфраструктуры. При постоянных расходах $1 000 такой объём заведомо не покрывает затраты. Это иллюстративный negative scenario для `ECON-001`, а не отдельный числовой launch gate: обязательные условия запуска — operational floor 45 и risk-adjusted forecast из следующего абзаца.

При верхней границе переменной себестоимости вклад после Paddle составляет $27.50 на Basic и $60 на Complete, или в среднем $34 на один прогон при миксе 80%/20%. Обязательный operational stress-case использует fixed costs $1,000, support reserve `max($500/month, 10% gross revenue)`, верхнюю границу variable cost и даёт planning floor 45 прогонов. Этот floor — минимальный тест объёма до risk loads; отдельный 30-дневный forecast обязан добавить ожидаемые refund/chargeback loss и FX buffer. Единственная формула break-even для forecast: `ceil((fixed costs + support reserve + expected refund/chargeback loss + FX buffer) / weighted average contribution margin before risk loads)`, где contribution margin уже учитывает Paddle fee, p95 variable cost и только non-pass-through tax expense. Forecast проходит economics gate только если одновременно покрывает эту risk-adjusted формулу и не ниже operational planning floor 45.

`ECON-001` input contract: `forecast_scans`, `forecast_gross_revenue` и `fixed_costs` — неотрицательные числа; Basic/Complete mix и `refund_rate`/`chargeback_rate` находятся в `0..1`; `expected_refund_loss`, `expected_chargeback_loss` и `FX_buffer` выражаются в USD и неотрицательны; `support_reserve` выражается в USD и обязан удовлетворять invariant `support_reserve >= max($500, 10% × forecast_gross_revenue)` для каждого launch forecast; taxes фиксируются отдельно как pass-through или expense по receipt Paddle; `weighted_average_contribution_margin` считается после Paddle fee и p95 variable cost, но до risk losses, которые добавляются только в numerator break-even, и обязан быть `> 0`. Semantic validator `ECON-001` пересчитывает `forecast_gross_revenue` из цен и mix и отклоняет любой reserve ниже этого floor. При нулевой или отрицательной contribution margin, нарушении support-reserve floor, отсутствии provider invoices или неуказанных risk inputs `ECON-001` автоматически не проходит.

Финансовый sign-off выполняет владелец Finance FluxLab на основании трёх артефактов: 30-дневного прогноза продаж с support reserve не ниже `max($500, 10% × forecast gross revenue)` и сценариями mix 80%/20%, 50%/50% и 0%/100%; отчёта нагрузочного теста с фактической себестоимостью; счетов всех provider. Engineering подтверждает hard cost guard, Product подтверждает соответствие обещаний тарифам. Все подтверждения, проверка support-reserve floor и расчёт break-even хранятся в release record `ECON-001`; без них economics gate не пройден.

До public launch FluxLab обязан подтвердить нагрузочным тестом и реальными счетами provider, что:

- фактическая себестоимость каждого типа скана укладывается в установленные переменные лимиты;
- hard cost guard останавливает дорогие операции до перерасхода;
- план продаж покрывает постоянные расходы и резерв поддержки не менее чем на 30-дневном прогнозном периоде;
- при невыполнении условий уменьшаются квоты или дорогие модули, а не допускается неконтролируемый расход при сохранении тех же обещаний.


---

## 19. Интеграции

### Интеграции текущего релиза

- Google Search Console;
- Google Analytics;
- email;
- Paddle webhooks для подтверждения оплаты;
- CSV/PDF export в Complete.

Search Console и Google Analytics подключаются добровольно. Без них доступны технические проверки, а зависимые блоки получают `Unavailable` без штрафа в score. Email используется для транзакционных сообщений и поддержки, но не для уведомлений о мониторинге.

### Будущие интеграции

- Slack и исходящие webhooks для уведомлений;
- GitHub;
- GitLab;
- Jira;
- Linear;
- WordPress и другие CMS;
- Microsoft Teams;
- CRM;
- CDN и cloud providers;
- Google Business Profile и локальные каталоги.

Будущие интеграции не являются обязательными зависимостями текущего релиза и не должны упоминаться как доступные возможности Complete.

---

## 20. Административная часть FluxLab

Администратор платформы должен иметь возможность:

- управлять пользователями и организациями;
- видеть оплаченные прогоны и платежи;
- видеть состояние сканирований;
- повторно запускать зависшие задачи;
- просматривать ошибки системы;
- управлять лимитами;
- блокировать злоупотребления;
- просматривать audit log;
- управлять feature flags;
- создавать внутренние заметки поддержки;
- видеть метрики использования продукта.

Пользовательская поддержка: Help Center с инструкциями и FAQ плюс email-поддержка. Live chat не входит в текущий scope.

Юридические страницы продукта: Terms of Service, Privacy Policy и Cookie Policy на русском и английском языках. Перед запуском документы должны быть подготовлены и проверены юристом FluxLab.

---

## 21. Безопасность самой FluxRadar

- tenant isolation;
- шифрование данных;
- безопасное хранение токенов и credentials;
- RBAC для административной части FluxLab; клиентские роли появятся только вместе с командным режимом;
- 2FA для администраторов FluxLab;
- rate limiting;
- защита от SSRF при сканировании;
- sandbox для браузерного рендеринга;
- безопасное выполнение security-проверок;
- резервное копирование;
- политика хранения данных;
- удаление данных по запросу;
- журнал административных действий и запусков активных Security-проверок;
- защита от злоупотребления сканером;
- явное подтверждение разрешения на каждый активный скан.

---

## 22. Нефункциональные требования

- устойчивость к частичным ошибкам отдельных проверок;
- повтор задач после временного сбоя;
- понятный прогресс сканирования;
- работа с большими сайтами;
- горизонтальное масштабирование краулера;
- ограничение нагрузки на сайт клиента;
- стабильность повторных результатов;
- детерминированность правил;
- версия правил аудита;
- трассировка каждой найденной проблемы до источника;
- мониторинг самой платформы;
- понятные сообщения об ошибках;
- целевая доступность публичного сервиса — не ниже 99.5% в месяц, за исключением заранее объявленного обслуживания;
- API dashboard: P95 не более 500 мс для обычных запросов;
- обновление прогресса скана: не реже одного раза в 15 секунд;
- временный сбой внешнего AI provider получает не более одного бесплатного retry с backoff, после чего модуль становится `Partial` или `Unavailable`; отдельная transport retry policy для проверяемых пользовательских URL/API описана в Reliability contract и не меняет AI retry limit;
- каждый скан имеет hard cost guard и не может выполнить операции сверх оплаченной URL/AI-квоты;
- внутренняя status page для команды FluxLab.

---

## 23. Важные границы продукта

FluxRadar:

- не гарантирует рост позиций в поиске;
- не гарантирует попадание бренда в ответы AI-систем;
- не выдаёт юридическое подтверждение compliance;
- не выполняет несанкционированное активное тестирование;
- не изменяет сайт автоматически без явного разрешения;
- не выполняет постоянный мониторинг, регулярные сканы или уведомления в текущем релизе;
- не обещает полноту внешнего веба, соцсетей или данных CDN для отложенных модулей;
- отделяет найденный факт от рекомендации и предположения;
- показывает дату, источник, версию правила и полноту данных каждого результата.

---

## 24. Журнал текущих решений

Этот раздел содержит только итоговые решения. Старые варианты, подписочная модель и отменённые формулировки удалены, чтобы не создавать второй источник требований.

- первичный launch-сегмент должен быть выбран до public launch из трёх вариантов: владельцы/маркетинговые команды небольших и средних сайтов, независимые SEO/digital-специалисты или агентства; поддержка всех сегментов одновременно без выбранного приоритета запрещена;
- текущий режим сканирования: только публичные сайты;
- Complete включает все модули текущего релиза, а не будущие возможности;
- Basic включает только SEO и AI SEO / GEO;
- активный Security — Complete-only и запускается только после security launch gate;
- AI/GEO в текущем релизе использует официальные API без browser automation;
- автоматические изменения сайта, code snippets, pull requests и white-label не входят;
- основной язык интерфейса и материалов — русский и английский;
- текущая модель — pay-per-scan через Paddle: Basic $55, Complete $120;
- один оплаченный прогон — один домен, без подписки, расписания и месячной квоты запусков;
- команды, workspace, роли, мониторинг, уведомления, RUM, backlinks/reputation, GBP, checkout-flow и visual regression — будущие возможности.

Все требования к реализации должны ссылаться на разделы 0–23 и не могут переопределять их через исторические варианты.

---

## 25. Критерии приёмки

### Scan lifecycle

- для каждого прогона сохраняются тариф, домен, область, выбранные модули, лимиты и версия правил;
- скан проходит состояния `Pending → Queued → Running → Partial/Completed/Failed/Cancelled`;
- пользователь видит прогресс, обработанные URL, пропущенные URL, ошибки и причину частичного результата;
- повтор временной ошибки внешнего AI provider выполняется максимум один раз с backoff; после этого модуль получает `Partial` или `Unavailable`. Retry транспортного запроса URL/API следует отдельному Reliability contract;
- повторный запуск проблемного модуля не создаёт новую оплату, если исходная ошибка была на стороне FluxRadar или provider.

### Scope и crawl safety

- в один прогон попадает только один основной домен и явно разрешённые поддомены;
- URL нормализуются и считаются уникальными до постановки в очередь;
- лимит URL и AI-запросов не превышается, overage-платежей нет;
- robots.txt соблюдается по умолчанию, override требует отдельного подтверждения;
- SSRF-защита, private IP blocklist, DNS-rebinding защита, sandbox браузера и ограничение нагрузки проверены на тестовых доменах.

### Issue Center и доказательства

- каждая проблема имеет стабильный rule ID, категорию, severity, confidence, источник, версию правила и scan ID;
- каждая проблема содержит проверяемое доказательство: URL и HTTP-ответ либо DOM-фрагмент, скриншот или trace;
- одинаковая проблема не дублируется в рамках одного module/rule namespace одного скана; одинаковое evidence в разных модулях может иметь отдельные findings, связанные через `evidence_group_id`;
- fingerprint повторяем для одинакового домена, rule ID и нормализованной цели, имеет префикс `fluxradar-fp-v1` и использует NUL-разделители;
- пользователь может отметить False Positive или Ignored;
- Complete связывает наблюдение с предыдущим результатом и корректно показывает Resolved/Reopened;
- Basic не показывает историю и экспорт, Complete показывает историю и экспорт согласно тарифу.

### Score

- score рассчитывается только по формуле из раздела 15;
- findings сначала дедуплицируются по fingerprint, затем для каждого rule ID берётся максимальная severity, penalty считается по affected/applicable targets и результат округляется до 2 знаков;
- недоступные и непроверенные данные отображаются как `Unavailable`/`Partial` и не превращаются в нулевой балл;
- для `Partial` применяется coverage к весу модуля, а доступные веса нормализуются к 100%;
- при weighted coverage 50–79.99% общий результат помечается `Provisional`, при coverage ниже 50% показывается `Insufficient data`;
- `Failed`/`Cancelled` без завершённых применимых проверок не получают score, нулевое число применимых проверок получает `Not applicable`, а все недоступные модули дают `Insufficient data`;
- отчёт показывает вклад каждой проблемы в оценку и версию методики.

Golden Score vector: при 100 applicable URL отдельный High rule на 20 URL и отдельный Medium rule на 50 URL дают `100 − 10×0.20 − 3×0.50 = 96.50`; повтор того же fingerprint не меняет значение. Golden fixtures также проверяют site-level Critical, Partial coverage, all `Unavailable`, all `Not applicable`, `Failed` и `Cancelled`.

### AI/GEO

- каждый AI-запрос сохраняет provider/API version, model ID, prompt version, регион, язык, дату, request ID, usage и полный ответ;
- используется только утверждённая версия библиотеки FluxRadar и официальные API текущего релиза;
- registry v1 использует зафиксированные model IDs, request/response contract, provider tokenizer usage и caps 8 000 input/2 000 output tokens;
- превышение input/output cap обрабатывается детерминированной truncation policy с `[TRUNCATED]` или `finish_reason=length`;
- недоступный provider не блокирует остальные модули и не уменьшает score как найденная проблема;
- Basic показывает ответы только в текущем результате, Complete сохраняет их 12 месяцев;
- UI явно называет результат снимком AI-ответов и не обещает позицию или гарантированное упоминание;
- `AI-001` содержит подтверждение ToS, data-control, региона, retention/deletion и отсутствия передачи credentials/cookies для каждого включённого provider.

### Покрытие модулей

Для каждого включённого правила должен существовать fixture с ожидаемым результатом, стабильный rule ID и проверяемое доказательство. Минимальный набор acceptance tests текущего релиза:

- SEO: status codes, robots/sitemap, canonical, metadata, headings, hreflang, structured data, internal links и duplicate URL;
- AI/GEO: три provider adapters, prompt version, model/request ID, caps `8 000 input / 2 000 output / 4 000 reasoning / 8 search / 32 citation units` per request, worst-case reservation, retry without double quota, reservation release, unavailable provider, вариативность ответа и шесть методических контрактов `GEO-METHOD-001..006`;
- Security: пассивные headers/TLS/cookies и активный safe-profile на собственном test domain с allowlist, private-IP/DNS-rebinding блокировкой, 1 req/s на host, 2 concurrent requests, 10s timeout, 500 target URL, baseline из первых 20 успешных запросов, непересекающимися окнами по 100 запросов, заданными stop thresholds и kill switch не позднее 5 секунд;
- Performance: pinned runner image digest and `PERF-001`, desktop/mobile profiles, 3 runs per URL per profile/cache combination (12 when both profiles and cache modes are enabled), median aggregation, MAD/unstable verdict, cache mode, Core Web Vitals good/warning/finding mapping (`warning` без penalty, >warning `Medium`, `PERF-RULE-015` regression `High` keyed to the same metric/source rule — `PERF-RULE-002` for TTFB and `PERF-RULE-003` for LCP/INP/CLS — and scored only when that current metric is not already a finding, `PERF-RULE-014` informational), evidence на URL и comparison двух Complete-сканов с baseline-zero и regression thresholds из раздела 7;
- Accessibility: fixture для каждого применимого типа проблемы, DOM evidence и severity без обещания юридического соответствия;
- Content Quality: все 10 правил из `CONTENT-001..010` — duplicate, outdated, empty/low-value, broken media, readability, keyphrase repetition, contradiction, author/date, broken source links и structure/update recommendation — с объяснением применённого правила;
- Privacy: cookies, trackers, third-party scripts, forms и privacy pages с пометкой «не юридическое заключение»;
- Reliability: одноразовая availability-проверка выбранных публичных URL и явно добавленных API endpoints, method allowlist `GET/HEAD/OPTIONS`, no-credentials headers, отсутствие state-changing API, expected-status precedence включая boundary для ожидаемых 3xx/404/5xx, max 5 redirects within allowlist, 10s timeout, retry policy, response time и ошибки DNS/SSL/redirect;
- UX/Conversion: статические публичные страницы, CTA, формы и потенциальные dead ends; интерактивные flows не тестируются;
- Analytics: подключённые Search Console/GA, корректные OAuth scopes, fixture-данные, отсутствие интеграции и отсутствие штрафа в score;
- Reports/integrations: PDF/CSV и online report в Complete содержат тот же набор issues и score, что dashboard; каждая `summary`, `module`, `ai_response` и `issue` record валидируется JSON Schema v1 и semantic invariants, соблюдает enum/nullability/UTC `Z` timestamps и порядок строк; скан без issues создаёт summary-row; `evidence_excerpt` ограничен 2 048 Unicode characters, PDF показывает одно ключевое доказательство, online report сохраняет ссылки на полные evidence и deletion evidence; Basic не получает экспорт; большие evidence не теряются и после удаления дают `410 Gone`.

### Acceptance matrix v1

Инвентарь ниже является закрытым для текущего релиза: каждый перечисленный rule ID обязан иметь ровно один positive fixture, один negative fixture, ожидаемую severity, ожидаемый evidence и владельца. Любой bullet из разделов 4–13, не сопоставленный с этим inventory, блокирует Quality gate.

Нумерация внутри каждого диапазона идёт в порядке bullet-ов соответствующего подраздела разделов 4–13; состав диапазонов закрыт и не может молча расширяться. При добавлении или удалении проверки создаётся новая версия ruleset и обновляется acceptance matrix.

| Область | Закрытый inventory rule ID | Fixtures | Ожидаемый результат и владелец | Артефакт |
|---|---|---|---|---|
| SEO | `SEO-TECH-001..014`, `SEO-ONPAGE-001..009`, `SEO-CONTENT-001..009`, `SEO-ADV-001..005` | `fx-seo-v1-*` | pass — finding отсутствует; fail — точная проблема, severity и URL evidence; owner SEO | `RULES-SEO-v1`, `FIXTURES-SEO-v1` |
| AI/GEO | `GEO-READY-001..008`, `GEO-VIS-001..008`, `GEO-REC-001..005`, `GEO-PROVIDER-001..003`, `GEO-METHOD-001..006` | `fx-geo-v1-*`, `fx-geo-method-v1-*`, mock provider responses | pass/fail по expected brand/citation/context, OpenAI/Google/Perplexity adapter compatibility, provider status, `ai_response` record с provider/API/model/prompt/request/usage/raw_text/citations и deletion evidence только после нормализованного provider response; pre-response consent/redaction/data-control отказ представлен module `Unavailable` record без `ai_response` и без deletion evidence, pinned tokenizer/caps, deterministic truncation, redaction и deletion evidence для реальных provider responses; owner GEO | `AI-001`, `FIXTURES-GEO-v1`, `FIXTURES-GEO-METHOD-v1` |
| Security | `SEC-PASSIVE-001..014`, `SEC-ACTIVE-001..007` | `fx-security-owned-v1-*` | passive findings и active guardrail events с точной severity/evidence; owner Security | `SEC-001`, `FIXTURES-SECURITY-v1` |
| Performance | `PERF-RULE-001..015`, `PERF-ENV-001..006` | `fx-perf-v1-*` | Core Web Vitals thresholds, median, cache mode и regression verdict по разделу 7; owner Performance | `PERF-001`, `FIXTURES-PERF-v1` |
| Accessibility | `A11Y-001..011` | `fx-a11y-v1-*` | ожидаемый DOM evidence, severity, report-link и отсутствие юридического claim; owner Accessibility | `RULES-A11Y-v1`, `FIXTURES-A11Y-v1` |
| Reliability | `REL-URL-001..010`, `REL-API-001..005` | `fx-reliability-v1-*` | pass/warning/fail по status, timeout, retry, DNS/SSL и response time; expected 3xx/404/5xx boundary cases have pass precedence; owner Reliability | `RULES-REL-v1`, `FIXTURES-REL-v1` |
| Content Quality | `CONTENT-001..010` | `fx-content-v1-*` | ожидаемая duplicate, outdated, empty/low-value, broken-media, readability, keyword repetition, contradiction, author/date, source-link и structure finding; owner Content | `RULES-CONTENT-v1`, `FIXTURES-CONTENT-v1` |
| Privacy | `PRIVACY-001..009` | `fx-privacy-v1-*` | tracker/cookie/form evidence и обязательная non-legal disclaimer; owner Privacy | `RULES-PRIVACY-v1`, `FIXTURES-PRIVACY-v1` |
| UX/Conversion | `UX-STATIC-001..007` | `fx-ux-v1-*` | статическая CTA/form/dead-end finding; interactive flows не вызываются; owner UX/Conversion | `RULES-UX-v1`, `FIXTURES-UX-v1` |
| Analytics | `ANALYTICS-001..009` | `fx-analytics-v1-*`, fixture OAuth responses | корректные scopes, данные или `Unavailable` без штрафа; owner Analytics | `RULES-ANALYTICS-v1`, `FIXTURES-ANALYTICS-v1` |
| Billing/export/data | `BILLING-001..008`, `EXPORT-001..006`, `DATA-001..006`, `ECON-001` | `fx-platform-v1-*` | idempotent webhook с `paddle_event_id`, unique purchase→entitlement→scan, atomic worker claim, retry counters, unique refund idempotency key, lifecycle refund включая `NoUsableOutput` при отсутствии валидного usable output даже после завершившейся check, schema v1, deletion deadlines, protected evidence links и support reserve `>= max($500, 10% forecast gross revenue)`; owner Platform/Finance | `PLATFORM-001`, `FIXTURES-PLATFORM-v1` |

### Explicit ruleset mapping v1

Эта таблица является частью спецификации, а не только ссылкой на внешний artifact: каждый `rule_id` явно сопоставлен с одной проверкой и порядком bullet-а. Для каждой записи обязательны `positive`, `negative` и boundary fixture с именем `fx-<rule_id>-positive|negative|boundary`; `target_kind` по умолчанию `page`, если явно указано `site`, `api` или `environment`. Applicable criteria — публичная цель в scope, к которой применим смысл проверки; если criteria не выполнен, результат `not_applicable`, а не finding. Severity resolver, evidence type и score formula для каждого rule ID фиксируются в той же строке `RULES-<module>-v1` и проходят semantic validator.

| Rule group | Explicit rule mapping (ID → check) | Target / owner |
|---|---|---|
| SEO technical | `SEO-TECH-001` robots.txt; `002` sitemap.xml; `003` HTTP status; `004` canonical URL; `005` redirect chains/cycles; `006` 4xx/5xx; `007` duplicate URL; `008` index/noindex; `009` pagination; `010` orphan pages; `011` crawl depth; `012` hreflang; `013` HTTPS/mixed content; `014` URL validity | page/site as applicable / SEO |
| SEO on-page | `SEO-ONPAGE-001` title; `002` meta description; `003` H1–H6; `004` metadata length/uniqueness; `005` image alt; `006` Open Graph/social metadata; `007` structured data; `008` internal linking; `009` heading/content relevance | page / SEO |
| SEO content | `SEO-CONTENT-001` duplicate content; `002` thin content; `003` empty/low-value pages; `004` outdated pages; `005` readability; `006` topic gaps; `007` keyword repetition/naturalness; `008` self-competing content; `009` new-page/internal-link recommendations | page/site as applicable / SEO |
| SEO advanced | `SEO-ADV-001` site-data local SEO; `002` public e-commerce product pages; `003` Product/Review Schema; `004` image/video SEO; `005` Search Console queries | page/site/integration as applicable / SEO |
| AI/GEO readiness | `GEO-READY-001` AI crawler access; `002` JS-only content; `003` structured data; `004` organization/product/expert descriptions; `005` author/date signals; `006` facts/definitions/answers clarity; `007` sources/links; `008` brand information consistency | page/site / GEO |
| AI/GEO visibility | `GEO-VIS-001` question library; `002` selected-topic responses; `003` brand presence; `004` site link; `005` cited pages; `006` competitor mentions; `007` mention position/context; `008` comparison with previous Complete scan | AI response/site / GEO |
| AI/GEO recommendations | `GEO-REC-001` content questions; `002` explicit facts; `003` source pages; `004` Schema.org entities; `005` AI-source candidates | page/site / GEO |
| AI provider adapters | `GEO-PROVIDER-001` OpenAI Responses adapter; `002` Google generateContent adapter; `003` Perplexity Sonar adapter | AI response / GEO |
| AI/GEO methodology | `GEO-METHOD-001` versioned question library by industry/region/language; `002` provider/model/prompt/region/language/date/source/full-response metadata; `003` brand/domain/citation/competitor/context signals; `004` snapshot-only result disclaimer; `005` unavailable-provider/query semantics without score penalty; `006` repeatability parameters and response variance display | AI response/site / GEO |
| Security passive | `SEC-PASSIVE-001` SSL/TLS; `002` security headers; `003` HSTS; `004` CSP; `005` cookie attributes; `006` CORS; `007` DNS records; `008` exposed files; `009` directory listing; `010` debug/endpoints; `011` client-code secrets; `012` outdated frontend dependencies; `013` unsafe third-party scripts; `014` common web-risk checks | page/site / Security |
| Security active | `SEC-ACTIVE-001` domain proof; `002` host/URL allowlist; `003` per-scan consent; `004` safe non-destructive profile; `005` rate/concurrency/timeout limits; `006` stop thresholds; `007` kill switch and audit event | site/environment / Security |
| Performance rules | `PERF-RULE-001` Core Web Vitals availability/aggregate summary (informational, no penalty); `002` TTFB; `003` individual LCP/INP/CLS findings; `004` HTML size; `005` CSS size; `006` JavaScript size; `007` images/formats; `008` render-blocking resources; `009` third-party scripts; `010` caching; `011` CDN; `012` desktop/mobile; `013` performance budget; `014` current/previous comparison (informational, no penalty); `015` regression keyed to the same `metric_key` and source rule (`002` for TTFB, `003` for LCP/INP/CLS, corresponding `004..013` otherwise), with no penalty when that source rule already has a finding | page / Performance |
| Performance environment | `PERF-ENV-001` pinned runner identity; `002` cold-cache protocol; `003` warm-cache protocol; `004` settle/network-idle protocol; `005` median/MAD instability; `006` unavailable/baseline edge cases | environment/page / Performance |
| Accessibility | `A11Y-001` contrast; `002` alt text; `003` heading/document structure; `004` form labels; `005` keyboard navigation; `006` focus states; `007` ARIA; `008` interactive elements; `009` form errors; `010` screen-reader evidence; `011` severity/evidence report | page/report / Accessibility |
| Reliability URL | `REL-URL-001` URL availability; `002` selected public URL; `003` 4xx/5xx verdict; `004` DNS; `005` SSL; `006` redirect chain; `007` broken links; `008` broken images; `009` response time; `010` timestamp/status evidence | page / Reliability |
| Reliability API | `REL-API-001` explicit endpoint selection; `002` method allowlist; `003` expected status with pass precedence for expected 3xx/404/5xx; `004` timeout/retry; `005` no-credentials/no-body/no-state-changing policy | api / Reliability |
| Content Quality | `CONTENT-001` duplicate pages; `002` outdated content; `003` empty/low-value content; `004` broken images/media; `005` readability/complexity; `006` unnatural keyphrase repetition; `007` cross-page contradictions; `008` missing author/date; `009` broken source links; `010` structure/update recommendations | page/site / Content |
| Privacy | `PRIVACY-001` cookies; `002` trackers; `003` third-party scripts; `004` consent banner; `005` personal-data forms; `006` privacy/legal pages; `007` declared-vs-observed trackers; `008` potential personal-data leaks; `009` technical export for legal review | page/site / Privacy |
| UX/Conversion | `UX-STATIC-001` mobile usability; `002` CTA clarity; `003` form errors; `004` required/optional fields; `005` static dead ends; `006` visual issues; `007` conversion recommendations | page / UX/Conversion |
| Analytics | `ANALYTICS-001` Search Console connection; `002` Analytics connection; `003` organic traffic drop; `004` zero-traffic pages; `005` queries without page; `006` broken events; `007` data layer; `008` conversion anomalies; `009` technical-to-business linkage | integration/page / Analytics |
| Platform billing | `BILLING-001` Paddle signature/amount/currency/price validation; `002` webhook deduplication; `003` purchase→entitlement→scan uniqueness; `004` atomic worker claim and retry counters; `005` cancel/refund state machine; `006` `NoUsableOutput` and platform retry, including completed-check-without-usable-output and maximum-one-AI-provider-retry fixtures; `007` expiry/chargeback handling; `008` refund status and one-refund invariant | payment/scan state / Platform |
| Platform export | `EXPORT-001` JSON Schema and semantic validator; `002` canonical record equality across views; `003` CSV encoding/order/quoting/nulls; `004` PDF structure and evidence; `005` AI response records; `006` Complete-only access and zero-issue export | report record / Platform |
| Platform data | `DATA-001` retention by plan; `002` account deletion; `003` refund deletion; `004` queue payload revocation; `005` temp/object/cache/CDN deletion; `006` backup/log/provider deletion evidence | data lifecycle / Platform |
| Platform economics | `ECON-001` provider-invoice cost ceilings; p95 variable cost; taxes/refunds/chargebacks/FX inputs; contribution margin; support-reserve floor `>= max($500, 10% × forecast gross revenue)`; operational floor 45; risk-adjusted break-even and Finance sign-off | forecast/release record / Finance |

Fixture contract: `expected_status` принимает только `pass`, `warning`, `finding`, `fail`, `partial`, `unavailable`, `not_applicable`, `regression` или `unstable`; статус выбирается по контракту конкретного модуля и не подменяется нулевым score. `expected_fingerprint`, `expected_severity`, `expected_evidence_type` и `expected_score_delta` обязательны для `finding`, `fail` и `regression`; для performance `finding`/`regression` также фиксируется expected `metric_key`, а для `pass`, `warning`, `unavailable`, `not_applicable` и `unstable` фиксируются обязательные причина, evidence и ожидаемое отсутствие score penalty. Каждый fixture хранит input, expected JSON, owner, commit SHA и ссылку на CI-артефакт. Для каждого rule ID в `RULES-<module>-v1` есть одна строка mapping с applicable criteria, target kind, severity, evidence type, status precedence, score formula и именем positive/negative fixture; explicit ruleset mapping выше является минимальным standalone inventory, а внешний artifact хранит только исполнимые fixture данные и историю версий. Изменение rule ID, severity или expected output требует новой версии ruleset и release record. Boundary suite обязан отдельно прогонять golden Score vectors, fingerprint vectors, JSON Schema validation, semantic cross-field invariants, zero-issue export, AI response export, максимум один AI-provider retry, completed-check-without-usable-output refund, большие evidence, concurrent refund/queue, provider failure, deletion из queue/temp/object/CDN и provider deletion evidence. Fingerprint CI обязан сериализовать байты по алгоритму v1 и сравнивать все перечисленные SHA-256 vectors; несовпадение блокирует Quality gate.

### Billing и данные

- скан не стартует без подтверждённого Paddle webhook `paid`;
- повторная доставка webhook идемпотентна и не создаёт второй entitlement или второй скан;
- при техническом отказе FluxRadar действует бесплатный retry/refund flow из раздела 18;
- Free хранится 30 дней, Basic — 30 дней без истории, Complete — 12 месяцев;
- отмена до `Queued` удаляет entitlement и метаданные, технический отказ после retry даёт полный возврат;
- concurrent cancel/queue test produces exactly one terminal state and one refund request; partial refund and duplicate refund are impossible;
- refund request создаётся не позднее 1 рабочего дня, UI показывает `requested/processing/paid/failed`, gross amount и tax treatment соответствуют Paddle receipt; `disputed` webhook приостанавливает entitlement и не запускает новые задачи;
- удаление primary data/caches/exports завершается не позднее 7 дней, backup copies — не позднее 30 дней, а audit log не содержит payload;
- deletion test verifies queue payloads, temporary files, object versions, CDN cache, exports, provider deletion evidence and post-retention `410 Gone` for evidence links;
- удаление данных, выгрузка и обработка credentials соответствуют Privacy Policy.

## 26. Launch gates

Публичный запуск блокируется до выполнения всех условий:

1. Security gate: подтверждение домена, scope allowlist, per-scan consent, безопасный профиль тестов, не более 1 req/s и 2 concurrent requests на host, timeout 10 секунд, лимит 500 target URL, stop thresholds, kill switch не позднее 5 секунд, audit log, abuse-response процесс и юридически проверенные правила активного скана. Sign-off: Security owner FluxLab.
2. Feasibility gate: тестовые реализации и измеренная себестоимость для всех модулей текущего релиза. RUM, внешний backlinks/reputation, GBP, интерактивные checkout-flow, visual regression и browser automation не включаются в релиз без отдельного sign-off.
3. Economics gate: реальными счетами provider подтверждены переменные лимиты $24.25 для Basic и $53.50 для Complete до постоянных расходов; hard cost guard проверен нагрузочным тестом; economics model учитывает taxes, refunds, chargebacks, FX buffer и p95 variable cost; в 30-дневном прогнозе `support_reserve >= max($500/month, 10% × forecast gross revenue)` и это же invariant пройден валидатором `ECON-001`; обязательный operational stress-case с fixed costs $1,000, mix 80%/20% и верхней границей затрат покрывает planning floor 45 прогонов, а risk-adjusted forecast покрывает единственную формулу break-even из раздела 18. Approved sales plan не заменяет этот gate: при провале меняются цена, квоты, scope или фиксированные расходы до запуска; sign-off: Finance owner, Engineering owner и Product owner в release record `ECON-001`.
4. Quality gate: пройдены acceptance criteria каждого модуля, повторяемые интеграционные тесты, security-тесты на собственных доменах, нагрузочные тесты 5 000/50 000 URL и 50/500 AI-запросов, а также тесты частичных отказов. Результаты тестов и ссылки на артефакты прикреплены к release record.
5. Product gate: опубликованы pricing, refund policy с правилами из раздела 18, 30-дневный срок действия покупки, data retention, Terms, Privacy и Cookie Policy; Help Center описывает лимиты, источники данных и ограничения Complete.
6. Go-to-market gate: выбран один приоритетный launch-сегмент, а landing page и onboarding не обещают рабочие процессы, которых нет в текущем релизе.
7. Operations gate: настроены внутренняя status page, метрики, алерты, резервное копирование, поддержка и процедура ручного восстановления зависшего скана.

## 27. Следующий этап

После прохождения launch gates документ преобразуется в реализационные артефакты:

- product requirements и карту экранов;
- доменную модель и API-контракты;
- архитектуру сканирования и очередей;
- модель тарифов и Paddle webhooks;
- backlog по модулям и acceptance tests;
- тест-план, runbook поддержки и план запуска.
