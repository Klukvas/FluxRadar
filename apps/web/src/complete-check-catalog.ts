// UI-only mirrors: parity tests pin these names to implemented source inventories.
import type { ScanModule } from './api';
import type { Language } from './i18n';
import { FREE_SEO_RULE_IDS, SEO_CHECK_CATALOG } from './free-seo-catalog';
import { asRecord, ruleChecksOf } from './module-metadata';
import { PLAN_MODULES } from './plan-modules';
import { reportLanguage } from './report-language';

type CatalogDefinition = readonly [id: string, en: string, uk: string];

export const COMPLETE_RULE_CATALOG: Readonly<Record<string, readonly CatalogDefinition[]>> = {
  SEO: SEO_CHECK_CATALOG,
  Security: [
    ['SEC-PASSIVE-001', 'TLS certificate validity', 'Чинність TLS-сертифіката'],
    ['SEC-PASSIVE-002', 'Baseline security headers', 'Базові заголовки безпеки'],
    ['SEC-PASSIVE-003', 'HTTPS enforcement (HSTS)', 'Примусове HTTPS (HSTS)'],
    ['SEC-PASSIVE-005', 'Cookie security attributes', 'Атрибути безпеки cookies'],
    ['SEC-PASSIVE-007', 'SPF and DMARC email protection', 'Захист електронної пошти SPF і DMARC'],
    ['SEC-ASVS-001', 'Content Security Policy', 'Політика безпеки вмісту (CSP)'],
    ['SEC-ASVS-002', 'Permissions Policy', 'Політика дозволів (Permissions Policy)'],
    [
      'SEC-ASVS-003',
      'Cross-origin credential policy (CORS)',
      'Політика облікових даних між джерелами (CORS)',
    ],
  ],
  Reliability: [
    ['REL-URL-001', 'URL availability', 'Доступність URL'],
    ['REL-URL-003', 'Unexpected HTTP errors', 'Неочікувані HTTP-помилки'],
    ['REL-URL-009', 'URL response time', 'Час відповіді URL'],
    [
      'REL-API-003',
      'Expected status of configured public API endpoints',
      'Очікуваний статус налаштованих публічних API-ендпоінтів',
    ],
    [
      'REL-API-005',
      'Credential and method policy for configured API requests',
      'Політика облікових даних і методів налаштованих API-запитів',
    ],
  ],
  Accessibility: [
    [
      'A11Y-001',
      'Text contrast in detectable color pairs',
      'Контраст тексту у визначених парах кольорів',
    ],
    ['A11Y-002', 'Image alternative text', 'Альтернативний текст зображень'],
    [
      'A11Y-003',
      'Document language and heading structure',
      'Мова документа й структура заголовків',
    ],
    ['A11Y-004', 'Form field labels', 'Підписи полів форм'],
    ['A11Y-005', 'Keyboard navigation risks', 'Ризики навігації з клавіатури'],
    ['A11Y-006', 'Visible keyboard focus', 'Видимість фокуса клавіатури'],
    ['A11Y-007', 'ARIA attribute integrity', 'Цілісність ARIA-атрибутів'],
    [
      'A11Y-008',
      'Accessible names of interactive controls',
      'Доступні назви інтерактивних елементів',
    ],
    ['A11Y-009', 'Form error descriptions', 'Описи помилок форм'],
    [
      'A11Y-010',
      'Landmarks, frame titles and media captions',
      'Орієнтири, назви фреймів і субтитри медіа',
    ],
    ['A11Y-012', 'Page zoom configuration', 'Налаштування масштабування сторінки'],
  ],
  'Content Quality': [
    ['CONTENT-001', 'Content uniqueness across pages', 'Унікальність змісту між сторінками'],
    [
      'CONTENT-003',
      'Empty or very short page content',
      'Порожній або дуже короткий зміст сторінок',
    ],
    ['CONTENT-004', 'Image and media availability', 'Доступність зображень і медіа'],
    ['CONTENT-005', 'Readability in supported languages', 'Читабельність підтримуваними мовами'],
    [
      'CONTENT-008',
      'Article attribution and publication dates',
      'Авторство статей і дати публікації',
    ],
    ['CONTENT-011', 'Published placeholder text', 'Опублікований шаблонний текст'],
    ['CONTENT-012', 'Medical business transparency signals', 'Ознаки прозорості медичного бізнесу'],
  ],
  Privacy: [
    ['PRIVACY-001', 'Observed cookies', 'Виявлені cookies'],
    ['PRIVACY-002', 'Tracking and visible consent controls', 'Відстеження й видимі елементи згоди'],
    ['PRIVACY-003', 'Third-party script origins', 'Джерела сторонніх скриптів'],
    [
      'PRIVACY-004',
      'Privacy policy discoverability',
      'Можливість знайти політику конфіденційності',
    ],
  ],
  'UX/Conversion': [
    ['UX-CONV-STATIC-001', 'Entry-page main heading', 'Головний заголовок вхідної сторінки'],
    ['UX-CONV-STATIC-002', 'Entry-page action path', 'Шлях до дії на вхідній сторінці'],
    ['UX-CONV-STATIC-003', 'Explicit form submission controls', 'Явні елементи надсилання форм'],
    [
      'UX-CONV-AI-001',
      'Value proposition clarity · AI review',
      'Зрозумілість ціннісної пропозиції · AI-огляд',
    ],
    [
      'UX-CONV-AI-002',
      'Primary action clarity · AI review',
      'Зрозумілість головної дії · AI-огляд',
    ],
    [
      'UX-CONV-AI-003',
      'Conversion friction and trust · AI review',
      'Перешкоди конверсії й довіра · AI-огляд',
    ],
  ],
  Analytics: [
    ['ANALYTICS-SC-001', 'Organic search trend', 'Динаміка органічного пошуку'],
    [
      'ANALYTICS-SC-002',
      'First-page impressions without clicks',
      'Покази на першій сторінці без кліків',
    ],
    ['ANALYTICS-SC-003', 'Queries close to top results', 'Запити, близькі до топу пошуку'],
    [
      'ANALYTICS-SC-004',
      'Crawled pages without search impressions',
      'Проскановані сторінки без показів у пошуку',
    ],
    ['ANALYTICS-SC-005', 'Search impressions without clicks', 'Покази в пошуку без кліків'],
    ['ANALYTICS-GA-001', 'Key events recorded in GA4', 'Ключові події, записані в GA4'],
    ['ANALYTICS-GA-002', 'Google tag coverage across pages', 'Покриття сторінок тегом Google'],
    [
      'ANALYTICS-LINK-001',
      'Audit findings on top search pages',
      'Знахідки аудиту на провідних сторінках пошуку',
    ],
  ],
};

