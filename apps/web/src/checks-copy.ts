// Public audit-coverage content (/checks), kept out of `i18n.ts` for the same
// reason the FAQ is: it is a long technical document, and a wall of prose inside
// the shared translation file makes both harder to edit.
//
// Every locale builds its sections through `checksSections`, so a section that
// exists in one language and not the other is a type error rather than a page
// that quietly loses an anchor when the reader switches language.
//
// Two inline markers are allowed inside a paragraph or a bullet body:
// `code` renders as <code> and **strong** as <strong>. Anything else is text.

import { SUPPORT_EMAIL } from './brand';

export type ChecksSectionId =
  | 'how'
  | 'seo'
  | 'ai-seo'
  | 'security'
  | 'accessibility'
  | 'reliability'
  | 'privacy'
  | 'evidence'
  | 'limits';

/** Anchor and reading order, shared by every locale. */
const SECTION_ORDER: readonly ChecksSectionId[] = [
  'how',
  'seo',
  'ai-seo',
  'security',
  'accessibility',
  'reliability',
  'privacy',
  'evidence',
  'limits',
];

/** The index rule separates the modules from the two closing sections. */
export const CHECKS_INDEX_RULE_BEFORE: ChecksSectionId = 'evidence';

export interface ChecksBullet {
  /** The lead term, rendered in bold before the em dash. */
  readonly term: string;
  readonly body: string;
}

export interface ChecksSectionText {
  /** Short label used in the sidebar index. */
  readonly nav: string;
  /** Numbered kicker rendered above the section heading. */
  readonly label: string;
  readonly title: string;
  /** Paragraphs before the list. */
  readonly intro: readonly string[];
  readonly bullets: readonly ChecksBullet[];
  /** Paragraphs after the list. */
  readonly outro: readonly string[];
}

export interface ChecksSection extends ChecksSectionText {
  readonly id: ChecksSectionId;
}

export interface ChecksCopy {
  readonly kicker: string;
  readonly meta: readonly string[];
  readonly title: string;
  readonly lede: string;
  readonly back: string;
  readonly contents: string;
  readonly documentLabel: string;
  readonly noticeLabel: string;
  readonly notice: string;
  readonly noticeTag: string;
  readonly contact: string;
  readonly contactEmail: string;
  readonly footerBrand: string;
  readonly footerHome: string;
  readonly footerPrivacy: string;
  readonly footerTerms: string;
  readonly sections: readonly ChecksSection[];
}

function checksSections(
  sections: Record<ChecksSectionId, ChecksSectionText>,
): readonly ChecksSection[] {
  return SECTION_ORDER.map((id) => ({ id, ...sections[id] }));
}

