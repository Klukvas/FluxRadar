# DECISIONS — журнал решений реализации FluxRadar v0.1

Формат: `D-NNN — решение — причина`. Решения принимаются автономно; трактовки противоречий
плана выбирают одну из формулировок самого плана и не меняют его дух.

## Процесс

- **D-001** — Репозиторий инициализирован git-ом, исходный план закоммичен первым коммитом
  (`eb40d97`). Причина: защита исходного плана от перезаписи, отслеживаемость всех изменений,
  финальная проверка «нет случайных незакоммиченных изменений» требует git. Пуш не выполняется.
- **D-002** — Все статусные документы процесса (`PLAN_REVIEW.md`, `DECISIONS.md`,
  `IMPLEMENTATION_PLAN.md`, `DESIGN_SYSTEM.md`, `TASK_BOARD.md`, `REVIEW_*.md`, `TEST_*.md`,
  `BLOCKERS.md`, `FINAL_REPORT.md`) размещаются в `docs/`, а не в корне. Причина: PreToolUse-хук
  окружения (`everything-claude-code` doc-file blocker) блокирует создание `.md` в корне,
  разрешая `docs/`; настройка окружения пользователя уважается.
- **D-003** — Валидация плана выполнена 4 параллельными агентами (архитектор, разработчик, QA,
  security) с вычислительной верификацией golden-векторов. Итоги — в `docs/PLAN_REVIEW.md`.
- **D-004** — Исходный план **не редактируется**. `IMPLEMENTATION_PLAN.md` — отдельный
  реализационный план v0.1, ссылающийся на разделы исходного плана. Причина: план сам требует
  (§27) преобразования в реализационные артефакты; сам документ — спецификация полного релиза.

## Scope v0.1

- **D-005** — Очередь задач: DB-backed (таблица jobs + атомарный conditional-update claim по
  `scan_id`), worker — фоновый цикл внутри процесса API. Причина: план не выбирает брокер (§22);
  для локального MVP внешний Redis/BullMQ — лишняя инфраструктура; интерфейс позволяет замену.
- **D-006** — Модули **вне v0.1** (в реальном скане получают `Unavailable`/`Not applicable` с
  `status_reason` — легальная ветка по §13/§15 плана): Performance (нет pinned runner/`PERF-001`),
  Analytics (нет GSC/GA OAuth), UX/Conversion (правила без оракула), активный Security (за launch
  gate по самому плану), SEO-advanced/SEO-content-эвристики без оракула. Score-математика
  честно нормализует веса доступных модулей — ровно как описано в §15.
- **D-007** — Реализуемый субсет правил `rules-mvp-0.1` — 37 правил с детерминированным
  оракулом (список в `IMPLEMENTATION_PLAN.md`): SEO-TECH×9, SEO-ONPAGE×4, GEO×5 (на mock),
  SEC-PASSIVE×3, REL×5, A11Y×2, CONTENT×2, PRIVACY×2, BILLING×6(инварианты), EXPORT×3, ECON×1.
  Причина: рекомендация QA-агента; полный inventory из 191 правила — условие public launch,
  не MVP. Расширение аддитивно через новую версию ruleset.
- **D-008** — Внешние сервисы за версионированными интерфейсами адаптеров, в v0.1 — mock:
  `MockPaddle` (HMAC-подписанные webhook-события), `MockAiProvider` (нормализованные ответы по
  контракту §5; реальные OpenAI/Google/Perplexity не подключаются — нет credentials и
  `AI-001` sign-off), performance-runner и GSC/GA не реализуются. Причина: рекомендации
  архитектора и security; контракты тестируются полностью, деньги не тратятся.
- **D-009** — PDF-экспорт вне v0.1; экспорт = канонические JSON records + CSV по контракту §16.
  Причина: PDF — представление той же канонической модели, добавляется аддитивно.
- **D-010** — Админ-панель FluxLab (§20) вне v0.1. Причина: не влияет на основной пользовательский
  контур; требует RBAC/2FA-подсистему.

## Стек

- **D-011** — Стек: pnpm workspaces монорепо, TypeScript strict, backend Express + Prisma,
  БД SQLite (dev/тесты), frontend React + Vite, тесты Vitest + supertest. Причина: соответствие
  привычному стеку пользователя (full-stack TS + Prisma); SQLite — нулевая настройка локального
  запуска; атомарный claim реализуется conditional-update (`updateMany where status=...`),
  что корректно и в SQLite; путь миграции на Postgres задокументирован. Auth: email/пароль,
  bcrypt, httpOnly session cookie, account-scoping каждого запроса (tenant isolation).
