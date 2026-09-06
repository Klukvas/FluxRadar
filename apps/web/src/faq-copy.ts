import { BASIC_PRICE, COMPLETE_PRICE } from './tariff-prices';

// Public FAQ content, kept out of `i18n.ts` so the answer copy can grow without
// turning the shared translation file into a wall of prose. Every locale builds
// its sections through `faqSections`, so a missing translated section is a type
// error rather than a page that silently loses an anchor in one language.

export type FaqSectionId =
  | 'basics'
  | 'workflow'
  | 'seo'
  | 'ai'
  | 'security'
  | 'accessibility'
  | 'structured-data'
  | 'privacy'
  | 'performance'
  | 'data-sources'
  | 'buying'
  | 'limits';

/** Anchor and reading order, shared by every locale. */
const SECTION_ORDER: readonly FaqSectionId[] = [
  'basics',
  'workflow',
  'seo',
  'ai',
  'security',
  'accessibility',
  'structured-data',
  'privacy',
  'performance',
  'data-sources',
  'buying',
  'limits',
];

export interface FaqEntry {
  readonly question: string;
  /** One paragraph per string; lists stay prose so translations cannot drift. */
  readonly answer: readonly string[];
}

export interface FaqSectionText {
  /** Short label used in the sidebar index. */
  readonly nav: string;
  /** Numbered kicker rendered above the section heading. */
  readonly label: string;
  readonly title: string;
  readonly entries: readonly FaqEntry[];
}

export interface FaqSection extends FaqSectionText {
  readonly id: FaqSectionId;
}

export interface FaqCopy {
  readonly documentTitle: string;
  readonly kicker: string;
  readonly meta: readonly string[];
  readonly title: string;
  readonly lede: string;
  readonly back: string;
  readonly contents: string;
  readonly noticeLabel: string;
  readonly notice: string;
  readonly noticeTag: string;
  readonly sections: readonly FaqSection[];
  readonly contact: string;
  readonly contactEmail: string;
  readonly footerBrand: string;
  readonly footerHome: string;
  readonly footerCoverage: string;
  readonly footerPrivacy: string;
  readonly footerTerms: string;
}

function faqSections(sections: Record<FaqSectionId, FaqSectionText>): readonly FaqSection[] {
  return SECTION_ORDER.map((id) => ({ id, ...sections[id] }));
}

