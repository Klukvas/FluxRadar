// SEO finding messages (SEO-TECH-*, SEO-ONPAGE-*, structured data, social preview).

import type { FindingMessageCatalog } from './catalog.js';

export const SEO_MESSAGES = {
  'seo-tech-001.evidence': {
    en: 'GET {url} did not return HTTP 200, so robots.txt is missing or unreachable',
    uk: 'GET {url} не повернув HTTP 200 — robots.txt відсутній або недоступний',
  },
  'seo-tech-001.recommendation': {
    en: 'Publish /robots.txt with crawl directives and a Sitemap line; search engine crawlers rely on it when scanning the site.',
    uk: 'Опублікуйте /robots.txt із директивами сканування та рядком Sitemap — пошукові роботи орієнтуються на нього, коли сканують сайт.',
  },

  'seo-tech-002.evidence': {
    en: 'Neither a Sitemap directive in robots.txt nor GET {url} returned any URLs, so the sitemap is missing, unreachable or empty',
    uk: 'Ні директива Sitemap у robots.txt, ні GET {url} не дали жодного URL — sitemap відсутній, недоступний або порожній',
  },
  'seo-tech-002.recommendation': {
    en: 'Publish a sitemap.xml listing the pages you want indexed and reference it in robots.txt with a Sitemap directive.',
    uk: 'Опублікуйте sitemap.xml зі списком сторінок, які мають індексуватися, і вкажіть його в robots.txt директивою Sitemap.',
  },

  'seo-tech-003.evidence': {
    en: 'The page returned HTTP {status}: {url}',
    uk: 'Сторінка повернула HTTP {status}: {url}',
  },
  'seo-tech-003.recommendation': {
    en: 'Return 200 for live pages; for removed pages, set up a 301 redirect to a replacement or remove internal links to this URL.',
    uk: 'Повертайте 200 для чинних сторінок; для видалених налаштуйте 301-редирект на заміну або приберіть внутрішні посилання на цей URL.',
  },

  'seo-tech-004.evidence.missing': {
    en: 'The document {url} has no <link rel="canonical">',
    uk: 'У документі {url} немає <link rel="canonical">',
  },
  'seo-tech-004.recommendation.missing': {
    en: 'Add a <link rel="canonical"> with the absolute URL of the page itself (or of its canonical version on the same domain).',
    uk: 'Додайте <link rel="canonical"> з абсолютним URL самої сторінки (або її канонічної версії на тому самому домені).',
  },
  'seo-tech-004.evidence.invalid': {
    en: '<link rel="canonical" href="{href}"> does not resolve to an absolute http(s) URL',
    uk: '<link rel="canonical" href="{href}"> не дає абсолютного http(s)-URL',
  },
  'seo-tech-004.recommendation.invalid': {
    en: 'Set rel=canonical to a valid absolute http(s) URL.',
    uk: 'Вкажіть у rel=canonical коректний абсолютний http(s)-URL.',
  },
  'seo-tech-004.evidence.foreign-host': {
    en: '<link rel="canonical" href="{href}"> points to another host, {canonicalHost}, while the page is served from {pageHost}',
    uk: '<link rel="canonical" href="{href}"> вказує на інший хост {canonicalHost}, хоча сторінка розміщена на {pageHost}',
  },
  'seo-tech-004.recommendation.foreign-host': {
    en: 'Point the canonical to a URL on the same host; a cross-domain canonical hands indexing over to another domain, so make sure that is intentional.',
    uk: 'Canonical має вказувати на URL у межах того самого хоста; кросдоменний canonical передає індексацію іншому домену — переконайтеся, що це зроблено навмисно.',
  },

  'seo-tech-005.evidence.loop': {
    en: 'Redirects from {url} never reach a final response: {error}',
    uk: 'Редиректи з {url} так і не доходять до фінальної відповіді: {error}',
  },
  'seo-tech-005.recommendation.loop': {
    en: 'Break the redirect loop: every URL should reach a final 200 response in no more than one redirect.',
    uk: 'Розірвіть цикл редиректів: кожен URL має вести до фінальної відповіді 200 не більше ніж за один перехід.',
  },
  'seo-tech-005.evidence.chain': {
    en: 'A chain of {count} redirects leads to {url} (HTTP {status}): {chain}',
    uk: 'До {url} (HTTP {status}) веде ланцюжок із {count} редиректів: {chain}',
  },
  'seo-tech-005.recommendation.chain': {
    en: 'Cut the chain down to a single redirect: link straight to the final URL and redirect old addresses to it directly.',
    uk: 'Скоротіть ланцюжок до одного редиректу: посилайтеся одразу на фінальний URL, а старі адреси перенаправляйте на нього напряму.',
  },

  'seo-tech-006.evidence': {
    en: 'The link a[href="{href}"] leads to a page that returns HTTP {status} ({url})',
    uk: 'Посилання a[href="{href}"] веде на сторінку, що повертає HTTP {status} ({url})',
  },
  'seo-tech-006.recommendation': {
    en: 'Remove or update the link: point it to a working URL or restore the target page.',
    uk: 'Приберіть або оновіть посилання: ведіть на чинний URL або відновіть цільову сторінку.',
  },

  'seo-tech-007.evidence': {
    en: 'The same page is reachable at {count} different URLs that all normalize to {url}: {variants}',
    uk: 'Та сама сторінка доступна за {count} різними адресами, що зводяться до {url}: {variants}',
  },
  'seo-tech-007.recommendation': {
    en: 'Serve each page under a single canonical URL: set up a redirect or rel=canonical for variants with tracking parameters and other alternative forms.',
    uk: 'Віддавайте кожну сторінку за єдиним канонічним URL: налаштуйте редирект або rel=canonical для варіантів із трекінг-параметрами та інших альтернативних форм.',
  },

  'seo-tech-008.evidence.meta.sitemap': {
    en: '<meta name="robots" content="{content}"> is set, yet the page is listed in the sitemap',
    uk: 'Задано <meta name="robots" content="{content}">, але сторінка є в sitemap',
  },
  'seo-tech-008.evidence.meta.internal-links': {
    en: '<meta name="robots" content="{content}"> is set, yet other pages link to it internally (linking pages: {sources})',
    uk: 'Задано <meta name="robots" content="{content}">, але на сторінку ведуть внутрішні посилання з інших сторінок (сторінок-джерел: {sources})',
  },
  'seo-tech-008.evidence.header.sitemap': {
    en: 'The page sends X-Robots-Tag: {value}, yet it is listed in the sitemap',
    uk: 'Сторінка надсилає X-Robots-Tag: {value}, але вона є в sitemap',
  },
  'seo-tech-008.evidence.header.internal-links': {
    en: 'The page sends X-Robots-Tag: {value}, yet other pages link to it internally (linking pages: {sources})',
    uk: 'Сторінка надсилає X-Robots-Tag: {value}, але на неї ведуть внутрішні посилання з інших сторінок (сторінок-джерел: {sources})',
  },
  'seo-tech-008.recommendation': {
    en: 'Resolve the conflicting indexing signals: either remove noindex, or take the page out of the sitemap and remove the internal links to it.',
    uk: 'Усуньте суперечність сигналів індексації: або приберіть noindex, або виключіть сторінку із sitemap і приберіть внутрішні посилання на неї.',
  },

  'seo-tech-013.evidence': {
    en: '{selector} is loaded over unencrypted http:// ({url})',
    uk: '{selector} завантажується через незашифрований http:// ({url})',
  },
  'seo-tech-013.recommendation': {
    en: 'Load subresources over https:// (or a protocol-relative URL on the same origin); browsers block or flag mixed content.',
    uk: 'Завантажуйте субресурси через https:// (або протокол-відносним URL того самого origin) — браузери блокують або позначають mixed content.',
  },

  'seo-onpage-001.evidence.missing': {
    en: '<title> is missing or empty',
    uk: '<title> відсутній або порожній',
  },
  'seo-onpage-001.evidence.too-short': {
    en: 'The title "{title}" is {length} characters long (< {min})',
    uk: 'Title «{title}» має довжину {length} симв. (< {min})',
  },
  'seo-onpage-001.evidence.too-long': {
    en: 'The title is {length} characters long (> {max}): "{title}"',
    uk: 'Title має довжину {length} симв. (> {max}): «{title}»',
  },
  'seo-onpage-001.recommendation': {
    en: 'Give the page a unique, informative <title> of {min}–{max} characters.',
    uk: 'Дайте сторінці унікальний інформативний <title> довжиною {min}–{max} символів.',
  },

  'seo-onpage-002.evidence.missing': {
    en: '<meta name="description"> is missing or empty',
    uk: '<meta name="description"> відсутній або порожній',
  },
  'seo-onpage-002.evidence.too-short': {
    en: 'The meta description is {length} characters long (< {min}): "{description}"',
    uk: 'Meta description має довжину {length} симв. (< {min}): «{description}»',
  },
  'seo-onpage-002.evidence.too-long': {
    en: 'The meta description is {length} characters long (> {max})',
    uk: 'Meta description має довжину {length} симв. (> {max})',
  },
  'seo-onpage-002.recommendation': {
    en: 'Describe the page in a meta description of {min}–{max} characters; the search result snippet is taken from it.',
    uk: 'Опишіть зміст сторінки в meta description довжиною {min}–{max} символів — сніпет у пошуковій видачі береться звідси.',
  },

  'seo-onpage-003.evidence.no-headings': {
    en: 'The page has no headings at all, so it has no h1',
    uk: 'На сторінці немає жодного заголовка, тож немає й h1',
  },
  'seo-onpage-003.evidence.no-h1': {
    en: 'The page has no h1. Heading outline: {outline}',
    uk: 'На сторінці немає h1. Структура заголовків: {outline}',
  },
  'seo-onpage-003.evidence.no-h1.level-skip': {
    en: 'The page has no h1, and the jump from h{from} to h{to} skips a level. Heading outline: {outline}',
    uk: 'На сторінці немає h1, а перехід h{from} → h{to} пропускає рівень. Структура заголовків: {outline}',
  },
  'seo-onpage-003.evidence.multiple-h1': {
    en: 'The page has {count} h1 headings. Heading outline: {outline}',
    uk: 'На сторінці кілька h1 ({count}). Структура заголовків: {outline}',
  },
  'seo-onpage-003.evidence.multiple-h1.level-skip': {
    en: 'The page has {count} h1 headings, and the jump from h{from} to h{to} skips a level. Heading outline: {outline}',
    uk: 'На сторінці кілька h1 ({count}), а перехід h{from} → h{to} пропускає рівень. Структура заголовків: {outline}',
  },
  'seo-onpage-003.evidence.level-skip': {
    en: 'The jump from h{from} to h{to} skips a level. Heading outline: {outline}',
    uk: 'Перехід h{from} → h{to} пропускає рівень. Структура заголовків: {outline}',
  },
  'seo-onpage-003.recommendation': {
    en: 'Use exactly one h1 and build the hierarchy without skipping levels (h1 → h2 → h3 …).',
    uk: 'Використовуйте рівно один h1 і будуйте ієрархію без пропуску рівнів (h1 → h2 → h3 …).',
  },

  'seo-onpage-005.evidence': {
    en: '{count} <img> without an alt attribute; first: <img src="{src}"> (decorative images need an empty alt="")',
    uk: 'Зображень <img> без атрибута alt: {count}; перше: <img src="{src}"> (декоративним потрібен порожній alt="")',
  },
  'seo-onpage-005.recommendation': {
    en: 'Give every meaningful image an informative alt, and every decorative one an explicit empty alt="".',
    uk: 'Додайте інформативний alt кожному змістовному зображенню, а декоративним — явний порожній alt="".',
  },

  'seo-struct-001.evidence': {
    en: 'JSON-LD blocks that could not be parsed as JSON: {count}; first selector: {selector}',
    uk: 'Блоків JSON-LD, які не вдалося розібрати як JSON: {count}; перший селектор: {selector}',
  },
  'seo-struct-001.recommendation': {
    en: 'Check the JSON-LD with a JSON parser and the Rich Results Test; a single broken block can make structured data unavailable to search engines.',
    uk: 'Перевірте JSON-LD JSON-парсером і Rich Results Test; один зламаний блок може зробити structured data недоступними для пошукових систем.',
  },

  'seo-struct-002.evidence': {
    en: 'JSON-LD blocks without both a non-empty @context and @type: {count}',
    uk: 'Блоків JSON-LD, яким бракує непорожніх @context і @type одночасно: {count}',
  },
  'seo-struct-002.recommendation': {
    en: 'Add a valid @context and @type to every JSON-LD object; the values should describe the entity visible on the page.',
    uk: 'Додайте до кожного JSON-LD-обʼєкта коректні @context і @type; значення мають описувати видиму сутність сторінки.',
  },

  'seo-social-001.evidence': {
    en: 'Missing social preview fields: {fields}',
    uk: 'Бракує полів social preview: {fields}',
  },
  'seo-social-001.recommendation': {
    en: 'Add unique Open Graph og:title, og:description, og:image, og:url and Twitter twitter:card tags; check that the URLs are absolute and preview the shared link.',
    uk: 'Додайте унікальні Open Graph og:title, og:description, og:image, og:url і Twitter twitter:card; перевірте, що URL абсолютні, і перегляньте попередній перегляд посилання.',
  },
} as const satisfies FindingMessageCatalog;
