import type { Language } from './i18n';
import { ukrainianReportCopy } from './report-language';

export const completeCatalogCopy = {
  en: {
    heading: 'What a new paid audit can check',
    scope:
      'These checks were not run in this Free report. Basic includes SEO and AI/GEO; Complete includes all ten sections. A new audit runs applicable checks, subject to the plan’s page limit and available services. These are check names, not hidden results.',
    available: 'Not run in this report',
    labels: { SEO: 'Additional SEO checks', 'AI SEO / GEO': 'Expanded AI analysis' },
    benefits: {
      SEO: 'Sitemaps, canonical URLs and redirect chains across your site.',
      'AI SEO / GEO': 'Brand mentions and citations across additional AI answers.',
      Security: 'TLS certificates, security headers and email protection.',
      Performance: 'Loading speed, layout shifts and heavy page resources.',
      Accessibility: 'Contrast, form labels and keyboard navigation risks.',
      Reliability: 'Broken pages, response times and configured public APIs.',
      'Content Quality': 'Duplicate content, missing media and published placeholder text.',
      Privacy: 'Cookies, trackers and visible consent controls.',
      'UX/Conversion': 'Clear main actions, form submission and conversion friction.',
      Analytics: 'Search opportunities and key events from connected services.',
    },
    upgrade: 'Run the complete audit',
    notes: {
      SEO: 'Additional SEO checks across the crawled site. The Free checks and recorded checks above are excluded.',
      'AI SEO / GEO':
        'Expanded AI scope beyond the separate Free answer. Results depend on saved context, consent, selected providers, available answers and evidence; they do not guarantee visibility.',
      Security: 'Passive checks of public responses, TLS and email DNS records.',
      Performance:
        'PageSpeed on sampled pages and available devices; CrUX where visitor data exists. Comparisons need a comparable previous scan.',
      Accessibility:
        'Automated HTML checks, with the remaining manual review scope identified separately.',
      Reliability:
        'Page checks plus optional configured public API endpoints. API request policy checks apply only to configured requests; credentials and state-changing requests are not executed.',
      'Content Quality':
        'Checks use the pages and evidence found. Readability supports English and Ukrainian; article and medical transparency checks apply only to relevant content.',
      Privacy: 'Cookie, script and consent-control observations from HTML and public responses.',
      'UX/Conversion':
        'Three static checks and three AI-assisted reviews when evidence and a usable provider response exist.',
      Analytics:
        'Search Console and GA4 checks need connected Google services and enough data. Bing observations need a connected Bing service; source availability and period coverage are reported separately. No connection is not a site failure.',
    },
  },
  uk: {
    heading: 'Що може перевірити новий платний аудит',
    scope:
      'Ці перевірки не виконувалися в цьому Free-звіті. Basic включає SEO та AI/GEO; Complete — усі десять розділів. Новий аудит виконує застосовні перевірки в межах ліміту сторінок тарифу й доступних сервісів. Це назви перевірок, а не приховані результати.',
    available: 'Не виконувались у цьому звіті',
    labels: { SEO: 'Додаткові SEO-перевірки', 'AI SEO / GEO': 'Розширений AI-аналіз' },
    benefits: {
      SEO: 'Карти сайту, канонічні URL і ланцюжки перенаправлень.',
      'AI SEO / GEO': 'Згадки бренду й цитування в додаткових AI-відповідях.',
      Security: 'TLS-сертифікати, заголовки безпеки й захист пошти.',
      Performance: 'Швидкість завантаження, зсуви макета й важкі ресурси.',
      Accessibility: 'Контраст, підписи форм і ризики навігації з клавіатури.',
      Reliability: 'Недоступні сторінки, час відповіді й налаштовані публічні API.',
      'Content Quality': 'Дублікати вмісту, відсутні медіа й шаблонний текст.',
      Privacy: 'Cookies, трекери й видимі елементи згоди.',
      'UX/Conversion': 'Зрозумілі головні дії, надсилання форм і перешкоди конверсії.',
      Analytics: 'Можливості в пошуку й ключові події підключених сервісів.',
    },
    upgrade: 'Запустити повний аудит',
    notes: {
      SEO: 'Додаткові SEO-перевірки просканованого сайту. Перевірки Free та збережені вище перевірки виключено.',
      'AI SEO / GEO':
        'Розширений AI-аналіз поза окремою Free-відповіддю. Результати залежать від контексту, згоди, обраних провайдерів, доступних відповідей і доказів; видимість не гарантується.',
      Security: 'Пасивні перевірки публічних відповідей, TLS і DNS-записів пошти.',
      Performance:
        'PageSpeed на вибраних сторінках і доступних пристроях; CrUX за наявності даних відвідувачів. Порівняння потребує зіставного попереднього сканування.',
      Accessibility: 'Автоматичні перевірки HTML з окремим визначенням обсягу ручного огляду.',
      Reliability:
        'Перевірки сторінок і додаткових налаштованих публічних API-ендпоінтів. Політика API-запитів застосовується лише до налаштованих запитів; запити з обліковими даними та зміною стану не виконуються.',
      'Content Quality':
        'Перевірки спираються на знайдені сторінки й докази. Читабельність підтримує англійську й українську; прозорість статей і медичного бізнесу перевіряється лише для відповідного вмісту.',
      Privacy:
        'Спостереження за cookies, скриптами й елементами згоди в HTML і публічних відповідях.',
      'UX/Conversion':
        'Три статичні перевірки й три AI-огляди за наявності доказів і придатної відповіді провайдера.',
      Analytics:
        'Перевірки Search Console і GA4 потребують підключених сервісів Google і достатніх даних. Спостереження Bing потребують підключення Bing; доступність джерел і покриття періоду показуються окремо. Відсутність підключення не є помилкою сайту.',
    },
  },
  ru: {
    heading: 'Что может проверить новый платный аудит',
    scope:
      'Эти проверки не выполнялись в этом Free-отчёте. Basic включает SEO и AI/GEO; Complete — все десять разделов. Новый аудит выполняет применимые проверки в пределах лимита страниц тарифа и доступных сервисов. Это названия проверок, а не скрытые результаты.',
    available: 'Не выполнялись в этом отчёте',
    labels: { SEO: 'Дополнительные SEO-проверки', 'AI SEO / GEO': 'Расширенный ИИ-анализ' },
    benefits: {
      SEO: 'Карты сайта, канонические URL и цепочки перенаправлений.',
      'AI SEO / GEO': 'Упоминания бренда и цитирование в дополнительных ИИ-ответах.',
      Security: 'TLS-сертификаты, заголовки безопасности и защита почты.',
      Performance: 'Скорость загрузки, сдвиги макета и тяжёлые ресурсы.',
      Accessibility: 'Контраст, подписи форм и риски навигации с клавиатуры.',
      Reliability: 'Недоступные страницы, время ответа и настроенные публичные API.',
      'Content Quality': 'Дубли контента, отсутствующие медиа и шаблонный текст.',
      Privacy: 'Cookies, трекеры и видимые элементы согласия.',
      'UX/Conversion': 'Понятные главные действия, отправка форм и препятствия конверсии.',
      Analytics: 'Возможности в поиске и ключевые события подключённых сервисов.',
    },
    upgrade: 'Запустить полный аудит',
    notes: {
      SEO: 'Дополнительные SEO-проверки просканированного сайта. Проверки Free и сохранённые выше проверки исключены.',
      'AI SEO / GEO':
        'Расширенный ИИ-анализ сверх отдельного Free-ответа. Результаты зависят от контекста, согласия, выбранных провайдеров, доступных ответов и доказательств; видимость не гарантируется.',
      Security: 'Пассивные проверки публичных ответов, TLS и почтовых DNS-записей.',
      Performance:
        'PageSpeed на выбранных страницах и доступных устройствах; CrUX при наличии данных посетителей. Сравнения требуют сопоставимого предыдущего сканирования.',
      Accessibility: 'Автоматические проверки HTML с отдельным определением объёма ручного обзора.',
      Reliability:
        'Проверки страниц и дополнительных настроенных публичных API-эндпоинтов. Политика API-запросов применяется только к настроенным запросам; запросы с учётными данными и изменением состояния не выполняются.',
      'Content Quality':
        'Проверки опираются на найденные страницы и доказательства. Читаемость поддерживает английский и украинский; прозрачность статей и медицинского бизнеса проверяется только для соответствующего содержимого.',
      Privacy: 'Наблюдения cookies, скриптов и элементов согласия в HTML и публичных ответах.',
      'UX/Conversion':
        'Три статические проверки и три ИИ-обзора при наличии доказательств и пригодного ответа провайдера.',
      Analytics:
        'Проверки Search Console и GA4 требуют подключённых сервисов Google и достаточных данных. Наблюдения Bing требуют подключения Bing; доступность источников и охват периода показаны отдельно. Отсутствие подключения не является ошибкой сайта.',
    },
  },
} satisfies Record<Language, unknown>;