- **D-012** — Frontend без Tailwind: собственная дизайн-система на CSS custom properties
  (см. `DESIGN_SYSTEM.md`). Причина: стиль Mac OS 8/9 (рельефные рамки, пиксельные детали)
  требует полностью кастомных компонентов; utility-фреймворк не даёт выигрыша.
- **D-013** — E2E через Playwright вне v0.1; верификация: unit + integration (scan pipeline на
  локальном fixture-сайте, webhook-идемпотентность через supertest) + ручной прогон UI.
  Причина: загрузка браузеров и хрупкость e2e не окупаются для локального MVP; happy path
  покрыт integration-тестами API.

## Трактовки противоречий плана (из PLAN_REVIEW)

- **D-014** — «null vs absent» в JSON records: все поля record всегда присутствуют явно
  (со значением `null`, где применимо), absent запрещён. Причина: разрешает конфликт
  `required` + `const: null` в JSON Schema плана; CSV сериализует null пустым полем — как в §16.
- **D-015** — `ai_request_key` — идемпотентный ключ провайдера (`ai:{scan_id}:{provider}:{prompt_hash}:{sequence}`), НЕ входит в fingerprint; `ai_response` records не имеют fingerprint.
- **D-016** — `rule_penalty`/`score_delta` в issue record дублируют **агрегатный** penalty
  правила (один и тот же для всех records одного rule_id); суммирование по records запрещено,
  UI показывает вклад на уровне правила. Причина: иначе сумма по records завышает вычет.
- **D-017** — Basic Provisional: применяется формула weighted coverage (`0.60/0.40`), как в
  подробном абзаце §15; per-module «Provisional» — только информационная метка модуля.
- **D-018** — URL-нормализация: сортировка query-пар по UTF-8 байтам `(name, value)` **после**
  нормализации компонент; NFC применяется ко всем компонентам (не только path). Причина:
  детерминизм fingerprint между реализациями.
- **D-019** — Для site-level issue (`target_kind=site|environment`): `normalized_url` — пустая
  строка; origin хранится в поле `domain`. Соответствует сериализации пустого поля `0:` из §14.
- **D-020** — Max severity per rule (§15) принято буквально: единственный Critical среди Low
  того же правила определяет severity_weight для всей доли affected. Причина: текст плана
  однозначен; изменение — вопрос ruleset v2.
- **D-021** — `round2` = округление half-up по десятичному представлению (не banker's).
- **D-022** — Граница `Partial`: контракт `0 < coverage < 1` побеждает формулировку «1%–99%».
- **D-023** — Reliability timeout: 10 s на попытку, общий deadline цепочки (до 4 попыток
  с backoff) — 40 s.
- **D-024** — Retry `Partial → Running`: после ре-терминализации создаётся новый export
  snapshot; предыдущий помечается `superseded` (в рамках того же `scan_id`); интерфейс отдаёт
  только последний snapshot. Инвариант «один terminal record» действует внутри snapshot-а.
- **D-025** — Fixture-контракт: 3 фикстуры на правило (positive/negative/boundary), нейминг
  `fx-<rule_id>-{positive|negative|boundary}` (побеждает формулировка Explicit ruleset mapping §25).
  Для v0.1 обязательны positive+negative; boundary — там, где у правила есть числовой порог.
- **D-026** — `usable output` для целей refund: findings, единственным содержанием которых
  является недоступность самой цели (DNS/timeout/5xx на все запросы), не считаются usable
  output. Причина: закрывает дыру «сайт лежит → Partial без refund» (находка QA-5), соответствует
  интенту `NoUsableOutput` §18.
- **D-027** — Пустой сайт / robots disallow-all: каскад `Not applicable` → `Insufficient data`;
  причина external; refund по общему правилу `NoUsableOutput` (все модули без usable output).
- **D-028** — Ресурсные лимиты краулера: max 5 MB HTML на страницу, max 2048 байт URL,
  max 5 redirects, 10 s timeout на страницу. Причина: план не задаёт (находка QA-12).
- **D-029** — Подпись webhook в MockPaddle: HMAC-SHA256 по raw body, секрет из env
  (`PADDLE_WEBHOOK_SECRET`), raw payload + signature сохраняются; невалидная подпись — reject
  с negative-фикстурой (`BILLING-001`).
- **D-030** — Лимиты пассивного краулера per host: 5 req/s, 4 одновременных запроса,
  авто-throttle при росте доли 5xx. Причина: находка security-агента №9 (краулер как
  DDoS-инструмент); значения консервативнее активного профиля не требуются.

## Решения, принятые в ходе реализации

(дополняется по мере выполнения задач)