export const faqCopyEn: FaqCopy = {
  documentTitle: 'FAQ — FluxRadar',
  kicker: 'FLUXRADAR / FREQUENTLY ASKED QUESTIONS',
  meta: ['Updated 2026-09-06', 'No account needed to read this', 'Ruleset v0.1'],
  title: 'Every check, explained in plain language',
  lede: 'What each FluxRadar check looks at, what the report can prove, and where the honest limits are. Written for site owners, not only for engineers.',
  back: '← Back to home',
  contents: 'CONTENTS',
  noticeLabel: 'READ-ONLY AUDIT',
  notice:
    'FluxRadar only makes ordinary public requests to your website, the same ones a browser or a search engine makes. It never needs a CMS password, SSH access, database credentials or your source code.',
  noticeTag: 'Applies to every scan',
  contact: 'Question that is not answered here? Write to',
  contactEmail: 'pavlenkoandrey56@gmail.com',
  footerBrand: 'FLUXRADAR / BY FLUXLAB',
  footerHome: 'Home',
  footerCoverage: 'Audit coverage',
  footerPrivacy: 'Privacy policy',
  footerTerms: 'Terms of service',
  sections: faqSections({
    basics: {
      nav: 'Start here',
      label: '00 / START HERE',
      title: 'What FluxRadar is',
      entries: [
        {
          question: 'What does FluxRadar actually do?',
          answer: [
            'You give it the address of a public website. It requests the pages the way a visitor or a search-engine crawler would, records what came back, and turns that into one report: how findable the site is, how machine-readable it is for AI systems, and which technical problems are worth fixing first.',
            'Nothing is guessed. Every finding points at something that was really in an HTTP response — a header, a tag, an attribute, a status code — so you can re-check it yourself.',
          ],
        },
        {
          question: 'Do I have to give FluxRadar access to my site?',
          answer: [
            'No. There is no plugin to install, no CMS user to create and no code to paste into your pages. FluxRadar reads only what is already public, and it follows the rules in your robots.txt.',
            'That is also the boundary: anything behind a login, a paywall or an internal network is invisible to the audit, and nothing on your site is modified.',
          ],
        },
        {
          question: 'What do I get at the end?',
          answer: [
            'A report per scan: a score and coverage state for each module, and a list of findings. Each finding carries the URL it was seen on, the exact element or header that triggered it, the value that was observed, the rule it maps to and a suggested fix.',
            'Coverage is shown honestly. If a module could not be checked, the report says so instead of quietly scoring it as a pass.',
          ],
        },
      ],
    },
    workflow: {
      nav: 'Profiles, scans, reports',
      label: '01 / WORKFLOW',
      title: 'Profiles, scans and reports',
      entries: [
        {
          question: 'What is a profile?',
          answer: [
            'A profile is a website you saved: its public address plus a name you recognise. It keeps the audit history for that site in one place, so a later scan can be compared with an earlier one.',
            'Saving a profile does not start a scan and does not charge you. It is only the bookmark the workspace works from.',
          ],
        },
        {
          question: 'How do I run a scan?',
          answer: [
            'Open Scan, pick one of your profiles, choose Basic or Complete, review the crawl scope (how many pages, how deep, which paths to include or exclude, whether to follow robots.txt) and press start. Nothing runs until you press it.',
            'A paid scan begins only after the payment provider confirms the payment on our server. Closing the tab in the middle does not cancel it.',
          ],
        },
        {
          question: 'Where do reports live and how long do they stay?',
          answer: [
            'Finished and in-progress scans are in Reports. A report is a snapshot of a moment: a site that changes after the scan will not match it, which is why every finding records what was seen and when.',
            'Basic results are kept for 30 days; Complete results are kept for 365 days.',
          ],
        },
        {
          question: 'Can a scan slow down or break my website?',
          answer: [
            'A scan only reads pages, so it cannot change or delete anything. It does add traffic, which is what the crawl scope is for: the page limit, the depth limit and the include and exclude patterns keep a scan proportionate to the site.',
            'By default robots.txt is respected. Overriding it is a deliberate, separate confirmation, and you should only do it for a site you are responsible for.',
          ],
        },
      ],
    },
    seo: {
      nav: 'SEO',
      label: '02 / SEO',
      title: 'SEO — being found by search engines',
      entries: [
        {
          question: 'What does the SEO check look at?',
          answer: [
            'Sixteen rule-based checks, split between the technical side and the page side. Technical: robots.txt, the XML sitemap, HTTP status codes, canonical tags, redirect chains, broken internal links, duplicate URLs, noindex signals and mixed content on HTTPS pages.',
            'On the page: the title, the meta description, the heading structure, image alt text, JSON-LD structured data (both its syntax and whether the required properties are there) and the social preview tags.',
            'These are deterministic rules, not opinions: the same page produces the same findings every time.',
          ],
        },
        {
          question: 'Will it tell me my keyword rankings or traffic?',
          answer: [
            'Not from a scan. Positions, impressions, clicks and queries are data only the search engine has. FluxRadar can show them next to your report when you connect Google Search Console or Bing Webmaster Tools yourself, which is optional.',
            'Without that connection the report is about how well the site is built for search, not about how it currently performs in search.',
          ],
        },
      ],
    },
    ai: {
      nav: 'AI SEO / AI crawlers',
      label: '03 / AI SEO / GEO',
      title: 'AI SEO — being usable by AI systems',
      entries: [
        {
          question: 'What does AI SEO mean here?',
          answer: [
            'Two practical things. First, whether AI crawlers are allowed to fetch your pages at all: your robots.txt is parsed for the known agents — GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended and Bytespider — and each is reported as allowed, blocked or simply not mentioned.',
            'Second, whether a machine that does fetch a page can understand it: is there real extractable text rather than an empty shell, is there structured data describing what the page is about, and is there a social preview so a shared link is not blank.',
          ],
        },
        {
          question: 'Do you check whether ChatGPT or Perplexity mention my brand?',
          answer: [
            'Only as an optional extra, and only if you switch it on for that scan. That step sends public page content to an external AI provider, so it is consent-gated in the scan settings and it is never part of the free homepage check.',
            'It is also not a ranking guarantee. It reflects what a provider answered at that moment through its API; the same question can be answered differently tomorrow.',
          ],
        },
        {
          question: 'Should I block AI crawlers?',
          answer: [
            'FluxRadar does not decide that for you — it reports the current state so the choice is deliberate. Blocking protects content from being ingested; allowing makes it possible to be quoted and linked by AI answers.',
            'The useful part is catching the accidental case: a rule copied from another site that blocks crawlers you actually wanted.',
          ],
        },
      ],
    },
    security: {
      nav: 'Security / OWASP ASVS',
      label: '04 / SECURITY',
      title: 'Security — the public OWASP ASVS profile',
      entries: [
        {
          question: 'What kind of security testing is this?',
          answer: [
            'Passive, evidence-based and entirely non-invasive. FluxRadar reads the responses your site already returns and checks the defensive controls that are visible there: the security headers, HSTS, Content-Security-Policy, Permissions-Policy, CORS configuration and the flags on cookies set on a public page.',
            'These map to the parts of the OWASP Application Security Verification Standard that can be verified from outside without touching an account.',
          ],
        },
        {
          question: 'Do you try to hack the site?',
          answer: [
            'No. There is no fuzzing, no injection attempt, no brute forcing and no probing of login flows. If that is what you need, you need a penetration test, which is a different exercise with a signed scope.',
            'A missing header is reported as a control that is not deployed, not as a proven vulnerability.',
          ],
        },
        {
          question: 'Is a good security score a certificate?',
          answer: [
            'No. It says the public surface looks correctly configured. Authenticated areas, server-side logic, database access, dependency vulnerabilities and infrastructure are outside what any public scan can see, and FluxRadar does not claim ASVS compliance on your behalf.',
          ],
        },
      ],
    },
    accessibility: {
      nav: 'Accessibility / WCAG',
      label: '05 / ACCESSIBILITY',
      title: 'Accessibility — WCAG 2.2, EN 301 549, Section 508',
      entries: [
        {
          question: 'Which standard is checked?',
          answer: [
            'The automated, machine-verifiable part of WCAG 2.2 Level AA. That matters for two other rules you may be asked about: EN 301 549 (the European public-sector requirement) and Section 508 (US federal) both build on WCAG, so the same findings are the starting point for either — though both standards also contain requirements that no DOM scanner can test.',
          ],
        },
        {
          question: 'What is actually tested?',
          answer: [
            'Colour contrast, image alternative text, document and heading structure, form labels, keyboard reachability, a visible focus indicator, ARIA usage, accessible names for buttons and links, and error messages on forms. Each finding names the criterion and the failing element, so a developer can go straight to it.',
            'The module also reports its own transparency: which pages were assessed and where evidence was thin, so the score is not read as broader than it is.',
          ],
        },
        {
          question: 'Can I use this report as proof of compliance?',
          answer: [
            'No, and no automated tool can honestly offer that. Roughly a third of WCAG criteria are machine-checkable; the rest need human judgement and assistive-technology testing — keyboard traps in custom widgets, whether a screen reader announces something sensibly, whether alt text is actually meaningful.',
            'Use it to remove the mechanical failures first, then have a person test what is left.',
          ],
        },
      ],
    },
    'structured-data': {
      nav: 'Structured data & previews',
      label: '06 / STRUCTURED DATA',
      title: 'Structured data and social previews',
      entries: [
        {
          question: 'What is structured data and why does it get its own check?',
          answer: [
            'Structured data is a small machine-readable block (JSON-LD) that states plainly what a page is: an article, a product, an organisation, a FAQ. Search engines and AI systems use it to be sure instead of guessing from the text.',
            'FluxRadar checks two separate things: that the block is syntactically valid, and that it is complete — a product without a price or an article without a headline is technically valid and practically useless.',
          ],
        },
        {
          question: 'What is the social preview check?',
          answer: [
            'It looks for the Open Graph and card tags that decide what appears when someone shares your link in a chat or on a social platform: title, description and image. When they are missing, the link shows up as bare text and loses most of its click-through.',
          ],
        },
      ],
    },
    privacy: {
      nav: 'Privacy & consent',
      label: '07 / PRIVACY',
      title: 'Privacy and consent signals',
      entries: [
        {
          question: 'What privacy signals are read?',
          answer: [
            'Which cookies are set on a first visit and what attributes they carry, whether a consent mechanism is present at all, which third-party scripts the page loads (analytics, advertising and other trackers), and whether a privacy or cookie policy is actually findable from the page.',
            'FluxRadar only reads what the page already does. It does not click a banner, accept anything on your behalf or install tracking of its own.',
          ],
        },
        {
          question: 'Is this a GDPR audit?',
          answer: [
            'No. It shows whether the usual mechanisms are present and what is loading before consent — useful evidence, and often the first sign of a problem. Whether your processing is lawful is a legal assessment of your business, not something a scanner can determine.',
          ],
        },
      ],
    },
    performance: {
      nav: 'Performance & reliability',
      label: '08 / PERFORMANCE',
      title: 'Performance, Core Web Vitals and reliability',
      entries: [
        {
          question: 'Do you measure Core Web Vitals?',
          answer: [
            'Not from our own crawler, and it is worth being precise about why. LCP, INP and CLS describe what a real browser experiences while rendering — our scanner reads HTTP responses, so measuring them itself would be an estimate dressed up as data.',
            'Instead FluxRadar reads them from Google where that source is available to the platform: lab metrics from PageSpeed Insights and field metrics (the 75th percentile of real Chrome users) from the Chrome UX Report. When that source is not configured, the Performance module is reported as unavailable rather than filled in with a guess.',
          ],
        },
        {
          question: 'What does the scan measure on its own?',
          answer: [
            'Reliability signals it can observe directly: whether every URL in scope actually responded, which ones returned server errors, and how long the server took to respond. Where API endpoints are part of the scope, it also checks that they answer with the expected status and do not require credentials that should not be public.',
            'These are the failures that quietly cost you traffic — a dead page, an intermittent 500, an origin that takes seconds to answer.',
          ],
        },
      ],
    },
    'data-sources': {
      nav: 'Public vs connected data',
      label: '09 / DATA SOURCES',
      title: 'What is public, and what needs a connection',
      entries: [
        {
          question: 'What can FluxRadar check with no login of mine at all?',
          answer: [
            'Everything above that comes from the site itself: the SEO checks, AI crawler readiness, the security headers and cookie flags, the accessibility DOM checks, structured data and social previews, the privacy and consent signals, and the reliability checks. That is the core audit and it needs nothing from you but a public address.',
          ],
        },
        {
          question: 'What needs an integration or external data?',
          answer: [
            'Three things. Search performance — impressions, clicks and queries — comes from Google Search Console or Bing Webmaster Tools, which you connect yourself in Integrations. Audience data comes from Google Analytics 4 the same way. Core Web Vitals come from Google PageSpeed Insights and the Chrome UX Report. AI provider visibility needs an AI provider and your explicit consent for that scan.',
            'None of these are required. When a source is not connected the report says exactly that — not connected, no property linked, no data for this period — instead of inventing a number.',
          ],
        },
        {
          question: 'Do I have to connect anything to get value?',
          answer: [
            'No. The public audit is the product; integrations only add context you already own. You can run a full Complete scan without connecting a single account.',
          ],
        },
      ],
    },
    buying: {
      nav: 'What it costs',
      label: '10 / BUYING',
      title: 'The two reports, and what is free',
      entries: [
        {
          question: 'What is the difference between Basic and Complete?',
          answer: [
            `Basic (${BASIC_PRICE}) answers the visibility question: the full SEO analysis plus AI crawler readiness, up to 5,000 crawled URLs, results kept for 30 days.`,
            `Complete (${COMPLETE_PRICE}) is the whole picture: everything in Basic plus security, accessibility, performance, reliability, privacy and content quality, with the Issue Center, scan history and JSON/CSV export, up to 50,000 crawled URLs, results kept for 365 days.`,
            'There is no extra "full audit" item to buy on top of Complete. Complete already contains every module FluxRadar runs — one price, nothing added later at the checkout.',
          ],
        },
        {
          question: 'Is this a subscription?',
          answer: [
            'No. Each purchase is one scan of one website. Nothing renews, there is no monthly quota, and the scan starts only after the payment provider confirms the payment to our server.',
          ],
        },
        {
          question: 'Is there anything free?',
          answer: [
            'Yes, a homepage check: title, meta description, headings and indexability of a single page. It is available once per account and once per website, and it exists to show you the shape of a report — it is not a third product.',
          ],
        },
      ],
    },
    limits: {
      nav: 'Honest limits',
      label: '11 / LIMITS',
      title: 'What FluxRadar will not claim',
      entries: [
        {
          question: 'What can this report not prove?',
          answer: [
            'It is not a WCAG conformance statement, not an ASVS compliance certificate and not a GDPR or ePrivacy assessment. It does not promise rankings, traffic or a business outcome.',
            'It also cannot see what it is not allowed to see: pages behind a login or a paywall, anything excluded by robots.txt or by your crawl scope, and anything that only exists after complex client-side rendering.',
          ],
        },
        {
          question: 'How current is a report?',
          answer: [
            'It is a point-in-time snapshot. A/B tests, CDN differences between regions and edits made after the scan can all make a live page differ from what the report describes — which is exactly why each finding stores the evidence it was based on.',
          ],
        },
      ],
    },
  }),
};

