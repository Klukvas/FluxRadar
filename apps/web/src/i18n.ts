import { checksCopyEn, checksCopyUk } from './checks-copy';
import { faqCopyEn, faqCopyUk } from './faq-copy';
import { BASIC_PRICE, COMPLETE_PRICE } from './tariff-prices';
import { tourStepCopy } from './tour-steps';

export type Language = 'en' | 'uk';

export const LANGUAGE_STORAGE_KEY = 'fluxradar.language';

export const languageOptions: readonly { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'uk', label: 'Українська' },
];

export const LANGUAGE_QUERY_PARAM = 'lang';

export function readStoredLanguage(): Language {
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'uk' ? 'uk' : 'en';
  } catch {
    return 'en';
  }
}

/** `?lang=uk` / `?lang=en` on the current URL, or null when it is absent or unknown. */
export function readLanguageParam(search: string = window.location.search): Language | null {
  try {
    const value = new URLSearchParams(search).get(LANGUAGE_QUERY_PARAM);
    return value === 'uk' || value === 'en' ? value : null;
  } catch {
    return null;
  }
}

/**
 * The language a session opens in.
 *
 * `?lang=` wins over the stored preference and is written back to it, because
 * that parameter is what the blog's language filter, the sitemap's `hreflang`
 * alternates and any shared link carry: following one of those has to land in
 * the language it promised, and stay there for the rest of the visit.
 */
export function readInitialLanguage(): Language {
  const requested = readLanguageParam();
  if (requested === null) return readStoredLanguage();
  storeLanguage(requested);
  return requested;
}

export function storeLanguage(language: Language): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // A blocked storage context should not prevent the shell from working.
  }
}

/**
 * Fills `{name}` placeholders in a localized string.
 *
 * Sentences that carry a number or a domain differ in word order between the
 * locales, so the value has to sit inside the translated sentence rather than be
 * concatenated around it. An unknown placeholder is left as written, which makes
 * a missing value visible in review instead of silently rendering "undefined".
 */
