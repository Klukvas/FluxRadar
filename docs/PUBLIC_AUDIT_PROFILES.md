# FluxRadar public audit profiles

All profiles in this release inspect a public URL through HTTP response data and
static HTML. The customer supplies no Google, Cloudflare, WordPress, CMS, or AI
provider token. FluxRadar account authentication is unrelated to target-site
credentials.

## Included profiles

### Accessibility

The Accessibility module reports WCAG 2.2 AA automated/static evidence and maps
the same evidence to EN 301 549 and Section 508 labels. It is not a legal
conformance certificate. Keyboard flows, computed styles, viewport geometry,
screen-reader output, runtime DOM, and authenticated flows remain manual-review
boundaries.

### Security

The Security module includes an OWASP ASVS Public Security Profile: response
headers, HSTS/cookies, CSP, Permissions-Policy and contradictory wildcard CORS
credentials. OWASP ASVS requirements that need source code, authentication,
server configuration, secrets, or internal network access are reported as
outside the public-only boundary rather than guessed.

### SEO discovery

SEO checks static JSON-LD syntax/completeness plus Open Graph and Twitter Card
preview fields (including a stable `og:url`). Missing JSON-LD is not automatically a failure because a CMS
may inject it after JavaScript executes; browser-rendered validation remains a
separate future runner.

### Privacy & Consent

Privacy checks cookies, third-party scripts, recognizable static consent signals,
and homepage discoverability of a privacy/cookie policy. These are technical
signals only and are not legal advice or a jurisdiction-specific compliance
determination.

### AI crawler readiness

AI SEO/GEO stores a public readiness report alongside provider-backed visibility:
robots policy for common AI agents, extractable page content, structured data,
and social preview coverage. This report does not require an AI provider token;
provider visibility remains a separate consent-gated capability.