export const faqCopyUk: FaqCopy = {
  documentTitle: 'Часті питання — FluxRadar',
  kicker: 'FLUXRADAR / ЧАСТІ ПИТАННЯ',
  meta: ['Оновлено 2026-09-06', 'Акаунт для читання не потрібен', 'Набір правил v0.1'],
  title: 'Кожна перевірка простими словами',
  lede: 'Що саме дивиться кожна перевірка FluxRadar, що звіт може довести, а де проходять чесні межі. Написано для власників сайтів, а не лише для інженерів.',
  back: '← Назад на головну',
  contents: 'ЗМІСТ',
  noticeLabel: 'ЛИШЕ ЧИТАННЯ',
  notice:
    'FluxRadar робить до вашого сайту звичайні публічні запити — такі самі, як браузер або пошуковий робот. Пароль до CMS, доступ по SSH, дані бази чи вихідний код не потрібні.',
  noticeTag: 'Стосується кожної перевірки',
  contact: 'Немає відповіді на ваше питання? Напишіть на',
  contactEmail: 'pavlenkoandrey56@gmail.com',
  footerBrand: 'FLUXRADAR / ВІД FLUXLAB',
  footerHome: 'Головна',
  footerCoverage: 'Покриття аудиту',
  footerPrivacy: 'Політика приватності',
  footerTerms: 'Умови використання',
  sections: faqSections({
    basics: {
      nav: 'Почніть звідси',
      label: '00 / ПОЧАТОК',
      title: 'Що таке FluxRadar',
      entries: [
        {
          question: 'Що саме робить FluxRadar?',
          answer: [
            'Ви даєте адресу публічного сайту. Сервіс запитує сторінки так само, як це зробив би відвідувач або пошуковий робот, фіксує відповіді та збирає з них один звіт: наскільки сайт помітний у пошуку, наскільки він зрозумілий для AI-систем і які технічні проблеми варто виправити першими.',
            'Нічого не вигадується. За кожним висновком стоїть те, що справді було в HTTP-відповіді — заголовок, тег, атрибут, код статусу, — тож ви можете перевірити це самостійно.',
          ],
        },
        {
          question: 'Чи потрібно давати доступ до сайту?',
          answer: [
            'Ні. Не треба нічого встановлювати, не треба створювати користувача в CMS і не треба вставляти код у сторінки. FluxRadar читає лише те, що вже публічне, і дотримується правил вашого robots.txt.',
            'Це водночас і межа: усе, що за входом, за оплатою чи у внутрішній мережі, для аудиту невидиме, а на сайті нічого не змінюється.',
          ],
        },
        {
          question: 'Що я отримую в результаті?',
          answer: [
            'Звіт за кожну перевірку: оцінка та стан покриття для кожного модуля і список висновків. Кожен висновок містить адресу, де його знайдено, конкретний елемент або заголовок, значення, яке спостерігалось, правило та рекомендацію щодо виправлення.',
            'Покриття показується чесно. Якщо модуль не вдалося перевірити, звіт так і каже, а не зараховує його як успішний.',
          ],
        },
      ],
    },
    workflow: {
      nav: 'Профілі, перевірки, звіти',
      label: '01 / РОБОЧИЙ ЦИКЛ',
      title: 'Профілі, перевірки та звіти',
      entries: [
        {
          question: 'Що таке профіль?',
          answer: [
            'Профіль — це збережений сайт: його публічна адреса плюс зрозуміла вам назва. Він тримає історію перевірок цього сайту в одному місці, щоб нову перевірку можна було порівняти з попередньою.',
            'Збереження профілю не запускає перевірку й не стягує оплату. Це лише закладка, з якою працює робочий простір.',
          ],
        },
        {
          question: 'Як запустити перевірку?',
          answer: [
            'Відкрийте «Перевірку», оберіть профіль, оберіть Basic або Complete, перегляньте область обходу (скільки сторінок, яка глибина, які шляхи включити чи виключити, чи дотримуватись robots.txt) і натисніть запуск. Нічого не стартує, доки ви не натиснете.',
            'Платна перевірка починається лише після того, як платіжний провайдер підтвердить оплату на нашому сервері. Закриття вкладки посеред процесу її не скасовує.',
          ],
        },
        {
          question: 'Де зберігаються звіти і як довго?',
          answer: [
            'Завершені та поточні перевірки — у розділі «Звіти». Звіт — це знімок конкретного моменту: сайт, який змінився після перевірки, вже не збігатиметься зі звітом, тому кожен висновок фіксує, що і коли було побачено.',
            'Результати Basic зберігаються 30 днів, результати Complete — 365 днів.',
          ],
        },
        {
          question: 'Чи може перевірка зашкодити сайту?',
          answer: [
            'Перевірка лише читає сторінки, тож нічого не змінює й не видаляє. Вона додає трафік — саме для цього існує область обходу: ліміт сторінок, ліміт глибини та шаблони включення й виключення тримають перевірку співмірною до сайту.',
            'За замовчуванням robots.txt дотримується. Його відхилення — окреме свідоме підтвердження, і робити це варто лише для сайту, за який ви відповідаєте.',
          ],
        },
      ],
    },
    seo: {
      nav: 'SEO',
      label: '02 / SEO',
      title: 'SEO — щоб вас знаходили в пошуку',
      entries: [
        {
          question: 'Що саме перевіряє SEO-модуль?',
          answer: [
            'Шістнадцять правил, поділених на технічну та сторінкову частини. Технічна: robots.txt, XML-мапа сайту, коди HTTP-статусів, канонічні теги, ланцюжки редиректів, биті внутрішні посилання, дублікати адрес, сигнали noindex і змішаний контент на HTTPS-сторінках.',
            'Сторінкова: заголовок, meta description, структура заголовків, alt-тексти зображень, структуровані дані JSON-LD (і синтаксис, і наявність обовʼязкових властивостей) та теги соціального прев’ю.',
            'Це детерміновані правила, а не оцінки на смак: та сама сторінка щоразу дає той самий результат.',
          ],
        },
        {
          question: 'Чи покаже це мої позиції та трафік?',
          answer: [
            'Не з перевірки сайту. Позиції, покази, кліки та запити — це дані, які має лише пошукова система. FluxRadar може показати їх поруч зі звітом, якщо ви самі підключите Google Search Console або Bing Webmaster Tools; це необовʼязково.',
            'Без підключення звіт розповідає, наскільки сайт добре зроблений для пошуку, а не як він зараз у пошуку виступає.',
          ],
        },
      ],
    },
    ai: {
      nav: 'AI SEO / AI-роботи',
      label: '03 / AI SEO / GEO',
      title: 'AI SEO — щоб сайт був придатний для AI-систем',
      entries: [
        {
          question: 'Що тут означає AI SEO?',
          answer: [
            'Дві практичні речі. Перша: чи взагалі дозволено AI-роботам завантажувати ваші сторінки — robots.txt розбирається на відомі агенти (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended, Bytespider), і кожен позначається як дозволений, заблокований або просто не згаданий.',
            'Друга: чи зможе машина, яка все ж завантажила сторінку, її зрозуміти — чи є реальний текст, який можна витягти, чи є структуровані дані про суть сторінки, чи є соціальне прев’ю, щоб надіслане посилання не виглядало порожнім.',
          ],
        },
        {
          question: 'Чи перевіряєте ви, чи згадують мій бренд ChatGPT або Perplexity?',
          answer: [
            'Лише як необовʼязкове доповнення й лише якщо ви увімкнете його для конкретної перевірки. Цей крок надсилає публічний вміст сторінок зовнішньому AI-провайдеру, тому він захищений окремою згодою в налаштуваннях перевірки й ніколи не входить у безкоштовну перевірку головної.',
            'Це також не гарантія видимості. Результат відображає те, що провайдер відповів через свій API у той момент; завтра відповідь може бути іншою.',
          ],
        },
        {
          question: 'Чи варто блокувати AI-роботів?',
          answer: [
            'FluxRadar не вирішує це за вас — він показує поточний стан, щоб вибір був свідомим. Блокування захищає контент від використання, дозвіл дає шанс бути процитованим у відповідях AI.',
            'Найкорисніше тут — помітити випадковість: правило, скопійоване з іншого сайту, яке блокує роботів, потрібних саме вам.',
          ],
        },
      ],
    },
    security: {
      nav: 'Безпека / OWASP ASVS',
      label: '04 / БЕЗПЕКА',
      title: 'Безпека — публічний профіль OWASP ASVS',
      entries: [
        {
          question: 'Що це за перевірка безпеки?',
          answer: [
            'Пасивна, доказова й повністю неінвазивна. FluxRadar читає відповіді, які ваш сайт і так віддає, та перевіряє захисні механізми, видимі в них: заголовки безпеки, HSTS, Content-Security-Policy, Permissions-Policy, налаштування CORS і атрибути cookie, що встановлюються на публічній сторінці.',
            'Це відповідає тій частині OWASP Application Security Verification Standard, яку можна перевірити ззовні, не торкаючись жодного акаунта.',
          ],
        },
        {
          question: 'Чи намагаєтесь ви зламати сайт?',
          answer: [
            'Ні. Немає ані фазингу, ані спроб інʼєкцій, ані перебору паролів, ані промацування форм входу. Якщо потрібно саме це — потрібен пентест, а це інша робота з окремо погодженою областю.',
            'Відсутній заголовок описується як невпроваджений захисний механізм, а не як доведена вразливість.',
          ],
        },
        {
          question: 'Чи є хороша оцінка сертифікатом?',
          answer: [
            'Ні. Вона означає, що публічна поверхня виглядає правильно налаштованою. Зони за входом, серверна логіка, доступ до бази, вразливості залежностей та інфраструктура поза межами будь-якої публічної перевірки, і FluxRadar не заявляє відповідність ASVS від вашого імені.',
          ],
        },
      ],
    },
    accessibility: {
      nav: 'Доступність / WCAG',
      label: '05 / ДОСТУПНІСТЬ',
      title: 'Доступність — WCAG 2.2, EN 301 549, Section 508',
      entries: [
        {
          question: 'Який стандарт перевіряється?',
          answer: [
            'Автоматично перевіряна частина WCAG 2.2 рівня AA. Це важливо для двох інших вимог, про які часто питають: EN 301 549 (європейська вимога для публічного сектору) і Section 508 (федеральна вимога США) спираються на WCAG, тож ті самі висновки є відправною точкою для обох — хоча обидва стандарти містять і вимоги, які жоден сканер DOM перевірити не може.',
          ],
        },
        {
          question: 'Що саме тестується?',
          answer: [
            'Контраст кольорів, alt-тексти зображень, структура документа й заголовків, підписи полів форм, доступність з клавіатури, видимий індикатор фокуса, використання ARIA, доступні назви кнопок і посилань, повідомлення про помилки у формах. Кожен висновок називає критерій і елемент, який не пройшов перевірку.',
            'Модуль також повідомляє про власну прозорість: які сторінки оцінено і де доказів було мало, щоб оцінку не читали ширше, ніж вона є.',
          ],
        },
        {
          question: 'Чи можна використати звіт як доказ відповідності?',
          answer: [
            'Ні, і жоден автоматичний інструмент чесно цього не запропонує. Приблизно третину критеріїв WCAG можна перевірити машинно; решта потребує людської оцінки та тестування з допоміжними технологіями — пастки фокуса у складних віджетах, чи розумно озвучує елемент читач екрана, чи справді змістовний alt-текст.',
            'Використовуйте звіт, щоб прибрати механічні помилки, а далі дайте людині перевірити те, що лишилося.',
          ],
        },
      ],
    },
    'structured-data': {
      nav: 'Структуровані дані та прев’ю',
      label: '06 / СТРУКТУРОВАНІ ДАНІ',
      title: 'Структуровані дані та соціальні прев’ю',
      entries: [
        {
          question: 'Що таке структуровані дані і чому це окрема перевірка?',
          answer: [
            'Структуровані дані — це невеликий машинозчитуваний блок (JSON-LD), який прямо каже, чим є сторінка: статтею, товаром, організацією, добіркою питань. Пошукові системи та AI-системи використовують його, щоб бути впевненими, а не здогадуватись із тексту.',
            'FluxRadar перевіряє дві різні речі: що блок синтаксично коректний і що він повний — товар без ціни або стаття без заголовка формально валідні й практично марні.',
          ],
        },
        {
          question: 'Що таке перевірка соціального прев’ю?',
          answer: [
            'Вона шукає теги Open Graph і карток, від яких залежить вигляд посилання, коли ним діляться в месенджері чи соцмережі: заголовок, опис і зображення. Якщо їх немає, посилання виглядає як голий текст і втрачає більшість переходів.',
          ],
        },
      ],
    },
    privacy: {
      nav: 'Приватність і згода',
      label: '07 / ПРИВАТНІСТЬ',
      title: 'Сигнали приватності та згоди',
      entries: [
        {
          question: 'Які сигнали приватності зчитуються?',
          answer: [
            'Які cookie встановлюються під час першого візиту та з якими атрибутами, чи є взагалі механізм згоди, які сторонні скрипти завантажує сторінка (аналітика, реклама та інші трекери) і чи можна реально знайти зі сторінки політику приватності або cookie.',
            'FluxRadar лише читає те, що сторінка вже робить. Він не натискає банер, нічого не приймає від вашого імені й не встановлює власного відстеження.',
          ],
        },
        {
          question: 'Це аудит GDPR?',
          answer: [
            'Ні. Він показує, чи присутні звичні механізми і що завантажується до згоди — корисний доказ і часто перша ознака проблеми. Чи законна ваша обробка даних — це юридична оцінка вашого бізнесу, а не висновок сканера.',
          ],
        },
      ],
    },
    performance: {
      nav: 'Продуктивність і надійність',
      label: '08 / ПРОДУКТИВНІСТЬ',
      title: 'Продуктивність, Core Web Vitals і надійність',
      entries: [
        {
          question: 'Чи вимірюєте ви Core Web Vitals?',
          answer: [
            'Не власним обходом — і варто пояснити чому. LCP, INP і CLS описують те, що переживає справжній браузер під час рендерингу, а наш сканер читає HTTP-відповіді, тож самостійне «вимірювання» було б оцінкою навмання під виглядом даних.',
            'Натомість FluxRadar бере їх у Google, коли це джерело доступне платформі: лабораторні метрики з PageSpeed Insights і польові метрики (75-й перцентиль реальних користувачів Chrome) з Chrome UX Report. Якщо джерело не налаштоване, модуль продуктивності позначається як недоступний, а не заповнюється здогадкою.',
          ],
        },
        {
          question: 'Що перевірка вимірює самостійно?',
          answer: [
            'Сигнали надійності, які видно безпосередньо: чи справді відповіла кожна адреса в області обходу, які з них повернули помилки сервера і скільки часу сервер витрачав на відповідь. Якщо в області є API-точки, перевіряється також, що вони відповідають очікуваним статусом і не потребують облікових даних, яких не має бути в публічному доступі.',
            'Це саме ті збої, що тихо забирають трафік: мертва сторінка, періодична 500-та помилка, сервер, який відповідає секундами.',
          ],
        },
      ],
    },
    'data-sources': {
      nav: 'Публічне та підключені дані',
      label: '09 / ДЖЕРЕЛА ДАНИХ',
      title: 'Що публічне, а що потребує підключення',
      entries: [
        {
          question: 'Що FluxRadar перевіряє взагалі без моїх логінів?',
          answer: [
            'Усе перелічене вище, що походить із самого сайту: SEO-перевірки, готовність до AI-роботів, заголовки безпеки та атрибути cookie, перевірки доступності в DOM, структуровані дані й соціальні прев’ю, сигнали приватності та згоди, перевірки надійності. Це і є основний аудит, і для нього потрібна лише публічна адреса.',
          ],
        },
        {
          question: 'Що потребує інтеграцій або зовнішніх даних?',
          answer: [
            'Три речі. Пошукова ефективність — покази, кліки та запити — надходить із Google Search Console або Bing Webmaster Tools, які ви підключаєте самі в розділі «Інтеграції». Дані про аудиторію так само надходять із Google Analytics 4. Core Web Vitals надходять із Google PageSpeed Insights і Chrome UX Report. Видимість у AI-провайдерів потребує провайдера та вашої явної згоди для конкретної перевірки.',
            'Нічого з цього не обовʼязкове. Якщо джерело не підключене, звіт так і пише — не підключено, ресурс не обрано, немає даних за період — замість того щоб вигадати число.',
          ],
        },
        {
          question: 'Чи треба щось підключати, щоб була користь?',
          answer: [
            'Ні. Продукт — це публічний аудит; інтеграції лише додають контекст, який і так ваш. Повну перевірку Complete можна провести, не підключивши жодного акаунта.',
          ],
        },
      ],
    },
    buying: {
      nav: 'Скільки це коштує',
      label: '10 / ОПЛАТА',
      title: 'Два звіти і що безкоштовно',
      entries: [
        {
          question: 'Чим Basic відрізняється від Complete?',
          answer: [
            `Basic (${BASIC_PRICE}) відповідає на питання видимості: повний SEO-аналіз плюс готовність до AI-роботів, до 5 000 сторінок обходу, результати зберігаються 30 днів.`,
            `Complete (${COMPLETE_PRICE}) — це вся картина: усе з Basic плюс безпека, доступність, продуктивність, надійність, приватність і якість контенту, разом з Issue Center, історією перевірок та експортом JSON/CSV, до 50 000 сторінок обходу, результати зберігаються 365 днів.`,
            'Жодного окремого «повного аудиту» доплачувати не треба. Complete уже містить усі модулі, які запускає FluxRadar, — одна ціна, нічого не додається на етапі оплати.',
          ],
        },
        {
          question: 'Це підписка?',
          answer: [
            'Ні. Кожна покупка — це одна перевірка одного сайту. Нічого не поновлюється, місячної квоти немає, а перевірка стартує лише після підтвердження оплати платіжним провайдером на нашому сервері.',
          ],
        },
        {
          question: 'Чи є щось безкоштовне?',
          answer: [
            'Так, перевірка головної сторінки: заголовок, meta description, заголовки та індексація однієї сторінки. Вона доступна один раз на акаунт і один раз на сайт і потрібна, щоб показати вигляд звіту, — це не третій продукт.',
          ],
        },
      ],
    },
    limits: {
      nav: 'Чесні межі',
      label: '11 / МЕЖІ',
      title: 'Чого FluxRadar не стверджує',
      entries: [
        {
          question: 'Чого цей звіт не доводить?',
          answer: [
            'Це не заява про відповідність WCAG, не сертифікат ASVS і не оцінка за GDPR чи ePrivacy. Він не обіцяє позицій, трафіку чи бізнес-результату.',
            'Він також не бачить того, що йому не дозволено бачити: сторінок за входом чи оплатою, усього, що виключено robots.txt або вашою областю обходу, і того, що зʼявляється лише після складного рендерингу на боці клієнта.',
          ],
        },
        {
          question: 'Наскільки звіт актуальний?',
          answer: [
            'Це знімок конкретного моменту. A/B-тести, відмінності CDN між регіонами та правки після перевірки можуть зробити живу сторінку іншою, ніж описано у звіті, — саме тому кожен висновок зберігає докази, на яких він побудований.',
          ],
        },
      ],
    },
  }),
};