export function fillCopy(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
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
      navigateGroup: 'Navigate',
      systemGroup: 'System',
      descriptions: {
        profiles: 'Your saved profiles and their audit history.',
        scan: 'Set up and start a new audit.',
        reports: 'Completed and in-progress audit results.',
        integrations: 'Optional data connections. The public-site scan works without them.',
        faq: 'Plain answers about every check and the limits of a report.',
      },
    },
    legal: {
      kicker: 'FLUXLAB / PUBLIC DOCUMENT',
      meta: ['FLUXRADAR.NET', 'REV. 2026.09', 'READ BEFORE CONNECTING'],
      back: '← Back to FluxRadar',
      contents: 'DOCUMENT MAP',
      contentsLabel: 'Document sections',
      englishNotice:
        'This document is maintained in English. The English text is the version that applies.',
      footerBrand: 'FLUXRADAR / BY FLUXLAB',
      questions: 'Questions:',
      privacy: {
        title: 'Privacy policy',
        crossLink: 'Privacy policy →',
        lede: 'A plain-language record of what FluxRadar collects, why it uses it and how connected Google data is handled.',
        sections: [
          { id: 'privacy-scope', label: 'Scope' },
          { id: 'privacy-data', label: 'Data we handle' },
          { id: 'privacy-google', label: 'Google user data' },
          { id: 'privacy-use', label: 'How we use data' },
          { id: 'privacy-retention', label: 'Storage & deletion' },
          { id: 'privacy-rights', label: 'Your choices' },
        ],
      },
      terms: {
        title: 'Terms of service',
        crossLink: 'Terms of service →',
        lede: 'The operating terms for using FluxRadar to review public websites and purchase one-time audit reports.',
        sections: [
          { id: 'terms-service', label: 'The service' },
          { id: 'terms-account', label: 'Accounts' },
          { id: 'terms-paid', label: 'Free and paid scans' },
          { id: 'terms-use', label: 'Acceptable use' },
          { id: 'terms-results', label: 'Reports & limitations' },
          { id: 'terms-ending', label: 'Ending use' },
        ],
      },
    },
    seo: {
      home: {
        title: 'FluxRadar — public website audit for SEO, AI crawlers, security and accessibility',
        description:
          'FluxRadar audits any public website and reports what search engines, AI crawlers and users can observe: SEO, AI readiness, security headers, accessibility, performance and privacy signals. Two one-time reports, no subscription.',
      },
      faq: {
        title: 'FAQ — what every FluxRadar check means | FluxRadar',
        description:
          'Plain answers about every FluxRadar check: SEO, AI crawler readiness, security, accessibility, structured data, privacy, performance — and the limits of what a public audit can prove.',
      },
      checks: {
        title: 'Audit coverage — every check FluxRadar runs | FluxRadar',
        description:
          'The full list of what FluxRadar inspects on a public website, the standards each module follows, how findings are evidenced and what FluxRadar will not certify.',
      },
      privacy: {
        title: 'Privacy policy | FluxRadar',
        description:
          'What FluxRadar collects, why it uses it, how connected Google data is handled, and how long anything is kept.',
      },
      terms: {
        title: 'Terms of service | FluxRadar',
        description:
          'The operating terms for using FluxRadar to review public websites and buy one-time audit reports.',
      },
      workspaceTitle: 'Workspace — FluxRadar',
    },
    workspace: {
      intro: 'Unified public site audit station.',
      sites: 'Site Profiles',
      registered: 'Registered public origins',
      noSites: 'No profiles yet',
      noSitesHelp:
        'Add your first profile to begin. Enter the homepage address of your site (like mysite.com) and FluxRadar saves it as a profile you can scan whenever you are ready.',
      addSite: 'Add profile',
      addSiteHelp:
        'A profile stores one site address and its audit history. FluxRadar reads only public pages — no passwords or CMS access — and saving does not start a scan or charge you.',
      displayName: 'Display name',
      displayNamePlaceholder: 'Product site',
      siteAddressLabel: 'Site address',
      siteAddressPlaceholder: 'mysite.com',
      siteAddressHint:
        'Enter your homepage domain, for example mysite.com. No CMS access or passwords needed.',
      siteAddressError:
        'That does not look like a site address. Enter your domain, like mysite.com.',
      saveProfile: 'Save profile',
      saving: 'Saving…',
      newScan: 'New scan',
      inspect: 'Inspect',
      notes: 'Operator notes',
      guide: 'Open setup guide',
      logOut: 'Log out',
      booting: 'Boot sequence',
    },
    siteStatus: {
      title: 'Site status',
      errorTitle: 'Site status could not be loaded',
      retry: 'Try again',
      emptyNoSites: 'No sites yet. Add one below and its first check appears here.',
      emptyNoChecks: 'No checks yet. Run the free homepage check and its result appears here.',
      coverageLink: 'See what a report covers',
      lastSite: 'Last checked',
      lastResult: 'Result',
      lastPlan: 'Plan',
      startedLabel: 'Started',
      finishedLabel: 'Finished',
      unknownTime: 'No time recorded',
      totalChecks: 'Reports listed',
      sitesSaved: 'Sites saved',
      googleLabel: 'Google data',
      googleNotLinked: 'Not linked',
      googleUnknown: 'Could not be read',
      googleSearchConsole: 'Search Console',
      googleAnalytics: 'Analytics',
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
          body: 'The bar at the top is the whole workspace. Profiles holds the public sites you saved as profiles, Scan starts an audit of one of them, and Reports keeps the finished results. Integrations is optional context — a public audit works without it, and FAQ answers what each check covers.',
        },
        'profile-domain': {
          title: 'Add your first profile',
          body: 'Enter the homepage address of a site anyone can open, like mysite.com. FluxRadar reads only public pages — it never needs a CMS password or source-code access.',
        },
        'save-profile': {
          title: 'Save the profile',
          body: 'The name is filled in from the address you entered, and you can rename it to anything you recognise. Saving only creates a reusable profile: it does not start a scan and it does not charge you.',
        },
        integrations: {
          title: 'Integrations are optional',
          body: 'The Integrations tab connects accounts you already own, such as Google Search Console or Analytics. Nothing there is required: every audit reads public pages only and works with no connection at all. Connecting one just adds the data that account holds — search performance, traffic — next to the results FluxRadar measures itself.',
        },
        'run-scan': {
          title: 'Start a scan when you are ready',
          body: 'To audit a saved site, open Scan from this bar (or New scan next to the site), pick Basic or Complete, review the crawl scope and press start. Nothing runs until you press it — this tour never starts a scan for you.',
        },
      }),
    },
    faq: faqCopyEn,
    checks: checksCopyEn,
    pricing: {
      publicOnly: 'Public pages only — no customer credentials required',
      included: 'What you get',
      bestFor: 'Best for',
      notIncluded: 'Not covered',
      limits: 'Limits',
      chooseBasic: 'Start with Basic',
      chooseComplete: 'Start with Complete',
      startInWorkspace:
        'You buy a report inside the workspace: pick a saved profile, choose Basic or Complete, and the scan starts once the payment provider confirms the payment.',
      freeNote:
        'There is also a free homepage check — title, meta description, headings and indexability of one page, once per account and once per site. It is a first look at the report format, not a third product.',
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
        tableCaption:
          'Basic and Complete side by side: the question each report answers, what it covers, what it leaves out and when to choose it.',
        aspect: 'What you are comparing',
        basicColumn: 'Basic',
        completeColumn: 'Complete',
        rows: {
          question: {
            label: 'The question it answers',
            basic: 'Why is my site not being found — in search, or in AI answers?',
            complete: 'What is wrong with this website, across everything we can read?',
          },
          included: {
            label: 'What is included',
            basic: 'The full SEO analysis — 16 checks — and AI crawler readiness.',
            complete:
              'Everything in Basic, plus security, accessibility, performance, reliability, privacy and content quality, with the Issue Center, scan history and JSON/CSV export.',
          },
          notIncluded: {
            label: 'What is not included',
            basic:
              'Security, accessibility, performance, reliability, privacy and content quality.',
            complete: 'Nothing FluxRadar can read is held back.',
          },
          chooseWhen: {
            label: 'Choose it when',
            basic: 'Being found is the question, and nothing else is urgent yet.',
            complete: 'A redesign, a launch, a handover or a client report is coming.',
          },
          price: {
            label: 'What you pay',
            basic: `${BASIC_PRICE}, once, for one scan of one website.`,
            complete: `${COMPLETE_PRICE}, once, for one scan of one website.`,
          },
          difference: {
            label: 'The difference in one line',
            basic: 'Depth on a single question: how your site is read.',
            complete: 'Every module FluxRadar runs, in one report.',
          },
        },
        footnote:
          'Both read public pages only, need no CMS password, and stay inside the crawl scope you set before the scan starts.',
      },
    },
    newScan: {
      windowTitle: 'New scan — scope and tariff',
      panelTarget: 'Target',
      labelProfile: 'Profile',
      hintProfile: 'Scans the site address saved on this profile, and reads its public pages only.',
      optionNewAddress: 'Another site address…',
      labelAddress: 'Site address',
      noAddress: 'Enter a site address',
      addressPlaceholder: 'mysite.com',
      hintAddress:
        'FluxRadar saves this address as a profile, so every report for the site stays in one place.',
      noProfilesLead:
        'No saved profiles yet — type the address you want checked and FluxRadar saves it as a profile for you.',
      prefillNote: 'Settings carried over from your last check of this site.',
      freeScopeTitle: 'What the free check does',
      freeScopeNote:
        'The free check reads your homepage and nothing else: the page title, the heading structure, the meta description, and whether search engines are allowed to index it.',
      freeScopeLocked:
        'Page limits, subdomains, path patterns, URL parameters and the AI visibility check belong to the paid plans and are not available on Free.',
      freeScopePages: 'Pages read',
      freeScopePagesValue: 'Homepage only',
      freeScopeRobots: 'robots.txt',
      freeScopeRobotsValue: 'Always respected',
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
      maxPagesError: 'Enter a whole number of pages, 1 or more, or leave it empty.',
      labelMaxDepth: 'Maximum crawl depth',
      maxDepthError: 'Enter a whole crawl depth, 0 or more, or leave it empty.',
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
      paidChecking: 'Checking whether paid reports can be bought here…',
      openingCheckout: 'Opening checkout…',
    },
    reports: {
      windowTitle: 'Reports',
      heading: 'Your audit reports',
      lead: 'Every check you have started, newest first. Open one to read its score, its findings and what to fix.',
      profileHeading: 'Reports for {name}',
      profileLead: 'Every check of {domain}, newest first.',
      showAll: 'Show all reports',
      refresh: 'Refresh',
      emptyTitle: 'No reports yet',
      emptyBody:
        'A report appears here as soon as you check one of your profiles. The free homepage check is a good place to start.',
      emptyProfileTitle: 'No reports for this profile yet',
      emptyProfileBody:
        'Nothing has been checked for this profile yet. Start a check and its report will appear here.',
      emptyAction: 'Check a profile',
      errorTitle: 'Your reports could not be loaded',
      retry: 'Try again',
      showMore: 'Show older reports',
      loadingMore: 'Loading…',
      showingCount: 'Showing {shown} of {total}.',
      openReport: 'Open report',
      followProgress: 'Follow progress',
      viewDetails: 'View details',
      startedAt: 'Started {time}',
      finishedAt: 'Finished {time}',
      planLabel: 'Plan',
      statusLabel: 'Result',
      profileLabel: 'Profile',
    },
    scanProgress: {
      windowTitle: 'Scan progress',
      noScanTitle: 'No check selected',
      noScanBody: 'Open one of your reports, or start a new check of a saved profile.',
      noScanAction: 'Go to reports',
      panelTitle: 'Checking your site',
      reviewing: 'We’re reviewing {domain} for you.',
      progressLabel: 'Audit progress',
      ready: 'Your report is ready.',
      finishedAt: 'Finished {time}.',
      finishedUnknown: 'The scan has finished processing.',
      running: 'Checking your site — {done} of {total} audit sections done.',
      sectionsTitle: 'What we’re checking',
      sectionsPreparing: 'Getting your checks ready…',
      sectionsLabel: 'Audit sections',
      openReport: 'Open report',
      cancel: 'Cancel scan',
      cancelling: 'Cancelling…',
      statusPartial: 'Your report is partially ready.',
      statusFailed: 'The scan could not finish.',
      statusCancelled: 'The scan was cancelled.',
      statusFinished: 'The scan has finished.',
      sectionChecking: 'Checking…',
      sectionPartial: 'Checked with limits',
      sectionChecked: 'Checked',
      sectionUnavailable: 'Not available',
      sectionWaiting: 'Waiting',
      moduleUnavailable: 'Unavailable',
      moduleInsufficient: 'Insufficient data',
      moduleCompleted: 'Completed',
    },
    report: {
      windowTitle: 'Report dashboard',
      loadingTitle: 'Report dashboard',
      emptyTitle: 'No report open',
      emptyBody: 'Pick one of your reports to read its score, its findings and what to fix first.',
      emptyAction: 'Go to reports',
      errorTitle: 'This report could not be opened',
      retry: 'Try again',
      // "Unified site signal" named nothing the product sells: the reader had no
      // way to tell it from a metric on the page below it. This is what the
      // screen is, in the words the rest of the product already uses — "audit"
      // from the coverage page and the plans, "report" from the reports list.
      // "Site", not "Website": a workspace surface never says Website (see
      // workspace-i18n.test.tsx), and "Site address" is the label directly
      // beneath this heading.
      signalHeading: 'Site audit report',
      detailsLabel: 'Report details',
      siteAddress: 'Site address',
      plan: 'Plan',
      report: 'Report',
      helpHeading: 'How to read this report',
      helpScoreTerm: 'Score',
      helpScoreBody:
        'A 0–100 rating for each area and for the site overall. Higher is better; a dash (—) means there was not enough public data to score it.',
      helpCoverageTerm: 'Coverage',
      helpCoverageBody: 'How much of your site FluxRadar was able to check for that area.',
      helpFindingsTerm: 'Findings',
      helpFindingsBody:
        'Specific issues we detected, each with the evidence behind it. Open the findings list below to review them and see recommended fixes.',
      noScore: 'No score',
      coverageUnavailable: 'coverage unavailable',
      accessibilityTitle: 'Accessibility · WCAG 2.2 AA',
      accessibilityBody:
        'Automated DOM/CSS checks are shown in this report. Keyboard flows, computed styles, focus visibility under overlays and runtime validation may require manual review.',
      accessibilityNote: 'FluxRadar does not provide legal accessibility certification.',
      accessibilityLabel: 'Accessibility audit scope',
      issuesCta:
        'The Issue Center lists every finding with its evidence and a recommended fix, so you can decide what to work on first.',
      openIssues: 'Open Issue Center',
      exportComplete: 'Export is reserved for Complete scans.',
      // A plan with no tariff score weights. The scoring engine answers
      // `insufficient_data` with a weighted coverage of 0 for it — the same
      // verdict a paid scan gets when it could not read the site — so a Free
      // report used to say "Insufficient data · coverage 0%" next to an SEO
      // section that had completed all four of its checks. These say the honest
      // thing instead: the check ran, and this plan carries no score.
      unscoredLabel: 'Not scored on this plan',
      unscoredChecks: '{completed}/{applicable} checks completed',
      unscoredChecksNone: 'homepage could not be read',
      unscoredLead:
        'The {plan} check runs a fixed set of homepage checks. The findings below are real, and each one carries its evidence.',
      unscoredScoreBody:
        'A 0–100 rating is part of the Basic and Complete scans. The {plan} check reports findings only, so this report shows a dash rather than a number nothing measured.',
      // What the plan did and did not look at. A section a plan never runs sends
      // no module row, so its absence is invisible on the cards above — an owner
      // reading a Free report cannot tell "we found nothing wrong with your
      // security" from "we never looked". Folded shut by default: it answers a
      // question, it is not the report.
      scopeSummary: 'What the {plan} check covered',
      scopeLead:
        'Every audit section below either ran in this report or belongs to a plan this check is not on.',
      scopeIncludedTerm: 'Ran in this report',
      scopeLockedTerm: 'Only on paid plans',
      scopeLockedNone: 'This plan runs every audit section FluxRadar offers.',
      scopeUnlock: 'Included in {plan}',
      scopeChecks: '{completed} of {applicable} checks',
    },
    issues: {
      windowTitle: 'Issue Center',
      noScan: 'no scan',
      heading: 'Findings and evidence',
      lead: 'Each finding is something FluxRadar detected on a public page. Use Details to see the evidence, the affected page and a recommended fix. The status you set is remembered on your next full scan.',
      filterLabel: 'Filter',
      filterPlaceholder: 'rule, module, URL',
      severityLegendTerm: 'Severity',
      severityLegendBody:
        'shows how urgent a finding is: Critical and High need attention first, then Medium, then Low.',
      emptyFiltered: 'No issues match this filter',
      emptyAll: 'No findings in this report',
      emptyAllBody: 'FluxRadar detected nothing worth reporting on the pages it could read.',
      columnSeverity: 'Severity',
      columnRule: 'Rule',
      columnTarget: 'Target',
      columnStatus: 'Status',
      columnAction: 'Action',
      details: 'Details',
      hideDetails: 'Hide details',
      closeDetails: 'Close details',
      evidence: 'Evidence',
      noExcerpt: 'No excerpt available',
      recommendation: 'Recommendation',
      impact: 'Impact',
      impactValue: '{affected}/{applicable} targets · score {delta}',
      confidence: 'Confidence',
    },
    integrations: {
      windowTitle: 'FluxRadar — Integrations',
      loadingTitle: 'Integrations',
      heading: 'Connected data sources',
      lead: 'Optional connections are managed here. Public-site checks continue to work without them.',
      refresh: 'Refresh',
      connectedNotice:
        'Google is connected. Choose which properties each profile reports on below.',
      errorNotice: 'The integration could not be connected.',
      readyToConnect: 'Ready to connect',
      connect: 'Connect',
      connecting: 'Opening…',
      disconnect: 'Disconnect',
      disconnecting: 'Disconnecting…',
      serverConfigured: 'Server configured',
      serverLimited: 'Limited mode',
      serverMissing: 'Needs server config',
      whyConnect: {
        google:
          'This connection puts what your own Google account already records — the searches people used to find you, and the visits each page received — beside the audit results. FluxRadar only reads that data; it changes nothing in Google and nothing on your pages.',
        bing: 'This connection shows how the same pages do in Bing search: the searches they appeared for and the clicks they got. It is read-only as well, so nothing in your Bing account is changed.',
      },
      google: {
        title: 'Google properties',
        readOnly:
          'FluxRadar only reads these properties — it never writes to Search Console or Analytics. They are two separate data sources: Search Console reports how the site performs in search, Analytics reports the traffic it receives.',
        notConnected:
          'Connect Google above to choose which Search Console property and which Analytics property each profile reports on.',
        profileLabel: 'Profile',
        searchConsoleLabel: 'Search Console property',
        analyticsLabel: 'Analytics property',
        notLinked: 'Not linked',
        loading: 'Loading Google properties…',
        save: 'Save selection',
        saving: 'Saving…',
        refresh: 'Refresh list',
        savedLinked: 'Saved. The next scan of this profile will include this Google data.',
        savedUnlinked: 'Google properties unlinked. Reports will not include Google data.',
        noBinding:
          'No property is linked to this profile yet, so reports will show Google data as not configured.',
        searchConsolePrefix: 'Search Console',
        analyticsPrefix: 'Analytics',
        loadFailed: 'Google properties could not be loaded. Refresh the list to try again.',
        saveFailed: 'The selection could not be saved. Try again in a moment.',
        emptyTitle: 'No profile to link yet',
        emptyBody:
          'Google is connected, but Google data is linked per profile. Create a profile first — manually, or from one of the Search Console properties this Google account can read.',
        emptyAction: 'Add profile',
        createHeading: 'Create profile from Search Console',
        createBody:
          'Each property below becomes a profile at its own site address and is linked to that Search Console property straight away. The connection stays read-only.',
        create: 'Create profile',
        creating: 'Creating…',
        createdLinked: 'Profile {name} was created and linked to {property}.',
        createdUnlinked:
          'Profile {name} was created, but the Search Console property could not be linked to it. Choose the property in the list below.',
        createInsecure:
          'This property is verified over http://. FluxRadar audits https sites only, so add the profile manually using its https address.',
        createUnsupported:
          'This property cannot be turned into a site address FluxRadar is able to audit. Add the profile manually instead.',
        createDuplicate:
          'A profile for this site address already exists. Select it above instead of creating another one.',
        createFailed:
          'The profile could not be created from this property. Try again, or add it manually.',
        noProperties:
          'This Google account has no Search Console property FluxRadar can read, so there is nothing to create a profile from yet.',
        analyticsOnlyNote:
          'An Analytics property on its own does not create a profile: it carries no site address to audit. Add the profile manually, then link its Analytics property here.',
      },
      policyTitle: 'Current policy',
      policyBody:
        'Google and Bing connections are read-only. FluxRadar requests no CMS credentials and never changes a client site. Public-site scans continue to work without either connection.',
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
      navigateGroup: 'Навігація',
      systemGroup: 'Система',
      descriptions: {
        profiles: 'Ваші збережені профілі та історія їхніх перевірок.',
        scan: 'Налаштуйте та запустіть нову перевірку.',
        reports: 'Готові та поточні результати перевірок.',
        integrations: 'Необовʼязкові підключення даних. Публічна перевірка працює без них.',
        faq: 'Прості відповіді про кожну перевірку та межі звіту.',
      },
    },
    legal: {
      kicker: 'FLUXLAB / ПУБЛІЧНИЙ ДОКУМЕНТ',
      meta: ['FLUXRADAR.NET', 'РЕД. 2026.09', 'ПРОЧИТАЙТЕ ПЕРЕД ПІДКЛЮЧЕННЯМ'],
      back: '← Назад до FluxRadar',
      contents: 'МАПА ДОКУМЕНТА',
      contentsLabel: 'Розділи документа',
      englishNotice: 'Цей документ ведеться англійською. Саме англійський текст є чинною версією.',
      footerBrand: 'FLUXRADAR / ВІД FLUXLAB',
      questions: 'Питання:',
      privacy: {
        title: 'Політика приватності',
        crossLink: 'Політика приватності →',
        lede: 'Простими словами про те, які дані збирає FluxRadar, навіщо їх використовує і як обробляються підключені дані Google.',
        sections: [
          { id: 'privacy-scope', label: 'Обсяг' },
          { id: 'privacy-data', label: 'Які дані ми обробляємо' },
          { id: 'privacy-google', label: 'Дані користувача Google' },
          { id: 'privacy-use', label: 'Як ми використовуємо дані' },
          { id: 'privacy-retention', label: 'Зберігання та видалення' },
          { id: 'privacy-rights', label: 'Ваші можливості' },
        ],
      },
      terms: {
        title: 'Умови користування',
        crossLink: 'Умови користування →',
        lede: 'Умови користування FluxRadar для перевірки публічних сайтів і купівлі разових звітів аудиту.',
        sections: [
          { id: 'terms-service', label: 'Сервіс' },
          { id: 'terms-account', label: 'Акаунти' },
          { id: 'terms-paid', label: 'Безкоштовні та платні перевірки' },
          { id: 'terms-use', label: 'Прийнятне використання' },
          { id: 'terms-results', label: 'Звіти та обмеження' },
          { id: 'terms-ending', label: 'Припинення користування' },
        ],
      },
    },
    seo: {
      home: {
        title: 'FluxRadar — аудит публічного сайту: SEO, AI-краулери, безпека та доступність',
        description:
          'FluxRadar перевіряє будь-який публічний сайт і показує те, що бачать пошукові системи, AI-краулери та люди: SEO, готовність до AI, заголовки безпеки, доступність, продуктивність і сигнали приватності. Два разові звіти, без підписки.',
      },
      faq: {
        title: 'Часті питання — що означає кожна перевірка FluxRadar | FluxRadar',
        description:
          'Прості відповіді про кожну перевірку FluxRadar: SEO, готовність до AI-краулерів, безпека, доступність, структуровані дані, приватність, продуктивність — і межі того, що може довести публічний аудит.',
      },
      checks: {
        title: 'Обсяг аудиту — усі перевірки FluxRadar | FluxRadar',
        description:
          'Повний перелік того, що FluxRadar перевіряє на публічному сайті, які стандарти використовує кожен модуль, як підтверджуються знахідки та чого FluxRadar не сертифікує.',
      },
      privacy: {
        title: 'Політика приватності | FluxRadar',
        description:
          'Які дані збирає FluxRadar, навіщо їх використовує, як обробляються підключені дані Google і скільки все це зберігається.',
      },
      terms: {
        title: 'Умови користування | FluxRadar',
        description:
          'Умови користування FluxRadar для перевірки публічних сайтів і купівлі разових звітів аудиту.',
      },
      workspaceTitle: 'Робочий простір — FluxRadar',
    },
    workspace: {
      intro: 'Єдина станція аудиту публічного сайту.',
      sites: 'Профілі сайтів',
      registered: 'Зареєстровані публічні джерела',
      noSites: 'Профілів ще немає',
      noSitesHelp:
        'Додайте перший профіль, щоб почати. Введіть адресу головної сторінки вашого сайту (наприклад, mysite.com) — FluxRadar збереже її як профіль, який можна перевірити будь-коли.',
      addSite: 'Додати профіль',
      addSiteHelp:
        'Профіль зберігає одну адресу сайту та історію його перевірок. FluxRadar читає лише публічні сторінки — без паролів і доступу до CMS — а збереження не запускає перевірку й не стягує оплату.',
      displayName: 'Назва',
      displayNamePlaceholder: 'Сайт продукту',
      siteAddressLabel: 'Адреса сайту',
      siteAddressPlaceholder: 'mysite.com',
      siteAddressHint:
        'Введіть домен головної сторінки, наприклад mysite.com. Доступ до CMS і паролі не потрібні.',
      siteAddressError: 'Це не схоже на адресу сайту. Введіть домен, наприклад mysite.com.',
      saveProfile: 'Зберегти профіль',
      saving: 'Збереження…',
      newScan: 'Нова перевірка',
      inspect: 'Переглянути',
      notes: 'Нотатки оператора',
      guide: 'Відкрити інструкцію',
      logOut: 'Вийти',
      booting: 'Завантаження',
    },
    siteStatus: {
      title: 'Стан сайтів',
      errorTitle: 'Не вдалося завантажити стан сайтів',
      retry: 'Спробувати ще раз',
      emptyNoSites: 'Сайтів ще немає. Додайте сайт нижче — і його перша перевірка з’явиться тут.',
      emptyNoChecks:
        'Перевірок ще немає. Запустіть безкоштовну перевірку головної — і результат з’явиться тут.',
      coverageLink: 'Подивитись, що охоплює звіт',
      lastSite: 'Остання перевірка',
      lastResult: 'Результат',
      lastPlan: 'Тариф',
      startedLabel: 'Розпочато',
      finishedLabel: 'Завершено',
      unknownTime: 'Час не записано',
      totalChecks: 'Звітів у списку',
      sitesSaved: 'Збережено сайтів',
      googleLabel: 'Дані Google',
      googleNotLinked: 'Не підключено',
      googleUnknown: 'Не вдалося прочитати',
      googleSearchConsole: 'Search Console',
      googleAnalytics: 'Analytics',
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
          body: 'Верхня панель — це весь робочий простір. «Профілі» — це публічні сайти, які ви зберегли, «Перевірка» запускає аудит одного з них, «Звіти» містять готові результати. «Інтеграції» — необовʼязковий контекст: публічний аудит працює й без них, а FAQ пояснює, що саме входить у кожну перевірку.',
        },
        'profile-domain': {
          title: 'Додайте перший профіль',
          body: 'Введіть адресу головної сторінки, яку може відкрити будь-хто, наприклад mysite.com. FluxRadar читає лише публічні сторінки — пароль до CMS або доступ до коду не потрібні.',
        },
        'save-profile': {
          title: 'Збережіть профіль',
          body: 'Назва підставляється з введеної адреси, і ви можете змінити її на будь-яку зрозумілу вам. Це лише створює багаторазовий профіль: перевірка не запускається й оплата не стягується.',
        },
        integrations: {
          title: 'Інтеграції — необовʼязкові',
          body: 'Вкладка «Інтеграції» підключає акаунти, які у вас уже є, наприклад Google Search Console чи Analytics. Нічого з цього не обовʼязкове: аудит читає лише публічні сторінки й працює взагалі без підключень. Підключення лише додає дані, які має той акаунт — пошукову ефективність, трафік — поруч із тим, що FluxRadar вимірює сам.',
        },
        'run-scan': {
          title: 'Запустіть перевірку, коли будете готові',
          body: 'Щоб перевірити збережений сайт, відкрийте «Перевірку» на цій панелі (або «Нову перевірку» біля сайту), оберіть Basic або Complete, перегляньте область обходу та натисніть запуск. Нічого не почнеться, доки ви не натиснете — цей огляд не запускає перевірку за вас.',
        },
      }),
    },
    faq: faqCopyUk,
    checks: checksCopyUk,
    pricing: {
      publicOnly: 'Лише публічні сторінки — облікові дані клієнта не потрібні',
      included: 'Що ви отримуєте',
      bestFor: 'Кому підходить',
      notIncluded: 'Не входить',
      limits: 'Обмеження',
      chooseBasic: 'Почати з Basic',
      chooseComplete: 'Почати з Complete',
      startInWorkspace:
        'Звіт купується в робочому просторі: оберіть збережений профіль, оберіть Basic або Complete — перевірка стартує, щойно платіжний провайдер підтвердить оплату.',
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
        tableCaption:
          'Basic і Complete поруч: на яке питання відповідає кожен звіт, що входить, що не входить і коли його брати.',
        aspect: 'Що порівнюємо',
        basicColumn: 'Basic',
        completeColumn: 'Complete',
        rows: {
          question: {
            label: 'На яке питання відповідає',
            basic: 'Чому мій сайт не знаходять — у пошуку чи у відповідях AI?',
            complete: 'Що не так із сайтом загалом — в усьому, що ми можемо прочитати?',
          },
          included: {
            label: 'Що входить',
            basic: 'Повний SEO-аналіз — 16 перевірок — і готовність до AI-роботів.',
            complete:
              'Усе з Basic, а також безпека, доступність, продуктивність, надійність, приватність і якість контенту — з Issue Center, історією перевірок та експортом JSON/CSV.',
          },
          notIncluded: {
            label: 'Що не входить',
            basic:
              'Безпека, доступність, продуктивність, надійність, приватність і якість контенту.',
            complete: 'Нічого з того, що FluxRadar уміє прочитати, не лишається поза звітом.',
          },
          chooseWhen: {
            label: 'Коли обирати',
            basic: 'Питання саме у видимості, а решта поки не термінова.',
            complete: 'Попереду редизайн, запуск, передача сайту або звіт для клієнта.',
          },
          price: {
            label: 'Скільки коштує',
            basic: `${BASIC_PRICE}, один раз, за одну перевірку одного сайту.`,
            complete: `${COMPLETE_PRICE}, один раз, за одну перевірку одного сайту.`,
          },
          difference: {
            label: 'Різниця в одному рядку',
            basic: 'Глибина в одному питанні: як читають ваш сайт.',
            complete: 'Усі модулі FluxRadar в одному звіті.',
          },
        },
        footnote:
          'Обидва читають лише публічні сторінки, не потребують пароля до CMS і працюють у межах області обходу, яку ви задаєте перед стартом.',
      },
    },
    newScan: {
      windowTitle: 'Нова перевірка — область і тариф',
      panelTarget: 'Ціль',
      labelProfile: 'Профіль',
      hintProfile:
        'Перевіряє адресу сайту, збережену в цьому профілі, і читає лише публічні сторінки.',
      optionNewAddress: 'Інша адреса сайту…',
      labelAddress: 'Адреса сайту',
      noAddress: 'Введіть адресу сайту',
      addressPlaceholder: 'mysite.com',
      hintAddress:
        'FluxRadar збереже цю адресу як профіль, щоб усі звіти для сайту були в одному місці.',
      noProfilesLead:
        'Збережених профілів ще немає — введіть адресу, яку треба перевірити, і FluxRadar збереже її як профіль.',
      prefillNote: 'Налаштування перенесено з вашої попередньої перевірки цього сайту.',
      freeScopeTitle: 'Що робить безкоштовна перевірка',
      freeScopeNote:
        'Безкоштовна перевірка читає лише головну сторінку: заголовок сторінки, структуру заголовків, meta description і чи дозволено пошуковим системам індексувати сторінку.',
      freeScopeLocked:
        'Ліміти сторінок, піддомени, шаблони шляхів, параметри URL і перевірка AI-видимості належать до платних тарифів і недоступні на Free.',
      freeScopePages: 'Прочитано сторінок',
      freeScopePagesValue: 'Лише головна',
      freeScopeRobots: 'robots.txt',
      freeScopeRobotsValue: 'Завжди дотримуємось',
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
      maxPagesError: 'Введіть ціле число сторінок — 1 або більше, або залиште поле порожнім.',
      labelMaxDepth: 'Максимальна глибина обходу',
      maxDepthError: 'Введіть цілу глибину обходу — 0 або більше, або залиште поле порожнім.',
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
      paidChecking: 'Перевіряємо, чи можна тут купити платні звіти…',
      openingCheckout: 'Відкриваємо оплату…',
    },
    reports: {
      windowTitle: 'Звіти',
      heading: 'Ваші звіти перевірок',
      lead: 'Усі перевірки, які ви запускали, найновіші вгорі. Відкрийте звіт, щоб побачити оцінку, знахідки та що виправити.',
      profileHeading: 'Звіти для {name}',
      profileLead: 'Усі перевірки сайту {domain}, найновіші вгорі.',
      showAll: 'Показати всі звіти',
      refresh: 'Оновити',
      emptyTitle: 'Звітів ще немає',
      emptyBody:
        'Звіт зʼявиться тут одразу після першої перевірки профілю. Почніть із безкоштовної перевірки головної сторінки.',
      emptyProfileTitle: 'Для цього профілю звітів ще немає',
      emptyProfileBody:
        'Цей профіль ще не перевіряли. Запустіть перевірку — і її звіт зʼявиться тут.',
      emptyAction: 'Перевірити профіль',
      errorTitle: 'Не вдалося завантажити ваші звіти',
      retry: 'Спробувати ще раз',
      showMore: 'Показати давніші звіти',
      loadingMore: 'Завантаження…',
      showingCount: 'Показано {shown} з {total}.',
      openReport: 'Відкрити звіт',
      followProgress: 'Стежити за перебігом',
      viewDetails: 'Переглянути деталі',
      startedAt: 'Початок: {time}',
      finishedAt: 'Завершено: {time}',
      planLabel: 'Тариф',
      statusLabel: 'Результат',
      profileLabel: 'Профіль',
    },
    scanProgress: {
      windowTitle: 'Перебіг перевірки',
      noScanTitle: 'Перевірку не вибрано',
      noScanBody:
        'Відкрийте один зі своїх звітів або запустіть нову перевірку збереженого профілю.',
      noScanAction: 'Перейти до звітів',
      panelTitle: 'Перевіряємо ваш сайт',
      reviewing: 'Ми переглядаємо {domain} для вас.',
      progressLabel: 'Перебіг аудиту',
      ready: 'Ваш звіт готовий.',
      finishedAt: 'Завершено: {time}.',
      finishedUnknown: 'Перевірку завершено.',
      running: 'Перевіряємо ваш сайт — готово {done} з {total} розділів аудиту.',
      sectionsTitle: 'Що ми перевіряємо',
      sectionsPreparing: 'Готуємо ваші перевірки…',
      sectionsLabel: 'Розділи аудиту',
      openReport: 'Відкрити звіт',
      cancel: 'Скасувати перевірку',
      cancelling: 'Скасовуємо…',
      statusPartial: 'Ваш звіт готовий частково.',
      statusFailed: 'Перевірку не вдалося завершити.',
      statusCancelled: 'Перевірку скасовано.',
      statusFinished: 'Перевірку завершено.',
      sectionChecking: 'Перевіряємо…',
      sectionPartial: 'Перевірено з обмеженнями',
      sectionChecked: 'Перевірено',
      sectionUnavailable: 'Недоступно',
      sectionWaiting: 'Очікує',
      moduleUnavailable: 'Недоступно',
      moduleInsufficient: 'Недостатньо даних',
      moduleCompleted: 'Завершено',
    },
    report: {
      windowTitle: 'Панель звіту',
      loadingTitle: 'Панель звіту',
      emptyTitle: 'Звіт не відкрито',
      emptyBody:
        'Виберіть один зі своїх звітів, щоб побачити оцінку, знахідки та що виправити першим.',
      emptyAction: 'Перейти до звітів',
      errorTitle: 'Не вдалося відкрити цей звіт',
      retry: 'Спробувати ще раз',
      signalHeading: 'Звіт аудиту сайту',
      detailsLabel: 'Деталі звіту',
      siteAddress: 'Адреса сайту',
      plan: 'Тариф',
      report: 'Звіт',
      helpHeading: 'Як читати цей звіт',
      helpScoreTerm: 'Оцінка',
      helpScoreBody:
        'Оцінка від 0 до 100 для кожної області та для сайту загалом. Більше — краще; риска (—) означає, що публічних даних для оцінки забракло.',
      helpCoverageTerm: 'Покриття',
      helpCoverageBody: 'Яку частину вашого сайту FluxRadar зміг перевірити в цій області.',
      helpFindingsTerm: 'Знахідки',
      helpFindingsBody:
        'Конкретні проблеми, які ми виявили, кожна з доказом. Відкрийте список знахідок нижче, щоб переглянути їх і побачити рекомендовані виправлення.',
      noScore: 'Без оцінки',
      coverageUnavailable: 'покриття недоступне',
      accessibilityTitle: 'Доступність · WCAG 2.2 AA',
      accessibilityBody:
        'У звіті показано автоматичні перевірки DOM/CSS. Клавіатурні сценарії, обчислені стилі, видимість фокуса під накладками та валідацію під час роботи може знадобитися перевірити вручну.',
      accessibilityNote: 'FluxRadar не надає юридичної сертифікації доступності.',
      accessibilityLabel: 'Межі аудиту доступності',
      issuesCta:
        'Центр проблем показує кожну знахідку з доказом і рекомендованим виправленням, щоб ви вирішили, з чого почати.',
      openIssues: 'Відкрити Центр проблем',
      exportComplete: 'Експорт доступний лише для тарифу Complete.',
      unscoredLabel: 'Цей тариф не оцінюється',
      unscoredChecks: 'виконано перевірок: {completed}/{applicable}',
      unscoredChecksNone: 'не вдалося прочитати головну сторінку',
      unscoredLead:
        'Перевірка {plan} виконує фіксований набір перевірок головної сторінки. Знахідки нижче справжні, і кожна має свій доказ.',
      unscoredScoreBody:
        'Оцінка 0–100 доступна в тарифах Basic і Complete. Перевірка {plan} показує лише знахідки, тому тут стоїть риска, а не число, якого ніхто не вимірював.',
      scopeSummary: 'Що охопила перевірка {plan}',
      scopeLead:
        'Кожен розділ аудиту нижче або виконувався в цьому звіті, або він належить до тарифу, за яким цю перевірку не запускали.',
      scopeIncludedTerm: 'Виконувалося в цьому звіті',
      scopeLockedTerm: 'Лише в платних тарифах',
      scopeLockedNone: 'Цей тариф виконує всі розділи аудиту, які пропонує FluxRadar.',
      scopeUnlock: 'Входить у тариф {plan}',
      scopeChecks: 'перевірок: {completed} з {applicable}',
    },
    issues: {
      windowTitle: 'Центр проблем',
      noScan: 'без перевірки',
      heading: 'Знахідки та докази',
      lead: 'Кожна знахідка — це те, що FluxRadar виявив на публічній сторінці. Натисніть «Деталі», щоб побачити доказ, сторінку та рекомендоване виправлення. Встановлений вами статус збережеться під час наступної повної перевірки.',
      filterLabel: 'Фільтр',
      filterPlaceholder: 'правило, модуль, URL',
      severityLegendTerm: 'Критичність',
      severityLegendBody:
        'показує, наскільки терміновою є знахідка: спершу Critical і High, далі Medium, потім Low.',
      emptyFiltered: 'Жодна знахідка не відповідає фільтру',
      emptyAll: 'У цьому звіті немає знахідок',
      emptyAllBody: 'FluxRadar не виявив нічого вартого уваги на сторінках, які зміг прочитати.',
      columnSeverity: 'Критичність',
      columnRule: 'Правило',
      columnTarget: 'Сторінка',
      columnStatus: 'Статус',
      columnAction: 'Дія',
      details: 'Деталі',
      hideDetails: 'Сховати деталі',
      closeDetails: 'Закрити деталі',
      evidence: 'Доказ',
      noExcerpt: 'Фрагмент недоступний',
      recommendation: 'Рекомендація',
      impact: 'Вплив',
      impactValue: '{affected}/{applicable} обʼєктів · оцінка {delta}',
      confidence: 'Впевненість',
    },
    integrations: {
      windowTitle: 'FluxRadar — Інтеграції',
      loadingTitle: 'Інтеграції',
      heading: 'Підключені джерела даних',
      lead: 'Тут керують необовʼязковими підключеннями. Перевірки публічного сайту працюють і без них.',
      refresh: 'Оновити',
      connectedNotice:
        'Google підключено. Нижче виберіть, за якими ресурсами звітує кожен профіль.',
      errorNotice: 'Не вдалося підключити інтеграцію.',
      readyToConnect: 'Готово до підключення',
      connect: 'Підключити',
      connecting: 'Відкриваємо…',
      disconnect: 'Відключити',
      disconnecting: 'Відключаємо…',
      serverConfigured: 'Налаштовано на сервері',
      serverLimited: 'Обмежений режим',
      serverMissing: 'Потрібне налаштування сервера',
      whyConnect: {
        google:
          'Це підключення показує поруч із результатами перевірки те, що вже фіксує ваш акаунт Google: за якими запитами вас знаходять і скільки відвідувань отримала кожна сторінка. FluxRadar лише читає ці дані — він нічого не змінює ні в Google, ні на ваших сторінках.',
        bing: 'Це підключення показує, як ті самі сторінки працюють у пошуку Bing: за якими запитами їх показували і скільки кліків вони отримали. Тут теж лише читання, тож у вашому акаунті Bing нічого не змінюється.',
      },
      google: {
        title: 'Ресурси Google',
        readOnly:
          'FluxRadar лише читає ці ресурси — він ніколи не записує дані в Search Console чи Analytics. Це два різні джерела даних: Search Console показує, як сайт працює в пошуку, Analytics — який трафік він отримує.',
        notConnected:
          'Підключіть Google вище, щоб обрати, який ресурс Search Console і який ресурс Analytics використовує кожен профіль.',
        profileLabel: 'Профіль',
        searchConsoleLabel: 'Ресурс Search Console',
        analyticsLabel: 'Ресурс Analytics',
        notLinked: 'Не звʼязано',
        loading: 'Завантажуємо ресурси Google…',
        save: 'Зберегти вибір',
        saving: 'Збереження…',
        refresh: 'Оновити список',
        savedLinked: 'Збережено. Наступна перевірка цього профілю включатиме ці дані Google.',
        savedUnlinked: 'Ресурси Google відʼєднано. Звіти не міститимуть даних Google.',
        noBinding:
          'З цим профілем ще не звʼязано жодного ресурсу, тому у звітах дані Google будуть позначені як не налаштовані.',
        searchConsolePrefix: 'Search Console',
        analyticsPrefix: 'Analytics',
        loadFailed: 'Не вдалося завантажити ресурси Google. Оновіть список, щоб спробувати ще раз.',
        saveFailed: 'Не вдалося зберегти вибір. Спробуйте за мить ще раз.',
        emptyTitle: 'Ще немає профілю для звʼязку',
        emptyBody:
          'Google підключено, але дані Google звʼязуються з окремим профілем. Спершу створіть профіль — вручну або з одного з ресурсів Search Console, які доступні цьому акаунту Google.',
        emptyAction: 'Додати профіль',
        createHeading: 'Створити профіль із Search Console',
        createBody:
          'Кожен ресурс нижче стає профілем зі своєю адресою сайту й одразу звʼязується з цим ресурсом Search Console. Підключення лишається лише для читання.',
        create: 'Створити профіль',
        creating: 'Створення…',
        createdLinked: 'Профіль {name} створено та звʼязано з {property}.',
        createdUnlinked:
          'Профіль {name} створено, але звʼязати з ним ресурс Search Console не вдалося. Оберіть ресурс у списку нижче.',
        createInsecure:
          'Цей ресурс підтверджено через http://. FluxRadar перевіряє лише https-сайти, тому додайте профіль вручну з його https-адресою.',
        createUnsupported:
          'Із цього ресурсу не вдається отримати адресу сайту, яку FluxRadar може перевірити. Додайте профіль вручну.',
        createDuplicate:
          'Профіль для цієї адреси сайту вже існує. Оберіть його вище замість створення ще одного.',
        createFailed:
          'Не вдалося створити профіль із цього ресурсу. Спробуйте ще раз або додайте його вручну.',
        noProperties:
          'У цього акаунта Google немає ресурсів Search Console, доступних FluxRadar, тому створювати профіль поки що немає з чого.',
        analyticsOnlyNote:
          'Ресурс Analytics сам собою не створює профіль: у ньому немає адреси сайту для перевірки. Додайте профіль вручну, а потім звʼяжіть із ним ресурс Analytics тут.',
      },
      policyTitle: 'Поточна політика',
      policyBody:
        'Підключення Google і Bing працюють лише на читання. FluxRadar не запитує доступів до CMS і ніколи не змінює сайт клієнта. Перевірки публічного сайту працюють без обох підключень.',
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
