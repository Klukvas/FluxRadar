// What a section and a problem are CALLED, in the language the report is read in.
//
// The renderer used to print the module row's own `module` and the finding's
// `ruleId`: a Ukrainian document named its sections `Content Quality` and
// headlined a problem `SEC-HEADERS-001`, with the status, the reason clause and
// the recommendation localized around them. The browser report has named both
// since the Issue Center stopped headlining rows with an id — these are its two
// catalogues, keyed the same way.
//
// MIRRORED, NOT SHARED. `apps/web/src/rule-titles.ts` is the original; the API
// does not depend on `apps/web`, and lifting the catalogue into a package both
// of them import would edit files other lanes are integrating in parallel. So it
// is copied here, and `names.test.ts` reads the browser's file as text and fails
// when the two drift — the same seam that file uses to check itself against the
// rule registry in `packages/contracts`. Consolidating the two copies into one
// shared module is worth doing once the lanes have merged.
//
// AN UNKNOWN ID STAYS AN ID. A rule or a section this build has no name for
// prints what the row carries rather than nothing: the id is what a reader would
// quote to support, and it is what the browser falls back to as well.

import type { FindingLanguage } from '@fluxradar/rules';

interface LocalizedName {
  readonly en: string;
  readonly uk: string;
}

export const RULE_TITLES: Readonly<Record<string, LocalizedName>> = {
  'SEO-TECH-001': {
    en: 'robots.txt is missing or unreachable',
    uk: 'robots.txt відсутній або недоступний',
  },
  'SEO-TECH-002': {
    en: 'No sitemap search engines can read',
    uk: 'Немає sitemap, який можуть прочитати пошуковики',
  },
  'SEO-TECH-003': {
    en: 'Page does not answer with HTTP 200',
    uk: 'Сторінка не відповідає кодом HTTP 200',
  },
  'SEO-TECH-004': {
    en: 'Canonical URL is missing or wrong',
    uk: 'Canonical URL відсутній або хибний',
  },
  'SEO-TECH-005': {
    en: 'Redirect chain or redirect loop',
    uk: 'Ланцюжок або цикл редиректів',
  },
  'SEO-TECH-006': {
    en: 'Links to pages that return an error (4xx/5xx)',
    uk: 'Посилання на сторінки, що повертають помилку (4xx/5xx)',
  },
  'SEO-TECH-007': {
    en: 'Same page reachable at several URLs',
    uk: 'Одна сторінка доступна за кількома URL',
  },
  'SEO-TECH-008': {
    en: 'Noindex page is still in the sitemap or linked to',
    uk: 'Сторінка з noindex досі в sitemap або на неї посилаються',
  },
  'SEO-TECH-013': {
    en: 'Insecure (HTTP) resources on an HTTPS page',
    uk: 'Незахищені (HTTP) ресурси на HTTPS-сторінці',
  },
  'SEO-ONPAGE-001': {
    en: 'Page title is missing or the wrong length',
    uk: 'Заголовок сторінки (title) відсутній або неправильної довжини',
  },
  'SEO-ONPAGE-002': {
    en: 'Meta description is missing or the wrong length',
    uk: 'Meta description відсутній або неправильної довжини',
  },
  'SEO-ONPAGE-003': {
    en: 'Heading structure is broken (H1–H6)',
    uk: 'Порушена структура заголовків (H1–H6)',
  },
  'SEO-ONPAGE-005': {
    en: 'Images without alt text',
    uk: 'Зображення без alt-тексту',
  },
  'SEO-STRUCT-001': {
    en: 'Structured data (JSON-LD) does not parse',
    uk: 'Структуровані дані (JSON-LD) не читаються',
  },
  'SEO-STRUCT-002': {
    en: 'Structured data (JSON-LD) is incomplete',
    uk: 'Структуровані дані (JSON-LD) неповні',
  },
  'SEO-SOCIAL-001': {
    en: 'Link preview for social networks is incomplete',
    uk: 'Неповне превʼю посилання для соцмереж',
  },
  'SEC-PASSIVE-002': {
    en: 'Security headers are missing',
    uk: 'Відсутні заголовки безпеки',
  },
  'SEC-PASSIVE-003': {
    en: 'HTTPS is not enforced (HSTS)',
    uk: 'HTTPS не закріплено (HSTS)',
  },
  'SEC-PASSIVE-005': {
    en: 'Cookies without secure attributes',
    uk: 'Cookies без захисних атрибутів',
  },
  'SEC-ASVS-001': {
    en: 'Content-Security-Policy is missing or weak',
    uk: 'Content-Security-Policy відсутня або слабка',
  },
  'SEC-ASVS-002': {
    en: 'Permissions-Policy is missing',
    uk: 'Відсутня Permissions-Policy',
  },
  'SEC-ASVS-003': {
    en: 'CORS allows any origin with credentials',
    uk: 'CORS дозволяє будь-яке джерело разом з обліковими даними',
  },
  'REL-URL-001': {
    en: 'Page is unavailable',
    uk: 'Сторінка недоступна',
  },
  'REL-URL-003': {
    en: 'Page answers with an unexpected error',
    uk: 'Сторінка відповідає неочікуваною помилкою',
  },
  'REL-URL-009': {
    en: 'Slow server response',
    uk: 'Повільна відповідь сервера',
  },
  'REL-API-003': {
    en: 'Endpoint answers with an unexpected status',
    uk: 'Ендпоінт відповідає неочікуваним статусом',
  },
  'REL-API-005': {
    en: 'Endpoint check carries credentials',
    uk: 'Перевірка ендпоінта містить облікові дані',
  },
  'A11Y-001': {
    en: 'Text contrast is too low',
    uk: 'Замалий контраст тексту',
  },
  'A11Y-002': {
    en: 'Images without a text alternative',
    uk: 'Зображення без текстової альтернативи',
  },
  'A11Y-003': {
    en: 'Page language is missing or headings are out of order',
    uk: 'Не вказано мову сторінки або порушено порядок заголовків',
  },
  'A11Y-004': {
    en: 'Form fields without labels',
    uk: 'Поля форм без підписів',
  },
  'A11Y-005': {
    en: 'Controls unreachable by keyboard',
    uk: 'Елементи недоступні з клавіатури',
  },
  'A11Y-006': {
    en: 'Keyboard focus is not visible',
    uk: 'Фокус клавіатури не видно',
  },
  'A11Y-007': {
    en: 'ARIA attributes are used incorrectly',
    uk: 'ARIA-атрибути використано неправильно',
  },
  'A11Y-008': {
    en: 'Buttons or links without an accessible name',
    uk: 'Кнопки чи посилання без доступної назви',
  },
  'A11Y-009': {
    en: 'Form errors are not announced',
    uk: 'Помилки форм не озвучуються',
  },
  'A11Y-010': {
    en: 'Page structure is unclear to screen readers',
    uk: 'Структура сторінки незрозуміла екранним читачам',
  },
  'A11Y-011': {
    en: 'Needs a manual accessibility review',
    uk: 'Потрібна ручна перевірка доступності',
  },
  'CONTENT-003': {
    en: 'Page has little or no content',
    uk: 'На сторінці мало або зовсім немає змісту',
  },
  'CONTENT-004': {
    en: 'Broken images or media',
    uk: 'Биті зображення або медіа',
  },
  'PRIVACY-001': {
    en: 'Page sets cookies that may need consent',
    uk: 'Сторінка встановлює cookies, які можуть потребувати згоди',
  },
  'PRIVACY-002': {
    en: 'Trackers without a visible consent mechanism',
    uk: 'Трекери без видимого механізму згоди',
  },
  'PRIVACY-003': {
    en: 'Third-party scripts load on the page',
    uk: 'На сторінці завантажуються сторонні скрипти',
  },
  'PRIVACY-004': {
    en: 'Privacy policy is hard to find',
    uk: 'Політику конфіденційності важко знайти',
  },
  'UX-CONV-STATIC-001': {
    en: 'Entry page has no clear main heading',
    uk: 'Вхідна сторінка без чіткого головного заголовка',
  },
  'UX-CONV-STATIC-002': {
    en: 'Entry page has no clear next action',
    uk: 'На вхідній сторінці немає чіткої наступної дії',
  },
  'UX-CONV-STATIC-003': {
    en: 'Form without an explicit submit button',
    uk: 'Форма без явної кнопки надсилання',
  },
  'UX-CONV-AI-001': {
    en: 'Value proposition is unclear',
    uk: 'Нечітка ціннісна пропозиція',
  },
  'UX-CONV-AI-002': {
    en: 'Primary action is unclear',
    uk: 'Нечітка головна дія',
  },
  'UX-CONV-AI-003': {
    en: 'Friction or missing trust signals',
    uk: 'Тертя або бракує сигналів довіри',
  },
};

/** The rule's title in the report language, or its id when the rule is unknown. */
export function ruleTitle(ruleId: string, language: FindingLanguage): string {
  return RULE_TITLES[ruleId]?.[language] ?? ruleId;
}

export const MODULE_LABELS: Readonly<Record<string, LocalizedName>> = {
  SEO: { en: 'SEO', uk: 'SEO' },
  'AI SEO / GEO': { en: 'AI SEO / GEO', uk: 'AI SEO / GEO' },
  Security: { en: 'Security', uk: 'Безпека' },
  Performance: { en: 'Performance', uk: 'Швидкодія' },
  Accessibility: { en: 'Accessibility', uk: 'Доступність' },
  Reliability: { en: 'Reliability', uk: 'Надійність' },
  'Content Quality': { en: 'Content quality', uk: 'Якість контенту' },
  Privacy: { en: 'Privacy', uk: 'Приватність' },
  'UX/Conversion': { en: 'UX / conversion', uk: 'UX / конверсія' },
  Analytics: { en: 'Analytics', uk: 'Аналітика' },
};

/** A section's name in the report language, or the module's own name when it is unknown. */
export function moduleLabel(module: string, language: FindingLanguage): string {
  return MODULE_LABELS[module]?.[language] ?? module;
}