export const PERFORMANCE_CHECK_CATALOG = [
  ['PERF-LAB-TTFB', 'Server response time (lab TTFB)', 'Час відповіді сервера (лабораторний TTFB)'],
  [
    'PERF-LAB-LCP',
    'Largest content paint (lab LCP)',
    'Найбільше відображення вмісту (лабораторний LCP)',
  ],
  ['PERF-LAB-CLS', 'Layout stability (lab CLS)', 'Стабільність макета (лабораторний CLS)'],
  [
    'PERF-LAB-TBT',
    'Main-thread blocking (lab TBT)',
    'Блокування головного потоку (лабораторний TBT)',
  ],
  [
    'PERF-FIELD-INP',
    'Real-visitor responsiveness (field INP)',
    'Відгук для реальних відвідувачів (польовий INP)',
  ],
  [
    'PERF-FIELD-LCP',
    'Real-visitor loading (field LCP)',
    'Завантаження для реальних відвідувачів (польовий LCP)',
  ],
  ['PERF-RES-WEIGHT', 'Page transfer size', 'Обсяг передавання сторінки'],
  ['PERF-RES-REQUESTS', 'Page request count', 'Кількість запитів сторінки'],
  ['PERF-RES-UNUSED-JS', 'Unused JavaScript', 'Невикористаний JavaScript'],
  ['PERF-RES-COMPRESSION', 'Text resource compression', 'Стиснення текстових ресурсів'],
  ['PERF-RES-IMAGES', 'Image format savings', 'Економія завдяки форматам зображень'],
  ['PERF-CACHE-TTL', 'Static resource cache lifetime', 'Строк кешування статичних ресурсів'],
  ['PERF-RENDER-BLOCKING', 'Render-blocking resources', 'Ресурси, що блокують відображення'],
  [
    'PERF-MEASUREMENT-UNSTABLE',
    'Repeated measurement stability',
    'Стабільність повторних вимірювань',
  ],
] as const;

export const BING_CHECK_CATALOG = [
  ['BING-TRAFFIC-DROP', 'Bing search traffic trend', 'Динаміка пошукового трафіку Bing'],
  ['BING-NO-CLICKS', 'Bing impressions without clicks', 'Покази Bing без кліків'],
  ['BING-LOW-CTR', 'Bing click-through rate', 'Коефіцієнт кліків Bing'],
  [
    'BING-QUERY-CONCENTRATION',
    'Bing traffic concentration by query',
    'Концентрація трафіку Bing за запитами',
  ],
] as const;

// These registry entries describe shared Free AI measurements or reporting
// contracts, not extra checks that a Free customer has yet to unlock.
export const CATALOG_REGISTRY_EXCLUSIONS = {
  'GEO-PROVIDER-001': 'provider-contract',
  'GEO-METHOD-002': 'response-provenance',
  'GEO-METHOD-005': 'unavailable-state-contract',
  'GEO-VIS-003': 'shared-free-ai-measurement',
  'GEO-VIS-004': 'shared-free-ai-measurement',
  'GEO-VIS-007': 'shared-free-ai-measurement',
  'GEO-VIS-009': 'shared-free-ai-measurement',
  'A11Y-011': 'manual-review-boundary',
} as const;
export const BING_CATALOG_EXCLUSIONS = {
  'BING-PARTIAL-PERIOD': 'source-period-coverage',
  'BING-READ-UNAVAILABLE': 'source-unavailable-state',
} as const;

export const COMPLETE_CATALOG_MODULES = PLAN_MODULES.Complete;

export function recordedCatalogIds(modules: readonly ScanModule[]): readonly string[] {
  return modules.flatMap((module) => [
    ...ruleChecksOf(module.metadata).map((check) => check.ruleId),
    ...(Array.isArray(module.metadata?.checks)
      ? module.metadata.checks.flatMap((entry) => {
          const id = asRecord(entry)?.ruleId;
          return typeof id === 'string' ? [id] : [];
        })
      : []),
  ]);
}

export function completeCatalogChecks(
  module: string,
  recordedIds: readonly string[],
  language: Language,
): readonly { id: string; title: string }[] {
  const definitions =
    module === 'Performance'
      ? PERFORMANCE_CHECK_CATALOG
      : module === 'Analytics'
        ? [...(COMPLETE_RULE_CATALOG.Analytics ?? []), ...BING_CHECK_CATALOG]
        : (COMPLETE_RULE_CATALOG[module] ?? []);
  const excluded = new Set<string>([...FREE_SEO_RULE_IDS, ...recordedIds]);
  return definitions
    .filter(([id]) => !excluded.has(id))
    .map(([id, en, uk]) => ({
      id,
      title: reportLanguage(language) === 'en' ? en : uk,
    }));
}
