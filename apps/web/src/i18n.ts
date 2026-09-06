import { faqCopyEn, faqCopyUk } from './faq-copy';
import { BASIC_PRICE, COMPLETE_PRICE } from './tariff-prices';
import { tourStepCopy } from './tour-steps';

export type Language = 'en' | 'uk';

export const LANGUAGE_STORAGE_KEY = 'fluxradar.language';

export const languageOptions: readonly { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'uk', label: 'Українська' },
];

export function readStoredLanguage(): Language {
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'uk' ? 'uk' : 'en';
  } catch {
    return 'en';
  }
}

export function storeLanguage(language: Language): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // A blocked storage context should not prevent the shell from working.
  }
}

export const copy = {
  en: {
    nav: {
      home: 'Home',
      profiles: 'Profiles',
      scan: 'Scan',
      reports: 'Reports',
      integrations: 'Integrations',
      faq: 'FAQ',
      blog: 'Blog',
      language: 'Language',
      system: 'PUBLIC WEB AUDIT STATION · v0.1',
      descriptions: {
        profiles: 'Your saved websites and their audit history.',
        scan: 'Set up and start a new audit.',
        reports: 'Completed and in-progress audit results.',
        integrations: 'Optional data connections. The public-site scan works without them.',
        faq: 'Plain answers about every check and the limits of a report.',
      },
    },
    workspace: {
      intro: 'Unified public website audit station.',
      sites: 'Site Profiles',
      registered: 'Registered public origins',
      noSites: 'No public sites yet',
      noSitesHelp:
        'Add your first public website to begin. Enter its homepage address (like mysite.com) and FluxRadar creates a profile you can scan whenever you are ready.',
      addSite: 'Add site',
      addSiteHelp:
        'Saving a website builds a reusable profile and its audit history. FluxRadar reads only public pages — no passwords or CMS access — and saving does not start a scan or charge you.',
      displayName: 'Display name',
      displayNamePlaceholder: 'Product website',
      saveProfile: 'Save profile',
      saving: 'Saving…',
      newScan: 'New scan',
      inspect: 'Inspect',
      notes: 'Operator notes',
      guide: 'Open setup guide',
      billing: 'Billing',
      payPerScan: 'Pay-per-scan',
    },
    home: {
      signIn: 'Sign in',
      createAccount: 'Create account',
      openWorkspace: 'Open workspace',
      freeCta: 'Run a free homepage check',
      seePricing: 'See what you get',
      startPublicSite: 'Start with a public site',
      pricingTitle: 'Two one-time reports. No subscription.',
      pricingLead:
        'Pay once for a single scan of one public website and keep the report. Nothing renews, there is no monthly quota, and every module you paid for is included in the price.',
      accountBar: 'FLUXRADAR / PUBLIC WEB AUDIT STATION',
      hero: {
        eyebrow: 'FLUXLAB / PUBLIC WEB AUDIT STATION',
        titleLine1: 'One URL.',
        titleEm: 'Every signal.',
        lede: 'FluxRadar turns a public website into one clear operating picture: search visibility, AI discoverability, technical integrity and the issues worth fixing first.',
        proofScan: 'homepage check',
        proofSignals: 'audit signals',
        proofTiers: 'paid report tiers',
        proofAriaLabel: 'Product highlights',
      },
      instrument: {
        previewAriaLabel: 'FluxRadar audit preview',
        statusRunning: 'Running',
        modulesAriaLabel: 'Audit modules',
        live: 'LIVE AUDIT PREVIEW',
        mode: 'READ ONLY',
        originLabel: 'PUBLIC ORIGIN',
        signalScore: 'SIGNAL SCORE',
        signalScoreHint: 'your result after scan',
        coverage: 'COVERAGE',
        coverageHint: 'measured per scan',
        findings: 'FINDINGS',
        findingsHint: 'evidence-backed findings',
        terminalLines: [
          'scope homepage + public links',
          'seo       16 checks · complete',
          'ai seo    public readiness · ready',
          'security  ASVS public profile · queued',
        ],
        moduleSeo: 'SEO',
        moduleAiSeo: 'AI SEO / GEO',
        moduleSecurity: 'Security',
        moduleMore: '03 more signals',
      },
      ticker: {
        ariaLabel: 'FluxRadar audit coverage',
        seo: 'SEO',
        aiSeo: 'AI SEO / GEO',
        security: 'SECURITY',
        accessibility: 'ACCESSIBILITY',
        reliability: 'RELIABILITY',
        privacy: 'PRIVACY',
      },
      capabilities: {
        eyebrow: 'WHAT FLUXRADAR READS',
        title: 'A website is more than a ranking.',
        lead: 'Get one report for the signals that shape how people, crawlers and AI systems experience your site.',
        seo: {
          index: 'A / SEARCH',
          title: 'SEO visibility',
          body: 'Titles, descriptions, headings, canonicals, indexing and the technical details that help search engines understand your pages.',
          foot: '16 deterministic checks · JSON-LD preview',
        },
        ai: {
          index: 'B / AI SYSTEMS',
          title: 'AI SEO / GEO',
          body: 'See whether your brand and site are discoverable by AI systems, with public crawler readiness plus consent-aware provider checks.',
          foot: 'Public readiness · provider visibility optional',
        },
        integrity: {
          index: 'C / INTEGRITY',
          title: 'Site health',
          body: 'OWASP ASVS public signals, WCAG mappings, reliability, content quality and privacy — scored with honest coverage states.',
          foot: 'No false certainty',
        },
      },
      coverageEntry: {
        eyebrow: 'EXACTLY WHAT WE CHECK',
        title: 'Every check. Every standard. No surprises.',
        body: '16 SEO checks, AI crawler readiness, OWASP ASVS public signals, WCAG 2.2 AA / EN 301 549 / Section 508 accessibility rules, performance signals and privacy / consent detection — all sourced from public HTTP responses, no credentials needed.',
      },
      workflow: {
        eyebrow: 'THE OPERATING LOOP',
        title: 'From public URL to prioritized work.',
        lead: 'No access to your CMS, analytics or source code required. Start with what anyone on the web can see.',
        step1Title: 'Choose an origin',
        step1Body: 'Enter one HTTPS website and define how deep the crawl should go.',
        step2Title: 'Run the station',
        step2Body: 'FluxRadar crawls public pages and records evidence behind every finding.',
        step3Title: 'Fix what matters',
        step3Body: 'Open the Issue Center, assign a status and export the Complete report.',
      },
      pricingEyebrow: 'PAY PER SCAN',
      lastCall: {
        eyebrow: 'READY WHEN YOU ARE',
        titleLine1: 'Start with the site',
        titleEm: 'you already have.',
        cta: 'Run a free check',
      },
      footer: {
        brand: 'FLUXRADAR / BY FLUXLAB',
        coverageLink: 'Audit coverage',
        privacyLink: 'Privacy policy',
        termsLink: 'Terms of service',
        fieldNotes: 'Field notes',
      },
    },
    tour: {
      label: 'WORKSPACE TOUR',
      close: 'Close setup guide',
      next: 'Next',
      back: 'Back',
      skip: 'Skip',
      finish: 'Finish',
      step: (current: number, total: number) => `Step ${current} of ${total}`,
      steps: tourStepCopy({
        'workspace-tabs': {
          title: 'Your workspace tabs',
          body: 'The bar at the top is the whole workspace. Profiles holds the public websites you saved, Scan starts an audit of one of them, and Reports keeps the finished results. Integrations is optional context — a public audit works without it, and FAQ answers what each check covers.',
        },
        'profile-domain': {
          title: 'Add a public website',
          body: 'Enter the homepage address of a site anyone can open, like mysite.com. FluxRadar reads only public pages — it never needs a CMS password or source-code access.',
        },
        'save-profile': {
          title: 'Save the profile',
          body: 'Give the site a name and save it. Saving only creates a reusable profile: it does not start a scan and it does not charge you.',
        },
        'run-scan': {
          title: 'Start a scan when you are ready',
          body: 'To audit a saved site, open Scan from this bar (or New scan next to the site), pick Basic or Complete, review the crawl scope and press start. Nothing runs until you press it — this tour never starts a scan for you.',
        },
      }),
    },
    faq: faqCopyEn,
    pricing: {
      publicOnly: 'Public pages only — no customer credentials required',
      included: 'What you get',
      bestFor: 'Best for',
      notIncluded: 'Not covered',
      limits: 'Limits',
      chooseBasic: 'Start with Basic',
      chooseComplete: 'Start with Complete',
      startInWorkspace:
        'You buy a report inside the workspace: pick a saved website, choose Basic or Complete, and the scan starts once the payment provider confirms the payment.',
      freeNote:
        'There is also a free homepage check — title, meta description, headings and indexability of one page, once per account and once per website. It is a first look at the report format, not a third product.',
      coverageLink: 'Read the full audit coverage →',
      faqLink: 'Read the FAQ →',
      cards: {
        basic: {
          eyebrow: 'BASIC / SEARCH + AI VISIBILITY',
          title: 'Basic',
          price: BASIC_PRICE,
          description: 'One report on how search engines and AI systems read your website.',
          included:
            'The full SEO analysis — 16 checks covering titles, meta descriptions, headings, canonicals, robots.txt, sitemap, redirects, broken links, duplicate URLs, structured data and social previews — plus AI crawler readiness: which AI crawlers your robots.txt allows and whether your pages are machine-readable.',
          bestFor:
            'Owners and marketers whose question is “why am I not being found — in search or in AI answers?”',
          notIncluded:
            'Security, accessibility, performance, reliability, privacy and content-quality modules.',
          limits: 'One scan of one website · up to 5,000 crawled pages · results kept for 30 days.',
        },
        complete: {
          eyebrow: 'COMPLETE / EVERY MODULE',
          title: 'Complete',
          price: COMPLETE_PRICE,
          description: 'Everything FluxRadar can read about a public website, in one report.',
          included:
            'Everything in Basic plus security (public OWASP ASVS profile), accessibility (WCAG 2.2 AA), performance, reliability, privacy and consent, and content quality — with the Issue Center, scan history and JSON/CSV export. Every module FluxRadar runs is already in this price; there is nothing extra to add at checkout.',
          bestFor:
            'Anyone who needs the whole picture before a redesign, a launch, a handover or a client report.',
          limits:
            'One scan of one website · up to 50,000 crawled pages · results kept for 365 days.',
        },
      },
      explainer: {
        kicker: 'IN PLAIN LANGUAGE',
        title: 'Which one is right for you?',
        basic: {
          title: 'Take Basic if the question is visibility',
          body: 'You want to know why the site is not showing up, or whether AI systems can read it at all. Basic goes deep on search and AI readiness and stops there — it does not look at security, accessibility or speed.',
        },
        complete: {
          title: 'Take Complete if you need the whole picture',
          body: 'Everything Basic covers, plus security headers, accessibility, performance, reliability and privacy — one report, one price, every module included. This is the one to buy before a redesign or when you have to hand a site over to someone else.',
        },
        footnote:
          'Both read public pages only, need no CMS password, and stay inside the crawl scope you set before the scan starts.',
      },
    },
    newScan: {
      windowTitle: 'New scan — scope and tariff',
      windowTitleEmpty: 'New scan',
      emptyTitle: 'Create a site profile first',
      panelTarget: 'Target',
      labelOrigin: 'Public origin',
      labelSubdomains: 'Include subdomains (where allowed)',
      labelUserAgent: 'User agent',
      userAgentDesktop: 'Desktop',
      userAgentMobile: 'Mobile',
      panelDepth: 'Audit depth',
      labelScanPlan: 'Scan plan',
      planFree: 'Free · homepage only',
      planBasicInternal: 'Basic · internal free',
      planBasicPaid: `Basic · ${BASIC_PRICE}`,
      planCompleteInternal: 'Complete · internal free',
      planCompletePaid: `Complete · ${COMPLETE_PRICE}`,
      labelMaxPages: 'Maximum pages',
      labelMaxDepth: 'Maximum crawl depth',
      labelIncludePatterns: 'Include path patterns (comma separated)',
      labelExcludePatterns: 'Exclude path patterns (comma separated)',
      labelQueryPolicy: 'URL query parameters',
      queryIgnore: 'Ignore parameters',
      queryInclude: 'Include parameters',
      labelRespectRobots: 'Respect robots.txt',
      labelRobotsOverride: 'I confirm the robots.txt override',
      labelAiConsent:
        'Allow sending public pages to an external AI model (for AI SEO / GEO visibility)',
      noProfile: 'Select a profile',
      publicSiteOnly: '· public site only',
      creating: 'Creating…',
      runFree: 'Run free check',
      runInternal: 'Run internal scan',
      runPaid: 'Pay and run scan',
      paidUnavailable:
        'Paid scans will be available when checkout is enabled. Free scan is available now.',
      openingCheckout: 'Opening checkout…',
    },
    checkout: {
      windowTitle: 'Payment — confirming',
      panelTitle: 'FluxRadar / checkout',
      confirming:
        'Finish the payment in the checkout tab. FluxRadar is waiting for the payment provider to confirm it.',
      stillWaiting:
        'The payment has not been confirmed yet. It can take a few minutes; this page updates as soon as the provider confirms.',
      rejected:
        'The payment provider reported a problem with this checkout, so no scan was created. No charge grants a scan until it is confirmed.',
      rejectedExpired:
        'This checkout expired before a payment was confirmed. Nothing was charged for it — start a new checkout when you are ready.',
      rejectedProviderUnavailable:
        'The payment provider could not open this checkout, so no payment was taken. Try again in a moment.',
      rejectedPaymentNotVerified:
        'A payment could not be matched to this checkout, so no scan was created. If you were charged, contact support and quote the checkout reference below.',
      noScanUntilConfirmed:
        'The scan starts only after the provider confirms the payment on our server — closing this window does not cancel it.',
      openCheckoutLink: 'Open the checkout page',
      popupBlocked: 'Your browser blocked the checkout tab. Use the link below to continue.',
      popupOpening: 'Opening the secure FastSpring checkout…',
      popupOpen:
        'Complete the payment in the checkout window. FluxRadar is waiting for FastSpring to confirm it.',
      popupClosed:
        'The checkout window is closed. If the payment went through, confirmation appears here in a moment — reopen the checkout if you have not paid yet.',
      popupPaused:
        'This payment is still open. Reopen the checkout to finish it, or wait here if you have already paid.',
      popupReopen: 'Reopen the checkout',
      popupFailedSdk:
        'The FastSpring checkout could not be loaded — an ad blocker, a privacy extension or the network may be blocking it. Nothing has been charged.',
      popupFailedLaunch:
        'The FastSpring checkout could not be opened for this payment. Nothing has been charged.',
      popupFailedStorefront:
        'Paid checkout is misconfigured for this environment, so the checkout could not open. Nothing has been charged.',
      popupFallbackHint:
        'You can finish the same payment on the FastSpring checkout page instead — it is the same order, opened in a new tab:',
      checkAgain: 'Check payment status',
      close: 'Close',
      pollFailed: 'FluxRadar could not read the payment status. Try again in a moment.',
      testMode: 'Payment provider is in test mode — no real charge is made.',
      unavailable:
        'Paid checkout is not configured for this environment yet. The free homepage check is available now.',
      unavailableTemporary:
        'Paid checkout is temporarily unavailable. The free homepage check is available now.',
    },
  },
  uk: {
    nav: {
      home: 'Головна',
      profiles: 'Профілі',
      scan: 'Перевірка',
      reports: 'Звіти',
      integrations: 'Інтеграції',
      faq: 'FAQ',
      blog: 'Блог',
      language: 'Мова',
      system: 'СТАНЦІЯ АУДИТУ ПУБЛІЧНИХ САЙТІВ · v0.1',
      descriptions: {
        profiles: 'Ваші збережені сайти та історія їхніх перевірок.',
        scan: 'Налаштуйте та запустіть нову перевірку.',
        reports: 'Готові та поточні результати перевірок.',
        integrations: 'Необовʼязкові підключення даних. Публічна перевірка працює без них.',
        faq: 'Прості відповіді про кожну перевірку та межі звіту.',
      },
    },
    workspace: {
      intro: 'Єдина станція аудиту публічного сайту.',
      sites: 'Профілі сайтів',
      registered: 'Зареєстровані публічні джерела',
      noSites: 'Публічних сайтів ще немає',
      noSitesHelp:
        'Додайте перший публічний сайт, щоб почати. Введіть адресу головної сторінки (наприклад, mysite.com), і FluxRadar створить профіль, який можна перевірити будь-коли.',
      addSite: 'Додати сайт',
      addSiteHelp:
        'Збереження сайту створює багаторазовий профіль та історію його перевірок. FluxRadar читає лише публічні сторінки — без паролів і доступу до CMS — а збереження не запускає перевірку й не стягує оплату.',
      displayName: 'Назва',
      displayNamePlaceholder: 'Сайт продукту',
      saveProfile: 'Зберегти профіль',
      saving: 'Збереження…',
      newScan: 'Нова перевірка',
      inspect: 'Переглянути',
      notes: 'Нотатки оператора',
      guide: 'Відкрити інструкцію',
      billing: 'Оплата',
      payPerScan: 'Оплата за перевірку',
    },
    home: {
      signIn: 'Увійти',
      createAccount: 'Створити акаунт',
      openWorkspace: 'Відкрити робочий простір',
      freeCta: 'Запустити безкоштовну перевірку',
      seePricing: 'Що входить у звіт',
      startPublicSite: 'Почати з публічного сайту',
      pricingTitle: 'Два разові звіти. Без підписки.',
      pricingLead:
        'Ви платите один раз за одну перевірку одного публічного сайту і залишаєте звіт собі. Нічого не поновлюється, місячної квоти немає, а всі модулі, за які ви заплатили, уже входять у ціну.',
      accountBar: 'FLUXRADAR / СТАНЦІЯ АУДИТУ ПУБЛІЧНИХ САЙТІВ',
      hero: {
        eyebrow: 'FLUXLAB / СТАНЦІЯ АУДИТУ ПУБЛІЧНИХ САЙТІВ',
        titleLine1: 'Одна адреса.',
        titleEm: 'Усі сигнали.',
        lede: 'FluxRadar перетворює публічний сайт на єдину чітку картину: пошукова видимість, доступність для AI, технічна цілісність і проблеми, які варто виправити першими.',
        proofScan: 'перевірка головної',
        proofSignals: 'сигналів аудиту',
        proofTiers: 'тарифи платного звіту',
        proofAriaLabel: 'Ключові переваги продукту',
      },
      instrument: {
        previewAriaLabel: 'Попередній перегляд аудиту FluxRadar',
        statusRunning: 'Виконується',
        modulesAriaLabel: 'Модулі перевірки',
        live: 'ЖИВИЙ ПЕРЕГЛЯД АУДИТУ',
        mode: 'ЛИШЕ ЧИТАННЯ',
        originLabel: 'ПУБЛІЧНЕ ДЖЕРЕЛО',
        signalScore: 'ОЦІНКА СИГНАЛУ',
        signalScoreHint: 'ваш результат після перевірки',
        coverage: 'ОХОПЛЕННЯ',
        coverageHint: 'вимірюється за перевірку',
        findings: 'ВИСНОВКИ',
        findingsHint: 'висновки з доказами',
        terminalLines: [
          'область: головна + публічні посилання',
          'seo       16 перевірок · завершено',
          'ai seo    публічна готовність · готово',
          'security  публічний профіль ASVS · у черзі',
        ],
        moduleSeo: 'SEO',
        moduleAiSeo: 'AI SEO / GEO',
        moduleSecurity: 'Безпека',
        moduleMore: '03 інших сигнали',
      },
      ticker: {
        ariaLabel: 'Охоплення аудиту FluxRadar',
        seo: 'SEO',
        aiSeo: 'AI SEO / GEO',
        security: 'БЕЗПЕКА',
        accessibility: 'ДОСТУПНІСТЬ',
        reliability: 'НАДІЙНІСТЬ',
        privacy: 'ПРИВАТНІСТЬ',
      },
      capabilities: {
        eyebrow: 'ЩО ЧИТАЄ FLUXRADAR',
        title: 'Сайт — це більше, ніж позиція в рейтингу.',
        lead: 'Отримайте один звіт про сигнали, які формують досвід людей, краулерів та AI-систем на вашому сайті.',
        seo: {
          index: 'A / ПОШУК',
          title: 'SEO-видимість',
          body: 'Заголовки, описи, structure заголовків, канонічні посилання, індексація та технічні деталі, які допомагають пошуковим системам розуміти ваші сторінки.',
          foot: '16 детермінованих перевірок · перегляд JSON-LD',
        },
        ai: {
          index: 'B / AI-СИСТЕМИ',
          title: 'AI SEO / GEO',
          body: 'Перевірте, чи можуть AI-системи виявити ваш бренд і сайт: публічна готовність до краулерів плюс перевірки провайдерів із урахуванням згоди.',
          foot: 'Публічна готовність · видимість провайдера — опційно',
        },
        integrity: {
          index: 'C / ЦІЛІСНІСТЬ',
          title: 'Стан сайту',
          body: 'Публічні сигнали OWASP ASVS, відповідність WCAG, надійність, якість контенту та приватність — з чесними станами покриття.',
          foot: 'Без фальшивої впевненості',
        },
      },
      coverageEntry: {
        eyebrow: 'ЩО САМЕ МИ ПЕРЕВІРЯЄМО',
        title: 'Кожна перевірка. Кожен стандарт. Без сюрпризів.',
        body: '16 SEO-перевірок, готовність до AI-краулерів, публічні сигнали OWASP ASVS, правила доступності WCAG 2.2 AA / EN 301 549 / Section 508, сигнали продуктивності та виявлення приватності / згоди — усе з публічних HTTP-відповідей, облікові дані не потрібні.',
      },
      workflow: {
        eyebrow: 'РОБОЧИЙ ЦИКЛ',
        title: 'Від публічної адреси до пріоритезованих завдань.',
        lead: 'Доступ до вашої CMS, аналітики чи вихідного коду не потрібен. Почніть з того, що бачить будь-хто в інтернеті.',
        step1Title: 'Оберіть джерело',
        step1Body: 'Введіть одну HTTPS-адресу та визначте глибину обходу.',
        step2Title: 'Запустіть станцію',
        step2Body: 'FluxRadar обходить публічні сторінки та фіксує докази для кожного висновку.',
        step3Title: 'Виправте головне',
        step3Body: 'Відкрийте Issue Center, призначте статус і експортуйте звіт Complete.',
      },
      pricingEyebrow: 'ОПЛАТА ЗА ПЕРЕВІРКУ',
      lastCall: {
        eyebrow: 'ГОТОВІ, КОЛИ ГОТОВІ ВИ',
        titleLine1: 'Почніть із сайту,',
        titleEm: 'який у вас уже є.',
        cta: 'Запустити перевірку',
      },
      footer: {
        brand: 'FLUXRADAR / ВІД FLUXLAB',
        coverageLink: 'Покриття аудиту',
        privacyLink: 'Політика приватності',
        termsLink: 'Умови використання',
        fieldNotes: 'Нотатки з практики',
      },
    },
    tour: {
      label: 'ОГЛЯД РОБОЧОГО ПРОСТОРУ',
      close: 'Закрити інструкцію',
      next: 'Далі',
      back: 'Назад',
      skip: 'Пропустити',
      finish: 'Завершити',
      step: (current: number, total: number) => `Крок ${current} з ${total}`,
      steps: tourStepCopy({
        'workspace-tabs': {
          title: 'Вкладки робочого простору',
          body: 'Верхня панель — це весь робочий простір. «Профілі» зберігають публічні сайти, які ви додали, «Перевірка» запускає аудит одного з них, «Звіти» містять готові результати. «Інтеграції» — необовʼязковий контекст: публічний аудит працює й без них, а FAQ пояснює, що саме входить у кожну перевірку.',
        },
        'profile-domain': {
          title: 'Додайте публічний сайт',
          body: 'Введіть адресу головної сторінки, яку може відкрити будь-хто, наприклад mysite.com. FluxRadar читає лише публічні сторінки — пароль до CMS або доступ до коду не потрібні.',
        },
        'save-profile': {
          title: 'Збережіть профіль',
          body: 'Дайте сайту назву та збережіть його. Це лише створює багаторазовий профіль: перевірка не запускається й оплата не стягується.',
        },
        'run-scan': {
          title: 'Запустіть перевірку, коли будете готові',
          body: 'Щоб перевірити збережений сайт, відкрийте «Перевірку» на цій панелі (або «Нову перевірку» біля сайту), оберіть Basic або Complete, перегляньте область обходу та натисніть запуск. Нічого не почнеться, доки ви не натиснете — цей огляд не запускає перевірку за вас.',
        },
      }),
    },
    faq: faqCopyUk,
    pricing: {
      publicOnly: 'Лише публічні сторінки — облікові дані клієнта не потрібні',
      included: 'Що ви отримуєте',
      bestFor: 'Кому підходить',
      notIncluded: 'Не входить',
      limits: 'Обмеження',
      chooseBasic: 'Почати з Basic',
      chooseComplete: 'Почати з Complete',
      startInWorkspace:
        'Звіт купується в робочому просторі: оберіть збережений сайт, оберіть Basic або Complete — перевірка стартує, щойно платіжний провайдер підтвердить оплату.',
      freeNote:
        'Є також безкоштовна перевірка головної сторінки — заголовок, meta description, заголовки та індексація однієї сторінки, один раз на акаунт і один раз на сайт. Це перший погляд на формат звіту, а не третій продукт.',
      coverageLink: 'Переглянути всі перевірки →',
      faqLink: 'Читати FAQ →',
      cards: {
        basic: {
          eyebrow: 'BASIC / ПОШУК + AI',
          title: 'Basic',
          price: BASIC_PRICE,
          description: 'Один звіт про те, як ваш сайт читають пошукові системи та AI-системи.',
          included:
            'Повний SEO-аналіз — 16 перевірок: заголовки, meta description, структура заголовків, канонічні теги, robots.txt, мапа сайту, редиректи, биті посилання, дублікати адрес, структуровані дані та соціальні прев’ю — плюс готовність до AI-роботів: яким AI-роботам дозволяє ваш robots.txt і чи придатні ваші сторінки для машинного читання.',
          bestFor:
            'Власникам і маркетологам, чиє питання звучить так: «чому мене не знаходять — у пошуку чи у відповідях AI?»',
          notIncluded:
            'Модулі безпеки, доступності, продуктивності, надійності, приватності та якості контенту.',
          limits: 'Одна перевірка одного сайту · до 5 000 сторінок обходу · результати 30 днів.',
        },
        complete: {
          eyebrow: 'COMPLETE / УСІ МОДУЛІ',
          title: 'Complete',
          price: COMPLETE_PRICE,
          description: 'Усе, що FluxRadar може прочитати про публічний сайт, в одному звіті.',
          included:
            'Усе з Basic плюс безпека (публічний профіль OWASP ASVS), доступність (WCAG 2.2 AA), продуктивність, надійність, приватність і згода та якість контенту — разом з Issue Center, історією перевірок і експортом JSON/CSV. Усі модулі, які запускає FluxRadar, уже входять у цю ціну; нічого додавати на етапі оплати не потрібно.',
          bestFor:
            'Тим, кому потрібна повна картина перед редизайном, запуском, передачею сайту або звітом для клієнта.',
          limits: 'Одна перевірка одного сайту · до 50 000 сторінок обходу · результати 365 днів.',
        },
      },
      explainer: {
        kicker: 'ПРОСТОЮ МОВОЮ',
        title: 'Що обрати саме вам?',
        basic: {
          title: 'Беріть Basic, якщо питання — видимість',
          body: 'Вам треба зрозуміти, чому сайт не показується, або чи можуть AI-системи взагалі його прочитати. Basic глибоко розбирає пошук і готовність до AI — і на цьому зупиняється: безпеку, доступність і швидкість він не дивиться.',
        },
        complete: {
          title: 'Беріть Complete, якщо потрібна вся картина',
          body: 'Усе, що є в Basic, плюс заголовки безпеки, доступність, продуктивність, надійність і приватність — один звіт, одна ціна, усі модулі включені. Саме цей варіант беруть перед редизайном або коли сайт треба комусь передати.',
        },
        footnote:
          'Обидва читають лише публічні сторінки, не потребують пароля до CMS і працюють у межах області обходу, яку ви задаєте перед стартом.',
      },
    },
    newScan: {
      windowTitle: 'Нова перевірка — область і тариф',
      windowTitleEmpty: 'Нова перевірка',
      emptyTitle: 'Спочатку створіть профіль сайту',
      panelTarget: 'Ціль',
      labelOrigin: 'Публічне джерело',
      labelSubdomains: 'Включати піддомени (де дозволено)',
      labelUserAgent: 'Агент користувача',
      userAgentDesktop: 'Десктоп',
      userAgentMobile: 'Мобільний',
      panelDepth: 'Глибина аудиту',
      labelScanPlan: 'Тариф перевірки',
      planFree: 'Free · лише головна',
      planBasicInternal: 'Basic · внутрішній безкоштовний',
      planBasicPaid: `Basic · ${BASIC_PRICE}`,
      planCompleteInternal: 'Complete · внутрішній безкоштовний',
      planCompletePaid: `Complete · ${COMPLETE_PRICE}`,
      labelMaxPages: 'Максимум сторінок',
      labelMaxDepth: 'Максимальна глибина обходу',
      labelIncludePatterns: 'Шаблони шляхів для включення (через кому)',
      labelExcludePatterns: 'Шаблони шляхів для виключення (через кому)',
      labelQueryPolicy: 'Параметри URL-запиту',
      queryIgnore: 'Ігнорувати параметри',
      queryInclude: 'Включати параметри',
      labelRespectRobots: 'Дотримуватись robots.txt',
      labelRobotsOverride: 'Підтверджую відхилення robots.txt',
      labelAiConsent:
        'Дозволити надсилати публічні сторінки зовнішній AI-моделі (для AI SEO / GEO)',
      noProfile: 'Оберіть профіль',
      publicSiteOnly: '· лише публічний сайт',
      creating: 'Створення…',
      runFree: 'Запустити безкоштовну перевірку',
      runInternal: 'Запустити внутрішню перевірку',
      runPaid: 'Оплатити та запустити',
      paidUnavailable:
        'Платні перевірки будуть доступні після підключення оплати. Безкоштовна перевірка доступна зараз.',
      openingCheckout: 'Відкриваємо оплату…',
    },
    checkout: {
      windowTitle: 'Оплата — підтвердження',
      panelTitle: 'FluxRadar / оплата',
      confirming:
        'Завершіть оплату у вкладці checkout. FluxRadar очікує підтвердження від платіжного провайдера.',
      stillWaiting:
        'Оплату ще не підтверджено. Це може зайняти кілька хвилин; сторінка оновиться, щойно провайдер підтвердить платіж.',
      rejected:
        'Платіжний провайдер повідомив про проблему з цим checkout, тому перевірку не створено. Без підтвердження оплата не відкриває сканування.',
      rejectedExpired:
        'Термін цього checkout минув до підтвердження оплати. Кошти за нього не списано — просто розпочніть нову оплату.',
      rejectedProviderUnavailable:
        'Платіжний провайдер не зміг відкрити цей checkout, тому оплату не проведено. Спробуйте ще раз за хвилину.',
      rejectedPaymentNotVerified:
        'Платіж не вдалося зіставити з цим checkout, тому перевірку не створено. Якщо кошти списано, зверніться до підтримки та вкажіть номер checkout нижче.',
      noScanUntilConfirmed:
        'Перевірка стартує лише після підтвердження оплати на нашому сервері — закриття цього вікна її не скасовує.',
      openCheckoutLink: 'Відкрити сторінку оплати',
      popupBlocked: 'Браузер заблокував вкладку оплати. Скористайтеся посиланням нижче.',
      popupOpening: 'Відкриваємо захищений checkout FastSpring…',
      popupOpen:
        'Завершіть оплату у вікні checkout. FluxRadar очікує підтвердження від FastSpring.',
      popupClosed:
        'Вікно checkout закрито. Якщо оплата пройшла, підтвердження зʼявиться тут за мить — якщо ще ні, відкрийте checkout знову.',
      popupPaused:
        'Ця оплата ще активна. Відкрийте checkout, щоб завершити її, або зачекайте тут, якщо вже оплатили.',
      popupReopen: 'Відкрити checkout знову',
      popupFailedSdk:
        'Не вдалося завантажити checkout FastSpring — можливо, його блокує розширення браузера або мережа. Кошти не списано.',
      popupFailedLaunch:
        'Не вдалося відкрити checkout FastSpring для цієї оплати. Кошти не списано.',
      popupFailedStorefront:
        'Платний checkout налаштовано некоректно для цього середовища, тому вікно не відкрилося. Кошти не списано.',
      popupFallbackHint:
        'Ту саму оплату можна завершити на сторінці checkout FastSpring — це те саме замовлення, відкриється в новій вкладці:',
      checkAgain: 'Перевірити статус оплати',
      close: 'Закрити',
      pollFailed: 'FluxRadar не зміг прочитати статус оплати. Спробуйте за мить.',
      testMode: 'Платіжний провайдер у тестовому режимі — реального списання немає.',
      unavailable:
        'Платний checkout ще не налаштовано для цього середовища. Безкоштовна перевірка головної сторінки доступна зараз.',
      unavailableTemporary:
        'Платний checkout тимчасово недоступний. Безкоштовна перевірка головної сторінки доступна зараз.',
    },
  },
} as const;

export type Copy = (typeof copy)[Language];