export const checksCopyEn: ChecksCopy = {
  kicker: 'FLUXRADAR / PUBLIC WEB AUDIT STATION',
  meta: ['Updated 2026-09-05', 'No login required to read this', 'Ruleset v0.1'],
  title: 'Audit coverage',
  lede: 'Exactly what FluxRadar inspects, why, and what it cannot certify — with no customer credentials required for the core public audit.',
  back: '← Back to home',
  contents: 'CONTENTS',
  documentLabel: 'Audit coverage detail',
  noticeLabel: 'READ-ONLY AUDIT',
  notice:
    'FluxRadar fetches only public HTTP responses. No CMS login, SSH access, database credentials or source-code access is required or requested.',
  noticeTag: 'Applies to all scan tiers',
  contact: 'Questions about coverage or evidence:',
  contactEmail: SUPPORT_EMAIL,
  footerBrand: 'FLUXRADAR / BY FLUXLAB',
  footerHome: 'Home',
  footerPrivacy: 'Privacy policy',
  footerTerms: 'Terms of service',
  sections: checksSections({
    how: {
      nav: 'How it works',
      label: '00 / HOW IT WORKS',
      title: 'What the scanner does',
      intro: [
        'FluxRadar makes ordinary HTTP(S) requests to your public website — the same requests a browser or search-engine crawler would make — and records the responses. It does not guess, estimate or infer. Every finding traces back to a byte in a real HTTP response.',
        'The scanner respects `robots.txt` directives. For the free homepage check only the root URL is fetched. Paid scans extend coverage to linked public pages within the configured scope.',
      ],
      bullets: [],
      outro: [],
    },
    seo: {
      nav: 'SEO visibility',
      label: '01 / SEO VISIBILITY',
      title: 'SEO — what FluxRadar checks',
      intro: [
        'The SEO module runs up to **16 deterministic checks** derived from documented search-engine guidance (Google Search Central, Bing Webmaster Guidelines, schema.org). All checks are rule-based; no model inference is involved.',
      ],
      bullets: [
        {
          term: 'Title tag',
          body: 'presence, character length (≤ 60 chars recommended), uniqueness across crawled pages.',
        },
        {
          term: 'Meta description',
          body: 'presence and recommended length window (120–158 chars).',
        },
        {
          term: 'Heading hierarchy',
          body: 'a single H1, logical H2/H3 nesting with no skipped levels.',
        },
        {
          term: 'Canonical URL',
          body: '`<link rel="canonical">` present and self-referencing on canonical pages.',
        },
        {
          term: 'Indexing signals',
          body: '`noindex` / `nofollow` in meta robots and `X-Robots-Tag` headers.',
        },
        {
          term: 'robots.txt',
          body: 'reachable, parseable, does not inadvertently block the origin.',
        },
        { term: 'XML sitemap', body: 'declared in robots.txt, reachable, well-formed.' },
        {
          term: 'Structured data / JSON-LD',
          body: 'syntax validity, schema type detected, required properties present per schema.org spec. A JSON-LD preview is included in the report.',
        },
        {
          term: 'Open Graph tags',
          body: '`og:title`, `og:description`, `og:image` present and non-empty. Image URL is reachable (HTTP 200).',
        },
        {
          term: 'Twitter / X Card tags',
          body: '`twitter:card`, `twitter:title`, `twitter:image` present.',
        },
        {
          term: 'Hreflang',
          body: 'valid language codes, reciprocal links present where declared.',
        },
        { term: 'Image alt text', body: 'non-decorative images missing `alt` attributes.' },
        {
          term: 'Broken links',
          body: 'internal anchor `href` values returning 4xx/5xx within scope.',
        },
        {
          term: 'Redirect chains',
          body: '301/302 hops counted; chains longer than two hops flagged.',
        },
        {
          term: 'Page speed signals',
          body: 'server response time, uncompressed transfer size and HTTP/2 support as measurable proxies.',
        },
        {
          term: 'HTTPS enforcement',
          body: 'HTTP-to-HTTPS redirect present, no mixed content in the HTML source.',
        },
      ],
      outro: [],
    },
    'ai-seo': {
      nav: 'AI SEO / GEO',
      label: '02 / AI SEO / GEO',
      title: 'AI SEO / Generative Engine Optimisation',
      intro: [
        'AI search systems (ChatGPT, Gemini, Perplexity, Claude, Bing Copilot, etc.) use public web content and their own proprietary indexes. FluxRadar checks the publicly observable signals that influence whether your site is understood and cited by these systems.',
      ],
      bullets: [
        {
          term: 'AI crawler access',
          body: '`robots.txt` is parsed for known AI crawler user-agent strings (GPTBot, Claude-Web, PerplexityBot, GoogleOther, BingBot and others). The report shows which crawlers are allowed, disallowed or missing an explicit rule.',
        },
        {
          term: 'LLMs.txt',
          body: 'checks for the emerging `/llms.txt` convention, which signals AI-friendly content structure to language models.',
        },
        {
          term: 'Structured data for AI comprehension',
          body: 'JSON-LD types that help AI systems build entity graphs (Organization, Product, FAQPage, HowTo, Article, BreadcrumbList) are flagged when absent.',
        },
        {
          term: 'Content clarity signals',
          body: 'heading density, paragraph length distribution and readability score (Flesch-Kincaid) measured from the extracted main content.',
        },
        {
          term: 'Provider visibility (paid, disclosed before purchase)',
          body: "on a paid audit the AI SEO module puts the same questions to Claude (Anthropic) and ChatGPT (OpenAI), each answering with its own web search enabled, and checks whether the answers mention your brand or cite your site; the report lists the sources each model used. Gemini (Google) and Perplexity are an opt-in extra chosen before purchase and receive nothing otherwise. This never runs in the free homepage check. Provider API calls are subject to the providers' own terms.",
        },
      ],
      outro: [],
    },
    security: {
      nav: 'Security',
      label: '03 / SECURITY',
      title: 'Security — OWASP ASVS public profile',
      intro: [
        'FluxRadar checks the subset of **OWASP Application Security Verification Standard (ASVS) v4** signals that are observable in public HTTP responses. It does not attempt to exploit vulnerabilities, probe authenticated surfaces or run active attack techniques.',
      ],
      bullets: [
        {
          term: 'Transport security',
          body: 'TLS version (TLS 1.2+ required), HSTS header present with `max-age ≥ 31536000` and `includeSubDomains` flag. Maps to ASVS 9.1.',
        },
        {
          term: 'Security headers',
          body: '`Content-Security-Policy`, `X-Frame-Options` (or CSP `frame-ancestors`), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`. Maps to ASVS 14.4.',
        },
        {
          term: 'Cookie flags',
          body: 'cookies set on the homepage response are checked for `HttpOnly`, `Secure` and `SameSite` attributes. Maps to ASVS 3.4.',
        },
        {
          term: 'Information disclosure',
          body: 'server version strings in `Server` / `X-Powered-By` headers, verbose error messages in HTML, directory listing indicators. Maps to ASVS 14.3.',
        },
        {
          term: 'Mixed content',
          body: 'HTTP resources (scripts, stylesheets, images) embedded in an HTTPS page. Maps to ASVS 9.1.',
        },
        {
          term: 'Subresource Integrity',
          body: 'third-party `<script>` and `<link>` tags checked for `integrity` attribute presence. Maps to ASVS 14.2.',
        },
      ],
      outro: [
        'Findings are classified as signal present or signal absent — not as confirmed vulnerabilities. A missing header is evidence that a defensive control is not deployed, not proof that the site is exploitable.',
      ],
    },
    accessibility: {
      nav: 'Accessibility',
      label: '04 / ACCESSIBILITY',
      title: 'Accessibility — WCAG 2.2 AA / EN 301 549 / Section 508',
      intro: [
        'Automated DOM checks cover the machine-verifiable subset of **WCAG 2.2 Level AA**. WCAG 2.2 AA is a superset of the WCAG chapters referenced by **EN 301 549** (EU, chapter 9 references WCAG 2.1) and **Section 508** (US federal, incorporates WCAG 2.0 AA). Note that both standards include non-WCAG functional requirements that automated DOM scanning does not cover. Automated tools can verify approximately 30–40 % of WCAG criteria; the remaining criteria require human judgement or assistive-technology testing.',
      ],
      bullets: [
        {
          term: 'Perceivable (WCAG 2.2 Principle 1)',
          body: 'missing image alt text (1.1.1), colour-contrast ratio ≥ 4.5:1 for normal text and ≥ 3:1 for large text measured from computed CSS (1.4.3), absence of auto-playing media with audio (1.4.2).',
        },
        {
          term: 'Operable (WCAG 2.2 Principle 2)',
          body: 'interactive elements reachable by keyboard in source order (2.1.1), skip-navigation link present (2.4.1), page `<title>` descriptive (2.4.2), link purpose from text (2.4.4).',
        },
        {
          term: 'Understandable (WCAG 2.2 Principle 3)',
          body: '`<html lang>` attribute present and valid (3.1.1), form `<label>` elements properly associated (3.3.2), error identification markup (3.3.1).',
        },
        {
          term: 'Robust (WCAG 2.2 Principle 4)',
          body: 'valid HTML (4.1.1), ARIA roles and properties correctly applied (4.1.2), status messages using appropriate live regions (4.1.3).',
        },
      ],
      outro: [
        'Each accessibility finding includes the WCAG criterion reference, the failing element selector and the specific rule that was violated, so you can reproduce the finding without re-running the scan.',
        '**What automated checks cannot assess:** keyboard trap behaviour in dynamic widgets, screen-reader announcement quality, cognitive load, motion sensitivity in animations, or compliance with criteria that require understanding content meaning (e.g. 1.3.3 Sensory Characteristics).',
      ],
    },
    reliability: {
      nav: 'Reliability & performance',
      label: '05 / RELIABILITY & PERFORMANCE',
      title: 'Reliability and performance',
      intro: [
        "Performance signals are measured from a single-origin, single-request perspective. They reflect what FluxRadar's scanner observed at the time of the scan, not a statistical average across geographies or time.",
      ],
      bullets: [
        {
          term: 'Server response time (TTFB)',
          body: 'time to first byte recorded for each scanned URL. Flagged if consistently above 600 ms.',
        },
        {
          term: 'Transfer size',
          body: 'uncompressed HTML size and total page weight (HTML + linked CSS/JS within scope). Flagged if HTML exceeds 100 KB.',
        },
        {
          term: 'Compression',
          body: '`Content-Encoding: gzip` or `br` present on text responses.',
        },
        {
          term: 'HTTP/2 or HTTP/3',
          body: 'protocol version recorded; HTTP/1.1-only sites flagged.',
        },
        {
          term: 'Cache headers',
          body: '`Cache-Control` and `ETag` / `Last-Modified` presence on static assets.',
        },
        {
          term: 'Uptime signal',
          body: 'HTTP status recorded for every URL in scope. 5xx responses and connection timeouts are flagged as reliability issues.',
        },
        {
          term: 'Redirect economy',
          body: 'total redirect hops from the canonical entry URL; each hop adds latency for real users and crawlers.',
        },
      ],
      outro: [],
    },
    privacy: {
      nav: 'Privacy & consent',
      label: '06 / PRIVACY & CONSENT',
      title: 'Privacy and consent signals',
      intro: [
        'FluxRadar reads publicly visible consent and tracking signals. It does not install tracking code, set cookies on behalf of the target site, or interact with third-party consent infrastructure beyond reading what is embedded in the page.',
      ],
      bullets: [
        {
          term: 'Cookie consent banner detection',
          body: 'common consent-management platform (CMP) signatures detected in HTML and script sources (OneTrust, Cookiebot, CookieYes, Osano and others). Absence flagged when cookies are set on first load.',
        },
        {
          term: 'Third-party script audit',
          body: 'external script domains classified against a known-tracker list (analytics, advertising, fingerprinting). Count and domains listed in the report.',
        },
        {
          term: 'Privacy policy link',
          body: 'a link whose text or destination suggests a privacy or cookie policy is present in the page or footer.',
        },
        {
          term: 'Do Not Track / GPC signal support',
          body: 'whether the site sets `Sec-GPC` acknowledgement headers or publishes a GPC support statement.',
        },
        {
          term: 'Cookie first-load audit',
          body: 'cookies set before any user interaction are recorded. Cookies with no `SameSite` attribute or marked as cross-site are highlighted.',
        },
      ],
      outro: [],
    },
    evidence: {
      nav: 'Evidence',
      label: '07 / EVIDENCE',
      title: 'How findings are evidenced',
      intro: ['Every issue in the Issue Center includes:'],
      bullets: [
        { term: 'The URL', body: 'the page on which the finding was observed.' },
        {
          term: 'The trigger',
          body: 'the specific HTTP response field (header name, HTML selector or attribute) that triggered the rule.',
        },
        {
          term: 'The observed value',
          body: 'the actual value observed, truncated for display; the full value is in the JSON export.',
        },
        { term: 'The rule', body: 'the rule ID and the standard or guideline it maps to.' },
        { term: 'The next step', body: 'a recommended remediation step.' },
      ],
      outro: [
        'The JSON and CSV export (Complete plan) contains the full raw evidence for every finding so you can reproduce the check independently.',
      ],
    },
    limits: {
      nav: 'What we cannot certify',
      label: '08 / LIMITATIONS',
      title: 'What FluxRadar cannot certify',
      intro: ['FluxRadar is a public-signal audit tool. There are important things it cannot do:'],
      bullets: [
        {
          term: 'It cannot certify WCAG conformance.',
          body: 'Automated checks cover roughly one-third of WCAG criteria. A passing accessibility score does not mean your site is fully accessible or legally compliant.',
        },
        {
          term: 'It cannot certify ASVS compliance.',
          body: 'Security findings reflect the observable public surface only. Authenticated pages, server-side logic, database access, dependency vulnerabilities and infrastructure configuration are outside scope.',
        },
        {
          term: 'It cannot certify GDPR, ePrivacy or CCPA compliance.',
          body: 'Privacy signals indicate whether common mechanisms are present; they do not constitute a legal assessment of data processing lawfulness.',
        },
        {
          term: 'It does not run active security tests.',
          body: 'No fuzzing, injection attempts, brute-force probing or credential stuffing is performed.',
        },
        {
          term: 'Results are a point-in-time snapshot.',
          body: 'A scan reflects what was publicly visible when the scan ran. Dynamic content, A/B tests and CDN edge variance may produce different results for a simultaneous browser visit.',
        },
        {
          term: 'It does not access authenticated or paywalled content.',
          body: 'The audit covers only URLs reachable by an unauthenticated HTTP client.',
        },
        {
          term: 'AI SEO provider visibility is optional and not guaranteed.',
          body: 'AI provider APIs change frequently; provider-visibility checks reflect API responses at scan time and may not represent end-user query behaviour.',
        },
      ],
      outro: [],
    },
  }),
};

