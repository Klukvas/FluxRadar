// The English body of the public coverage page (/checks). Moved out of
// `checks-copy.ts` unchanged: see `checks-copy-sections.ts` for the shape every
// locale fills in, and edit the Ukrainian body in `checks-copy.uk.ts` in the
// same commit — a section that exists in one language and not the other is a
// type error.

import { SUPPORT_EMAIL } from './brand';
import { checksSections, type ChecksCopy } from './checks-copy-sections';

export const checksCopyEn: ChecksCopy = {
  kicker: 'FLUXRADAR / PUBLIC WEB AUDIT STATION',
  meta: ['Updated 2026-09-27', 'No login required to read this', 'Ruleset v0.1'],
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
        'The SEO module runs up to **21 deterministic checks** derived from documented search-engine guidance (Google Search Central, Bing Webmaster Guidelines, schema.org). All checks are rule-based; no model inference is involved.',
      ],
      bullets: [
        {
          term: 'Title tag',
          body: 'presence, character length (≤ 60 chars recommended), and uniqueness across crawled pages: a title another crawled page already uses is reported unless a `<link rel="canonical">` ties the two together.',
        },
        {
          term: 'Meta description',
          body: 'presence, recommended length window (120–158 chars), and uniqueness across crawled pages, judged the same way as the title.',
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
          term: 'Internal linking',
          body: 'pages the XML sitemap lists that no crawled page links to, and pages reachable through a single internal link. A link that redirects counts for the page it lands on.',
        },
        {
          term: 'Click depth',
          body: 'how many link hops separate a page from the entry URL, counted over the links the crawl read; four or more is reported.',
        },
        {
          term: 'When the three above are reported',
          body: 'only when the crawl finished reading the pages it set out to read. A crawl cut short by the page limit, a pause or a page that never answered cannot tell an unlinked page from an unread one, and each check then says so instead of guessing. A link the scan’s own scope excluded — another host, an excluded path, a hop past the depth limit — is not a gap: that page was never in scope to begin with.',
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
          body: 'whether a page carries at least 200 characters of visible text alongside a heading (`<h1>` or `<h2>`) and a content container (`<main>`, `<article>` or `<body>`) — the baseline an AI crawler needs to extract anything from the page. The readability score itself (Flesch Reading Ease for English, the Oborneva adaptation for Ukrainian) is measured and reported by the Content Quality module\'s "Readability score" check.',
        },
        {
          term: 'Provider visibility (paid, disclosed before purchase)',
          body: "on a paid audit the AI SEO module puts the same questions to Claude (Anthropic) and ChatGPT (OpenAI), each answering with its own web search enabled, and checks whether the answers mention your brand or cite your site; the report lists the sources each model used. Gemini (Google) and Perplexity are an opt-in extra chosen before purchase and receive nothing otherwise. This never runs in the free homepage check. Provider API calls are subject to the providers' own terms.",
        },
        {
          term: 'Visibility score per engine (paid, informational only)',
          body: 'each engine that answered gets a score out of 100 built from up to two signals: how often it mentioned your brand (**60%**) and how often it cited your domain (**40%**). The denominator for each is not the number of answers — it is the number of answers in which that signal could be **measured** at all. A question that already named your brand, or a profile whose brand is just its domain, proves nothing either way and is counted neither as a mention nor as a miss. A signal needs at least **2** measured answers before it counts toward the score; with only one signal there, the score is built from it alone; with neither there, the report shows the counts and says so instead of printing a number. This score is informational only: it is a snapshot of one run, it is never part of your overall audit score, and it is not a ranking.',
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
    content: {
      nav: 'Content quality',
      label: '06 / CONTENT QUALITY',
      title: 'Content quality — what FluxRadar checks',
      intro: [
        'The Content Quality module reads the text and media the page already serves. It judges what is measurably there — how much text, whether the media loads, whether another crawled page carries the same text — and never how good the writing is.',
      ],
      bullets: [
        {
          term: 'Duplicate page content',
          body: 'two crawled pages whose visible text is identical, character for character. A page whose `<link rel="canonical">` points at another page in the group is not reported: naming the canonical version is the fix, and the check passes over both the page that declares it and the page it names. Only exact matches are reported; near-duplicates are not.',
        },
        {
          term: 'Empty or low-value pages',
          body: 'visible body text under 200 characters, counted with script and style content excluded.',
        },
        {
          term: 'Broken images and media',
          body: 'referenced images, video and audio the crawl actually probed and found unreachable, returning an HTTP error, or answering with an HTML page instead of a file. Media the crawl never reached is not counted against the page.',
        },
        {
          term: 'Readability score',
          body: 'a page whose `<html lang>` declares English or Ukrainian (regional subtags like `en-GB` count), whose visible text has that language\'s script in at least 70% of its letters, and that carries at least 200 characters, 100 words and 5 sentences of it, gets a readability score on a 0–100 scale (higher is easier to read) — Flesch Reading Ease for English text; for Ukrainian text, the Oborneva adaptation of the same formula, calibrated on Russian and applied to Ukrainian as an approximation. It is flagged below 30 on either scale ("very confusing"). This is a mechanical measure of sentence and word length, not a judgement of the writing itself, and a page without a declared English or Ukrainian language, whose script does not clear that 70% bar, or with too little running prose to measure is not scored at all. The AI SEO / GEO section links here for the same score.',
        },
      ],
      outro: [],
    },
    privacy: {
      nav: 'Privacy & consent',
      label: '07 / PRIVACY & CONSENT',
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
      label: '08 / EVIDENCE',
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
        'The JSON and CSV export (Website Audit and Complete plans) contains the full raw evidence for every finding so you can reproduce the check independently.',
      ],
    },
    limits: {
      nav: 'What we cannot certify',
      label: '09 / LIMITATIONS',
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
