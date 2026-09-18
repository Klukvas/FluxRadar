// Analytics: what the connected Search Console and GA4 data say next to the
// crawl. Only the scored rules produce findings; the two informational rules
// (queries just below the first page, findings on top search pages) are lists
// in the report and never become issues.

import type { FindingMessageCatalog } from './catalog.js';

export const ANALYTICS_MESSAGES = {
  'analytics-sc-001.evidence.clicks': {
    en: 'Organic clicks fell from {previous} to {current} ({drop}% lower) against the previous 28 days.',
    uk: 'Органічні кліки впали з {previous} до {current} (на {drop}% менше) порівняно з попередніми 28 днями.',
  },
  'analytics-sc-001.evidence.impressions': {
    en: 'Search impressions fell from {previous} to {current} ({drop}% lower) against the previous 28 days.',
    uk: 'Покази в пошуку впали з {previous} до {current} (на {drop}% менше) порівняно з попередніми 28 днями.',
  },
  'analytics-sc-001.recommendation': {
    en: 'Compare the two periods in Search Console by page and by query to find where the traffic went, and check for pages that dropped out of the index, lost rankings or changed their URLs.',
    uk: 'Порівняйте обидва періоди в Search Console за сторінками й запитами, щоб знайти, де зник трафік, і перевірте сторінки, що випали з індексу, втратили позиції або змінили URL.',
  },
  'analytics-sc-002.evidence': {
    en: 'Google showed this page {impressions} times at an average position of {position}, and nobody clicked it.',
    uk: 'Google показав цю сторінку {impressions} разів на середній позиції {position}, але ніхто на неї не перейшов.',
  },
  'analytics-sc-002.recommendation': {
    en: 'Rewrite the page title and meta description so the search result says what the page offers, and check that the page answers the queries it is shown for.',
    uk: 'Перепишіть title і meta description, щоб результат пошуку прямо казав, що пропонує сторінка, і перевірте, що сторінка відповідає на запити, за якими її показують.',
  },
  'analytics-sc-004.evidence': {
    en: 'Search Console recorded no impressions for this page in the last 28 days.',
    uk: 'Search Console не зафіксувала жодного показу цієї сторінки за останні 28 днів.',
  },
  'analytics-sc-004.recommendation': {
    en: 'Check in Search Console whether the page is indexed. If it is, link to it from pages that already get search traffic and make its title match what people search for. A page published in the last few weeks may simply not have been shown yet.',
    uk: 'Перевірте в Search Console, чи проіндексована сторінка. Якщо так — поставте на неї посилання зі сторінок, які вже мають пошуковий трафік, і узгодьте її заголовок із тим, що шукають люди. Сторінку, опубліковану кілька тижнів тому, Google міг ще просто не показувати.',
  },
  'analytics-sc-005.evidence': {
    en: 'Google showed the site {impressions} times in the last 28 days at an average position of {position}, and nobody clicked through.',
    uk: 'Google показав сайт {impressions} разів за останні 28 днів на середній позиції {position}, але ніхто не перейшов.',
  },
  'analytics-sc-005.recommendation': {
    en: 'Clicks come from the top of the first results page. Start with the queries this section lists as close to the top, and make the pages Google already shows for them answer those searches better.',
    uk: 'Переходи дають верхні позиції першої сторінки результатів. Почніть із запитів, які цей розділ показує як близькі до топу, і зробіть так, щоб сторінки, які Google уже показує за ними, краще відповідали на ці пошуки.',
  },
  'analytics-ga-001.evidence': {
    en: 'GA4 property {property} recorded {sessions} sessions and no key events in the last 28 days.',
    uk: 'Ресурс GA4 {property} зафіксував {sessions} сесій і жодної ключової події за останні 28 днів.',
  },
  'analytics-ga-001.recommendation': {
    en: 'Mark the actions that matter to the business — a sign-up, a purchase, a contact form — as key events in GA4 Admin, and check that the events behind them actually fire.',
    uk: 'Позначте дії, важливі для бізнесу, — реєстрацію, покупку, форму зв’язку — як ключові події в налаштуваннях GA4 і перевірте, що відповідні події справді надсилаються.',
  },
  'analytics-ga-002.evidence': {
    en: 'The page HTML has no Google tag (gtag.js or Google Tag Manager), while {tagged} of {checked} crawled pages carry one.',
    uk: 'HTML сторінки не містить тегу Google (gtag.js або Google Tag Manager), тоді як {tagged} із {checked} перевірених сторінок його мають.',
  },
  'analytics-ga-002.recommendation': {
    en: 'Add the same Google tag the other pages use, usually through the shared page template, so GA4 counts visits to this page.',
    uk: 'Додайте той самий тег Google, що й на інших сторінках, — зазвичай через спільний шаблон сторінки, — щоб GA4 враховував відвідування цієї сторінки.',
  },
} as const satisfies FindingMessageCatalog;