// Catalogue names remain Ukrainian in Russian chrome, like the report's rule names.
export const geoCatalogCapabilities = ukrainianReportCopy({
  en: [
    [
      'geo-additional-answers',
      'Brand presence, site links, tone and factual consistency across additional AI answers',
    ],
    [
      'geo-provider-scope',
      'Closed-book questions to additional providers; Gemini and Perplexity only when selected',
    ],
    ['geo-discovery', 'Neutral web-assisted discovery questions from saved business context'],
    [
      'geo-citations',
      'Per-engine citations, competing domains and brand position; configured competitor comparisons',
    ],
    [
      'geo-page-scope',
      'Readable content, structured data and social metadata across additional crawled pages',
    ],
  ],
  uk: [
    [
      'geo-additional-answers',
      'Присутність бренду, посилання, тон і узгодженість фактів у додаткових AI-відповідях',
    ],
    [
      'geo-provider-scope',
      'Питання без вебпошуку до додаткових провайдерів; Gemini й Perplexity лише за вибором',
    ],
    [
      'geo-discovery',
      'Нейтральні пошукові питання з вебпошуком на основі збереженого контексту бізнесу',
    ],
    [
      'geo-citations',
      'Цитування за рушіями, домени конкурентів і позиція бренду; порівняння з налаштованими конкурентами',
    ],
    [
      'geo-page-scope',
      'Читабельний вміст, структуровані дані й соціальні метадані додаткових просканованих сторінок',
    ],
  ],
});