export const checksCopyUk: ChecksCopy = {
  kicker: 'FLUXRADAR / СТАНЦІЯ АУДИТУ ПУБЛІЧНИХ САЙТІВ',
  meta: ['Оновлено 2026-09-05', 'Читати можна без входу', 'Набір правил v0.1'],
  title: 'Обсяг аудиту',
  lede: 'Що саме перевіряє FluxRadar, навіщо і чого він не сертифікує — для основного публічного аудиту облікові дані клієнта не потрібні.',
  back: '← Назад на головну',
  contents: 'ЗМІСТ',
  documentLabel: 'Деталі обсягу аудиту',
  noticeLabel: 'ЛИШЕ ЧИТАННЯ',
  notice:
    'FluxRadar завантажує лише публічні HTTP-відповіді. Вхід у CMS, доступ по SSH, дані до бази чи вихідний код не потрібні й не запитуються.',
  noticeTag: 'Стосується всіх тарифів',
  contact: 'Питання про обсяг або докази:',
  contactEmail: SUPPORT_EMAIL,
  footerBrand: 'FLUXRADAR / ВІД FLUXLAB',
  footerHome: 'Головна',
  footerPrivacy: 'Політика приватності',
  footerTerms: 'Умови користування',
  sections: checksSections({
    how: {
      nav: 'Як це працює',
      label: '00 / ЯК ЦЕ ПРАЦЮЄ',
      title: 'Що робить сканер',
      intro: [
        'FluxRadar робить звичайні HTTP(S)-запити до вашого публічного сайту — такі самі, як браузер або пошуковий робот — і записує відповіді. Він не вгадує, не оцінює приблизно й не додумує. Кожна знахідка спирається на конкретний байт справжньої HTTP-відповіді.',
        'Сканер дотримується директив `robots.txt`. Для безкоштовної перевірки головної сторінки завантажується лише кореневий URL. Платні перевірки поширюються на повʼязані публічні сторінки в межах налаштованої області.',
      ],
      bullets: [],
      outro: [],
    },
    seo: {
      nav: 'Видимість у пошуку',
      label: '01 / ВИДИМІСТЬ У ПОШУКУ',
      title: 'SEO — що перевіряє FluxRadar',
      intro: [
        'Модуль SEO виконує до **16 детермінованих перевірок**, складених за документованими рекомендаціями пошукових систем (Google Search Central, Bing Webmaster Guidelines, schema.org). Усі перевірки засновані на правилах; жодного висновку моделі тут немає.',
      ],
      bullets: [
        {
          term: 'Тег title',
          body: 'наявність, довжина (рекомендовано ≤ 60 символів), унікальність серед обійдених сторінок.',
        },
        {
          term: 'Meta description',
          body: 'наявність і рекомендований діапазон довжини (120–158 символів).',
        },
        {
          term: 'Ієрархія заголовків',
          body: 'один H1, логічна вкладеність H2/H3 без пропущених рівнів.',
        },
        {
          term: 'Канонічний URL',
          body: '`<link rel="canonical">` присутній і вказує сам на себе на канонічних сторінках.',
        },
        {
          term: 'Сигнали індексації',
          body: '`noindex` / `nofollow` у meta robots і заголовках `X-Robots-Tag`.',
        },
        {
          term: 'robots.txt',
          body: 'доступний, коректно розбирається, не блокує сайт випадково.',
        },
        {
          term: 'XML-мапа сайту',
          body: 'оголошена в robots.txt, доступна, коректно сформована.',
        },
        {
          term: 'Структуровані дані / JSON-LD',
          body: 'коректність синтаксису, виявлений тип схеми, наявність обовʼязкових властивостей за специфікацією schema.org. У звіті є попередній перегляд JSON-LD.',
        },
        {
          term: 'Теги Open Graph',
          body: '`og:title`, `og:description`, `og:image` присутні й не порожні. URL зображення доступний (HTTP 200).',
        },
        {
          term: 'Теги Twitter / X Card',
          body: '`twitter:card`, `twitter:title`, `twitter:image` присутні.',
        },
        {
          term: 'Hreflang',
          body: 'коректні коди мов, взаємні посилання там, де вони оголошені.',
        },
        {
          term: 'Alt-текст зображень',
          body: 'недекоративні зображення без атрибута `alt`.',
        },
        {
          term: 'Биті посилання',
          body: 'внутрішні `href`, що повертають 4xx/5xx у межах області перевірки.',
        },
        {
          term: 'Ланцюжки редиректів',
          body: 'підраховуються переходи 301/302; ланцюжки довші за два кроки позначаються.',
        },
        {
          term: 'Сигнали швидкості',
          body: 'час відповіді сервера, нестиснений обсяг передачі та підтримка HTTP/2 як вимірювані показники.',
        },
        {
          term: 'Примусовий HTTPS',
          body: 'наявний редирект з HTTP на HTTPS, немає змішаного контенту у вихідному HTML.',
        },
      ],
      outro: [],
    },
    'ai-seo': {
      nav: 'AI SEO / GEO',
      label: '02 / AI SEO / GEO',
      title: 'AI SEO / Generative Engine Optimisation',
      intro: [
        'AI-системи пошуку (ChatGPT, Gemini, Perplexity, Claude, Bing Copilot тощо) використовують публічний вміст вебу та власні індекси. FluxRadar перевіряє публічно спостережувані сигнали, які впливають на те, чи зрозуміють і чи процитують ваш сайт такі системи.',
      ],
      bullets: [
        {
          term: 'Доступ AI-краулерів',
          body: '`robots.txt` розбирається на відомі user-agent AI-краулерів (GPTBot, Claude-Web, PerplexityBot, GoogleOther, BingBot та інші). Звіт показує, яким краулерам дозволено, заборонено або не задано явного правила.',
        },
        {
          term: 'LLMs.txt',
          body: 'перевірка нової угоди `/llms.txt`, яка сигналізує мовним моделям про зручну для AI структуру вмісту.',
        },
        {
          term: 'Структуровані дані для розуміння AI',
          body: 'типи JSON-LD, що допомагають AI-системам будувати графи сутностей (Organization, Product, FAQPage, HowTo, Article, BreadcrumbList), позначаються, коли їх немає.',
        },
        {
          term: 'Сигнали ясності тексту',
          body: 'щільність заголовків, розподіл довжини абзаців і оцінка читабельності (Flesch-Kincaid), виміряні на видобутому основному вмісті.',
        },
        {
          term: 'Видимість у провайдерів (платно, із повідомленням перед оплатою)',
          body: 'у платному аудиті модуль AI SEO ставить ті самі запитання Claude (Anthropic) і ChatGPT (OpenAI), кожен відповідає з увімкненим власним вебпошуком, і перевіряє, чи згадують відповіді ваш бренд і чи цитують сайт; звіт показує джерела, якими скористалася кожна модель. Gemini (Google) і Perplexity — необовʼязковий вибір перед оплатою, інакше вони не отримують нічого. У безкоштовній перевірці головної сторінки цей крок не виконується ніколи. Запити до API провайдерів підпорядковані їхнім власним умовам.',
        },
      ],
      outro: [],
    },
    security: {
      nav: 'Безпека',
      label: '03 / БЕЗПЕКА',
      title: 'Безпека — публічний профіль OWASP ASVS',
      intro: [
        'FluxRadar перевіряє ту частину сигналів **OWASP Application Security Verification Standard (ASVS) v4**, яку видно в публічних HTTP-відповідях. Він не намагається експлуатувати вразливості, досліджувати захищені входом поверхні чи виконувати активні атаки.',
      ],
      bullets: [
        {
          term: 'Безпека транспорту',
          body: 'версія TLS (потрібна TLS 1.2+), заголовок HSTS із `max-age ≥ 31536000` та прапорцем `includeSubDomains`. Відповідає ASVS 9.1.',
        },
        {
          term: 'Заголовки безпеки',
          body: '`Content-Security-Policy`, `X-Frame-Options` (або `frame-ancestors` у CSP), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`. Відповідає ASVS 14.4.',
        },
        {
          term: 'Прапорці cookie',
          body: 'cookie, встановлені у відповіді головної сторінки, перевіряються на `HttpOnly`, `Secure` і `SameSite`. Відповідає ASVS 3.4.',
        },
        {
          term: 'Розкриття інформації',
          body: 'версії сервера в заголовках `Server` / `X-Powered-By`, докладні повідомлення про помилки в HTML, ознаки лістингу каталогів. Відповідає ASVS 14.3.',
        },
        {
          term: 'Змішаний контент',
          body: 'HTTP-ресурси (скрипти, стилі, зображення), вбудовані в HTTPS-сторінку. Відповідає ASVS 9.1.',
        },
        {
          term: 'Subresource Integrity',
          body: 'сторонні теги `<script>` і `<link>` перевіряються на наявність атрибута `integrity`. Відповідає ASVS 14.2.',
        },
      ],
      outro: [
        'Знахідки класифікуються як сигнал присутній або сигнал відсутній — а не як підтверджені вразливості. Відсутній заголовок є доказом того, що захисний механізм не розгорнуто, а не доказом того, що сайт можна зламати.',
      ],
    },
    accessibility: {
      nav: 'Доступність',
      label: '04 / ДОСТУПНІСТЬ',
      title: 'Доступність — WCAG 2.2 AA / EN 301 549 / Section 508',
      intro: [
        'Автоматичні перевірки DOM охоплюють ту частину **WCAG 2.2 рівня AA**, яку можна перевірити машинно. WCAG 2.2 AA є надмножиною розділів WCAG, на які посилаються **EN 301 549** (ЄС, розділ 9 посилається на WCAG 2.1) і **Section 508** (США, включає WCAG 2.0 AA). Зверніть увагу: обидва стандарти містять функціональні вимоги поза WCAG, які автоматичне сканування DOM не покриває. Автоматичні інструменти перевіряють приблизно 30–40 % критеріїв WCAG; решта потребує людської оцінки або тестування з допоміжними технологіями.',
      ],
      bullets: [
        {
          term: 'Сприйнятність (WCAG 2.2, принцип 1)',
          body: 'відсутній alt-текст зображень (1.1.1), контраст кольору ≥ 4.5:1 для звичайного тексту та ≥ 3:1 для великого, виміряний за обчисленим CSS (1.4.3), відсутність медіа з автовідтворенням звуку (1.4.2).',
        },
        {
          term: 'Керованість (WCAG 2.2, принцип 2)',
          body: 'інтерактивні елементи доступні з клавіатури в порядку коду (2.1.1), наявне посилання «пропустити навігацію» (2.4.1), змістовний `<title>` сторінки (2.4.2), зрозуміла мета посилання з його тексту (2.4.4).',
        },
        {
          term: 'Зрозумілість (WCAG 2.2, принцип 3)',
          body: 'атрибут `<html lang>` присутній і коректний (3.1.1), елементи `<label>` форм правильно повʼязані (3.3.2), розмітка ідентифікації помилок (3.3.1).',
        },
        {
          term: 'Надійність (WCAG 2.2, принцип 4)',
          body: 'валідний HTML (4.1.1), коректно застосовані ролі та властивості ARIA (4.1.2), повідомлення про стан у відповідних live-регіонах (4.1.3).',
        },
      ],
      outro: [
        'Кожна знахідка з доступності містить посилання на критерій WCAG, селектор проблемного елемента та конкретне порушене правило, тож перевірку можна відтворити без повторного запуску сканування.',
        '**Чого автоматичні перевірки оцінити не можуть:** пастки фокусу в динамічних віджетах, якість озвучення екранним читачем, когнітивне навантаження, чутливість до руху в анімаціях або відповідність критеріям, що потребують розуміння змісту (наприклад, 1.3.3 Sensory Characteristics).',
      ],
    },
    reliability: {
      nav: 'Надійність і швидкість',
      label: '05 / НАДІЙНІСТЬ І ШВИДКІСТЬ',
      title: 'Надійність і продуктивність',
      intro: [
        'Сигнали продуктивності вимірюються з погляду одного джерела та одного запиту. Вони відображають те, що сканер FluxRadar побачив під час перевірки, а не статистичне середнє за регіонами чи часом.',
      ],
      bullets: [
        {
          term: 'Час відповіді сервера (TTFB)',
          body: 'час до першого байта, записаний для кожного перевіреного URL. Позначається, якщо стабільно перевищує 600 мс.',
        },
        {
          term: 'Обсяг передачі',
          body: 'нестиснений розмір HTML і загальна вага сторінки (HTML + повʼязані CSS/JS у межах області). Позначається, якщо HTML перевищує 100 КБ.',
        },
        {
          term: 'Стиснення',
          body: '`Content-Encoding: gzip` або `br` у текстових відповідях.',
        },
        {
          term: 'HTTP/2 або HTTP/3',
          body: 'записується версія протоколу; сайти лише з HTTP/1.1 позначаються.',
        },
        {
          term: 'Заголовки кешування',
          body: 'наявність `Cache-Control` і `ETag` / `Last-Modified` на статичних ресурсах.',
        },
        {
          term: 'Сигнал доступності',
          body: 'HTTP-статус записується для кожного URL в області. Відповіді 5xx і таймаути зʼєднання позначаються як проблеми надійності.',
        },
        {
          term: 'Економія редиректів',
          body: 'загальна кількість переходів від канонічного вхідного URL; кожен перехід додає затримку і для людей, і для краулерів.',
        },
      ],
      outro: [],
    },
    privacy: {
      nav: 'Приватність і згода',
      label: '06 / ПРИВАТНІСТЬ І ЗГОДА',
      title: 'Сигнали приватності та згоди',
      intro: [
        'FluxRadar читає публічно видимі сигнали згоди та відстеження. Він не встановлює код відстеження, не ставить cookie від імені перевіреного сайту й не взаємодіє зі сторонньою інфраструктурою згоди поза читанням того, що вбудовано у сторінку.',
      ],
      bullets: [
        {
          term: 'Виявлення банера згоди на cookie',
          body: 'у HTML і джерелах скриптів шукаються сигнатури поширених платформ керування згодою (OneTrust, Cookiebot, CookieYes, Osano та інші). Відсутність позначається, якщо cookie ставляться вже при першому завантаженні.',
        },
        {
          term: 'Аудит сторонніх скриптів',
          body: 'домени зовнішніх скриптів звіряються зі списком відомих трекерів (аналітика, реклама, фінгерпринтинг). Кількість і домени наводяться у звіті.',
        },
        {
          term: 'Посилання на політику приватності',
          body: 'на сторінці або у футері є посилання, текст чи адреса якого вказують на політику приватності або cookie.',
        },
        {
          term: 'Підтримка Do Not Track / GPC',
          body: 'чи надсилає сайт заголовки підтвердження `Sec-GPC` або публікує заяву про підтримку GPC.',
        },
        {
          term: 'Аудит cookie при першому завантаженні',
          body: 'записуються cookie, встановлені до будь-якої дії користувача. Cookie без атрибута `SameSite` або позначені як міжсайтові виділяються окремо.',
        },
      ],
      outro: [],
    },
    evidence: {
      nav: 'Докази',
      label: '07 / ДОКАЗИ',
      title: 'Як підтверджується кожна знахідка',
      intro: ['Кожна проблема в Issue Center містить:'],
      bullets: [
        { term: 'URL', body: 'сторінку, на якій знахідку зафіксовано.' },
        {
          term: 'Що спрацювало',
          body: 'конкретне поле HTTP-відповіді (назва заголовка, HTML-селектор або атрибут), яке активувало правило.',
        },
        {
          term: 'Побачене значення',
          body: 'фактичне значення, скорочене для показу; повне є в експорті JSON.',
        },
        {
          term: 'Правило',
          body: 'ідентифікатор правила та стандарт чи рекомендацію, до яких воно належить.',
        },
        { term: 'Наступний крок', body: 'рекомендована дія для виправлення.' },
      ],
      outro: [
        'Експорт JSON і CSV (тариф Complete) містить повні сирі докази для кожної знахідки, тож перевірку можна відтворити самостійно.',
      ],
    },
    limits: {
      nav: 'Чого ми не сертифікуємо',
      label: '08 / ОБМЕЖЕННЯ',
      title: 'Чого FluxRadar не сертифікує',
      intro: [
        'FluxRadar — інструмент аудиту публічних сигналів. Є важливі речі, яких він робити не може:',
      ],
      bullets: [
        {
          term: 'Він не сертифікує відповідність WCAG.',
          body: 'Автоматичні перевірки охоплюють приблизно третину критеріїв WCAG. Висока оцінка доступності не означає, що сайт повністю доступний або відповідає закону.',
        },
        {
          term: 'Він не сертифікує відповідність ASVS.',
          body: 'Знахідки з безпеки стосуються лише спостережуваної публічної поверхні. Сторінки за входом, серверна логіка, доступ до бази даних, вразливості залежностей і конфігурація інфраструктури поза межами перевірки.',
        },
        {
          term: 'Він не сертифікує відповідність GDPR, ePrivacy чи CCPA.',
          body: 'Сигнали приватності показують, чи присутні поширені механізми; вони не є юридичною оцінкою законності обробки даних.',
        },
        {
          term: 'Він не виконує активних тестів безпеки.',
          body: 'Жодного фазингу, спроб інʼєкцій, перебору чи підстановки облікових даних не виконується.',
        },
        {
          term: 'Результат — знімок на момент часу.',
          body: 'Перевірка відображає те, що було публічно видно під час її запуску. Динамічний вміст, A/B-тести та відмінності між вузлами CDN можуть дати інший результат при одночасному відкритті в браузері.',
        },
        {
          term: 'Він не отримує доступу до контенту за входом чи платною стіною.',
          body: 'Аудит охоплює лише URL, доступні неавтентифікованому HTTP-клієнту.',
        },
        {
          term: 'Видимість у провайдерів AI — опційна й не гарантована.',
          body: 'API провайдерів AI часто змінюються; перевірка видимості відображає відповіді API на момент перевірки й може не відповідати поведінці реальних запитів користувачів.',
        },
      ],
      outro: [],
    },
  }),
};
