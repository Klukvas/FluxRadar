// The English body of the public coverage page (/checks). Moved out of
// `checks-copy.ts` unchanged: see `checks-copy-sections.ts` for the shape every
// locale fills in, and edit the Ukrainian body in `checks-copy.uk.ts` in the
// same commit — a section that exists in one language and not the other is a
// type error.

import { SUPPORT_EMAIL } from './brand';
import { checksSections, type ChecksCopy } from './checks-copy-sections';

export const checksCopyEn: ChecksCopy = {
  kicker: 'FLUXRADAR / PUBLIC WEB AUDIT STATION',
  meta: ['Updated 2026-10-02', 'No login required to read this', 'Ruleset v0.1'],
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
          body: 'presence, length — reported below 10 or above 70 characters — and uniqueness across crawled pages: a title another crawled page already uses is reported unless a `<link rel="canonical">` ties the two together.',
        },
        {
          term: 'Meta description',
          body: 'presence, length — reported below 50 or above 160 characters — and uniqueness across crawled pages, judged the same way as the title.',
        },
        {
          term: 'Heading hierarchy',
          body: 'exactly one H1, and no level skipped on the way down (h1 → h3 with no h2 between them). Dropping back to a higher level is ordinary and is not reported.',
        },
        {
          term: 'Canonical URL',
          body: '`<link rel="canonical">` present, not duplicated, and pointing at the page itself.',
        },
        {
          term: 'Indexing signals',
          body: 'a `noindex` in meta robots or in an `X-Robots-Tag` header, reported only where the site contradicts itself — the page is in the sitemap, or other pages link to it. A deliberate `noindex` that nothing points at is the owner’s decision, not a finding. `nofollow` is not checked.',
        },
        {
          term: 'robots.txt',
          body: 'reachable at all. Only a missing or unreachable file is reported; the contents are not validated, because a crawler reads a robots.txt that does not answer 200 as “everything allowed”.',
        },
        {
          term: 'XML sitemap',
          body: 'a sitemap is found — through the robots.txt directives or at `/sitemap.xml` — and yields at least one URL. Unreachable, malformed and empty are one verdict at this level: the site offers no sitemap URLs.',
        },
        {
          term: 'Structured data / JSON-LD',
          body: 'every `<script type="application/ld+json">` block parses as JSON, and at least one block carries both an `@context` and a `@type`. Individual schema.org types and their required properties are not validated.',
        },
        {
          term: 'Social preview tags',
          body: '`og:title`, `og:description`, `og:image`, `og:url` and `twitter:card` present and non-empty in the served HTML. The image URL itself is not fetched.',
        },
        { term: 'Image alt text', body: 'meaningful images with no non-empty `alt` attribute.' },
        {
          term: 'Broken links',
          body: 'internal `href` values whose target the crawl actually fetched and found answering 4xx or 5xx. A link the crawl never followed — out of scope, past the page limit, closed by robots.txt — has no known status and is not judged.',
        },
        {
          term: 'Redirect chains',
          body: 'two or more hops before the final response, or a redirect cycle. A single 301 is ordinary canonicalisation and is not reported.',
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
          term: 'Mixed content',
          body: 'an `http://` script, stylesheet, image, iframe or icon embedded in an HTTPS page. Whether the site redirects HTTP to HTTPS is not checked separately.',
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
          body: '`robots.txt` is parsed for six AI crawler user-agent strings — GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended and Bytespider. Each is reported as allowed, blocked, or unknown when the site serves no `robots.txt` at all. What a crawler is permitted to do is the site’s policy, not evidence that it indexed or cited anything.',
        },
        {
          term: 'Social preview tags',
          body: 'how many crawled pages carry the complete set of preview tags (`og:title`, `og:description`, `og:image`, `og:url`, `twitter:card`) an AI system or a messenger reads to summarise a link. The same tags are checked per page by the SEO module.',
        },
        {
          term: 'Structured data for AI comprehension',
          body: 'how many crawled pages carry at least one JSON-LD block with both an `@context` and a `@type` — the minimum an AI system needs to read the page as an entity rather than as prose. Specific types (Organization, Product, FAQPage and so on) are not required or scored individually.',
        },
        {
          term: 'Content clarity signals',
          body: 'whether a page carries at least 200 characters of visible text alongside a heading (`<h1>` or `<h2>`) and a content container (`<main>`, `<article>` or `<body>`) — the baseline an AI crawler needs to extract anything from the page. The readability score itself (Flesch Reading Ease for English, the Oborneva adaptation for Ukrainian) is measured and reported by the Content Quality module\'s "Readability score" check.',
        },
        {
          term: 'Provider visibility (paid, disclosed before purchase)',
          body: "on a paid audit the AI SEO module puts the same questions to Claude (Anthropic) and ChatGPT (OpenAI) and checks whether the answers mention your brand or cite your site; the report lists the sources each model used. Discovery questions — the ones about your market — are answered with the model’s own web search enabled. The fixed direct questions about your brand are asked closed-book, with no search and no tools, so the answer shows what the model already knows rather than what it just read on your site. Gemini (Google) and Perplexity are an opt-in extra chosen before purchase and receive nothing otherwise. This never runs in the free homepage check. Provider API calls are subject to the providers' own terms.",
        },
        {
          term: 'Visibility score per engine (paid, informational only)',
          body: 'each engine that answered gets a score out of 100 built from up to two signals: how often it mentioned your brand (**60%**) and how often it cited your domain (**40%**). The denominator for each is not the number of answers — it is the number of answers in which that signal could be **measured** at all. A question that already named your brand, or a profile whose brand is just its domain, proves nothing either way and is counted neither as a mention nor as a miss. A signal needs at least **2** measured answers before it counts toward the score; with only one signal there, the score is built from it alone; with neither there, the report shows the counts and says so instead of printing a number. This score is informational only: it is a snapshot of one run, it is never part of your overall audit score, and it is not a ranking.',
        },
        {
          term: 'Share of voice (paid, informational only, optional)',
          body: "if you list up to 5 competitor names on your site profile, each engine's card also shows share of voice: your brand's mentions against each competitor's, over the same measurable answers the visibility score above already uses. Competitor names are matched against this scan's own stored answers on FluxRadar's servers only, and are never sent to an AI provider. With no competitors configured, the report shows a note instead of a share.",
        },
      ],
      outro: [],
    },
    security: {
      nav: 'Security',
      label: '03 / SECURITY',
      title: 'Security — OWASP ASVS public profile',
      intro: [
        'FluxRadar reads the **OWASP Application Security Verification Standard (ASVS) public profile**: the subset of ASVS signals observable in a public HTTP response. It does not attempt to exploit vulnerabilities, probe authenticated surfaces or run active attack techniques.',
        'These six checks are the whole Security module. A signal that is not on this list — the negotiated TLS version, DNS records, exposed files, directory listings, debug endpoints, secrets in client code, dependency versions — is not inspected, and the report says nothing about it either way.',
      ],
      bullets: [
        {
          term: 'HSTS',
          body: '`Strict-Transport-Security` present with a positive `max-age` on an HTTPS origin. A missing header, or `max-age=0`, is a finding; the rule does not require a particular `max-age` length or the `includeSubDomains` flag, and the TLS version itself is not inspected.',
        },
        {
          term: 'Baseline security headers',
          body: '`X-Content-Type-Options: nosniff`, framing protection (`X-Frame-Options` or a CSP `frame-ancestors` directive — either one is enough), and a non-empty `Referrer-Policy`. One finding per page, listing which of the three are missing.',
        },
        {
          term: 'Content-Security-Policy',
          body: 'the response carries a non-empty `Content-Security-Policy` header. Whether the policy is actually safe for every runtime path is not decided from outside.',
        },
        {
          term: 'Permissions-Policy',
          body: 'the response carries a non-empty `Permissions-Policy` header.',
        },
        {
          term: 'Cookie attributes',
          body: 'every cookie in a `Set-Cookie` header of a final response the crawl read — not just the homepage — is checked for `Secure`, `HttpOnly` and `SameSite`. The cookie’s value never appears in the evidence; it may be a secret.',
        },
        {
          term: 'Permissive CORS',
          body: '`Access-Control-Allow-Origin: *` combined with `Access-Control-Allow-Credentials: true` — a contradiction browsers refuse and servers should not state.',
        },
      ],
      outro: [
        'Findings are classified as signal present or signal absent — not as confirmed vulnerabilities. A missing header is evidence that a defensive control is not deployed, not proof that the site is exploitable.',
        'Mixed content is checked, but it is reported by the SEO module rather than here.',
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
          body: 'missing image alt text (1.1.1), and colour contrast below 4.5:1 for normal text or 3:1 for large text (1.4.3). Contrast is judged **only on a `color`/`background-color` pair written in an inline `style` attribute**: without a browser laying the page out, the effective colour from an external stylesheet cannot be computed, so those stay honest manual review rather than a false pass.',
        },
        {
          term: 'Operable (WCAG 2.2 Principle 2)',
          body: 'a positive `tabindex` or a mouse-only inline handler that puts keyboard access at risk (2.1.1), a focus outline removed with no visible replacement (2.4.7), and a link, button, `summary` or submit-like input with no usable accessible name (2.4.4, 4.1.2).',
        },
        {
          term: 'Understandable (WCAG 2.2 Principle 3)',
          body: '`<html lang>` present, and a heading outline with exactly one h1 and no skipped level (3.1.1, 1.3.1); form `<label>` elements properly associated (3.3.2); a control marked `aria-invalid` with no error description tied to it (3.3.1).',
        },
        {
          term: 'Robust (WCAG 2.2 Principle 4)',
          body: 'an unknown ARIA role, an ARIA attribute referencing an ID that does not exist, or focusable content hidden behind `aria-hidden` (4.1.2). Whole-document HTML validity and live-region announcements are not checked.',
        },
        {
          term: 'Assistive-technology landmarks',
          body: 'a `main` landmark, a name on repeated navigation, a `title` on every `iframe`, and captions declared for media. This is static DOM evidence of what a screen reader would have to work with — **no screen reader is run, and nothing about announcement quality is measured**.',
        },
      ],
      outro: [
        'Each accessibility finding includes the WCAG criterion reference, the failing element selector and the specific rule that was violated, so you can reproduce the finding without re-running the scan.',
        '**What automated checks cannot assess:** keyboard trap behaviour in dynamic widgets, screen-reader announcement quality, cognitive load, motion sensitivity in animations, auto-playing media, or compliance with criteria that require understanding content meaning (e.g. 1.3.3 Sensory Characteristics).',
      ],
    },
    reliability: {
      nav: 'Reliability & performance',
      label: '05 / RELIABILITY & PERFORMANCE',
      title: 'Reliability and performance',
      intro: [
        'Two different measurements share this section. **Reliability** is what FluxRadar’s own crawler observed while reading your pages. **Performance** is not measured by FluxRadar at all: it comes from Google **PageSpeed Insights** (a Lighthouse run on Google’s infrastructure) for lab metrics and from the **Chrome UX Report (CrUX)** for field data from real Chrome users.',
        'The lab sample is bounded on purpose: up to **5 URLs**, chosen to cover different page templates, on **2 emulated devices**, measured **twice** each. The median of the two runs is reported, and the spread between them is published beside it, so you can tell “this page takes 3.1 s” from “this page took 1.4 s and then 4.8 s”. A metric the provider did not measure produces no finding at all — not a passing one and not a failing one.',
      ],
      bullets: [
        {
          term: 'Core Web Vitals',
          body: 'LCP, CLS and Total Blocking Time from the lab run; INP and LCP from CrUX field data where your origin has enough traffic for Chrome to report it. INP cannot be measured in a lab run at all and is only ever field data.',
        },
        {
          term: 'Server response time (TTFB)',
          body: 'two separate readings. In the lab run, TTFB above 0.80 s needs improvement and above 1.80 s is poor. Independently, the crawler reports any page of your own site that took longer than 1.8 s to answer it.',
        },
        {
          term: 'Page weight and requests',
          body: 'total transfer size against a 2 MB budget and request count against a budget of 80, both from the Lighthouse run.',
        },
        {
          term: 'Resource opportunities',
          body: 'unused JavaScript, missing text compression, and image savings Lighthouse can quantify, reported only above a floor worth acting on.',
        },
        {
          term: 'Caching and render blocking',
          body: 'static assets with a short or missing cache lifetime, and render-blocking resources that delay first paint by a measurable amount.',
        },
        {
          term: 'Measurement stability',
          body: 'when the two runs of one URL disagree by more than 40% of their median, the verdict is published as unstable rather than as a number to act on.',
        },
        {
          term: 'Uptime signal',
          body: 'the HTTP status of every URL in scope. 5xx responses, connection failures and timeouts are reported as reliability findings.',
        },
        {
          term: 'API endpoints you list',
          body: 'public `GET` / `HEAD` / `OPTIONS` endpoints you add by hand are called once and judged against the status you said to expect — an expected 404 or 503 passes, an unexpected one does not. Credentials are refused: an endpoint whose configured headers carry an `Authorization`, `Cookie` or API key is not called at all, and the report says so.',
        },
      ],
      outro: [
        'Performance findings never change the Performance score. That score is Lighthouse’s own, which already accounts for these metrics; subtracting again for the same slow LCP would penalise it twice. The findings say what to do about the score, they do not restate it.',
      ],
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
          body: 'a page whose `<html lang>` declares English or Ukrainian (regional subtags like `en-GB` count) and that carries at least 200 characters of visible text gets a readability score on a 0–100 scale (higher is easier to read) — Flesch Reading Ease for English text; for Ukrainian text, the Oborneva adaptation of the same formula, calibrated on Russian and applied to Ukrainian as an approximation. Readability is measured over paragraph text (`<p>`, `<blockquote>` and `<dd>` elements, outside navigation, lists and tables) that has this language\'s script in at least 70% of its letters; a page needs at least 5 sentences and 100 words of that paragraph text to be scored. It is flagged below 30 on either scale ("very confusing"). This is a mechanical measure of sentence and word length, not a judgement of the writing itself, and a page without a declared English or Ukrainian language, whose paragraph text\'s script does not clear that 70% bar, or whose copy is not laid out in paragraph elements at all (some page builders) is not scored. The AI SEO / GEO section links here for the same score.',
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
          term: 'Consent signal',
          body: 'a recognisable tracker loaded in the served HTML (Google Analytics, Tag Manager, Meta, DoubleClick, Hotjar, Clarity, Segment, Plausible, Matomo) with no consent marker anywhere in that HTML — a consent-platform signature such as OneTrust, Cookiebot, Didomi, Usercentrics or TrustArc, or the words “cookie” / “consent”. This is a static signal only: a banner that appears after the page’s JavaScript runs, and whether consent is legally valid in your jurisdiction, both need a browser or a lawyer, not this check.',
        },
        {
          term: 'Cookie inventory',
          body: 'cookies the page sets, from the `Set-Cookie` headers of its final response and from `document.cookie` assignments in inline scripts. The report lists the cookie names and where each came from; values are never recorded, because a value may be a secret. Whether a cookie carries `Secure`, `HttpOnly` and `SameSite` is reported by the Security module.',
        },
        {
          term: 'Third-party scripts',
          body: 'the external hostnames a page loads `<script src>` from, listed in full. A subdomain of your own site is not third-party. The domains are inventoried, not classified: FluxRadar does not label one as advertising and another as fingerprinting.',
        },
        {
          term: 'Privacy policy discoverability',
          body: 'the homepage carries a same-site link whose text or destination identifies a privacy or cookie policy.',
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
