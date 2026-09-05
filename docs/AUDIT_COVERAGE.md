# Audit coverage — maintainer reference

**Public URL:** `/checks`  
**Source:** `AuditCoverageScreen` in `apps/web/src/App.tsx`  
**Route type:** Static public SPA route — no authentication, no API calls.  
**Ruleset version reflected:** v0.1

---

## Purpose

The `/checks` page is the canonical, user-facing explanation of what FluxRadar audits, why, and what it cannot certify. It targets:

- Prospective customers who want to understand what a scan covers before purchasing.
- Existing customers who want to cite evidence for a finding.
- Compliance teams who need to understand the standards mapped.
- Maintainers who need a single source of truth for coverage claims.

---

## Routing architecture

| Layer | How `/checks` is handled |
|---|---|
| **React SPA** | `readInitialRoute()` maps `pathname === '/checks'` → `screen: 'checks'`. The boot API call is skipped (same guard as `/privacy` and `/terms`). |
| **navigate()** | `'checks'` is in the valid-screen allowlist. URL is set to `/checks` via `history.replaceState`. |
| **nginx (production)** | `try_files $uri $uri/index.html /index.html` — falls through to the SPA entry point correctly. No nginx change needed. |
| **Vite dev/preview** | Standard SPA fallback. No plugin change needed (only `/blog` subtree needs special handling). |

---

## Homepage discovery

Two entry points on the homepage (`HomeScreen`):

1. **Footer link** — `<a href="/checks">Audit coverage</a>` alongside Privacy policy / Terms / Blog.
2. **Coverage entry section** (`home__coverage-entry`) — between the capability grid and the workflow section. Contains a summary paragraph and a `→ Read the full audit coverage` CTA link.

---

## Content sections on `/checks`

| # | Section ID | Heading | Standards referenced |
|---|---|---|---|
| 00 | `checks-how` | What the scanner does | — |
| 01 | `checks-seo` | SEO — what FluxRadar checks | Google Search Central, Bing Webmaster Guidelines, schema.org |
| 02 | `checks-ai-seo` | AI SEO / Generative Engine Optimisation | llms.txt spec, schema.org entity types |
| 03 | `checks-security` | Security — OWASP ASVS public profile | OWASP ASVS v4 §3.4, §9.1, §14.2, §14.3, §14.4 |
| 04 | `checks-accessibility` | Accessibility — WCAG 2.2 AA / EN 301 549 / Section 508 | WCAG 2.2 AA, EN 301 549 v3.2.1, Section 508 |
| 05 | `checks-reliability` | Reliability and performance | — |
| 06 | `checks-privacy` | Privacy and consent signals | — |
| 07 | `checks-evidence` | How findings are evidenced | — |
| 08 | `checks-limits` | What FluxRadar cannot certify | — |

---

## Updating content

1. Open `apps/web/src/App.tsx` and find `function AuditCoverageScreen`.
2. Edit the relevant `<section id="checks-*">` element.
3. Update the "Updated" date in the `legal-meta` block at the top of the function.
4. Update this document's **Ruleset version** field if the rule set changes.
5. Run `pnpm --filter web test` and `pnpm --filter web build` before committing.

---

## What the page explicitly does NOT claim

- WCAG conformance certification (automated checks cover ~30–40 % of criteria).
- ASVS compliance (only public HTTP surface is checked; no authenticated/infra scope).
- GDPR / ePrivacy / CCPA legal compliance assessment.
- Active security testing (no fuzzing, injection, brute-force).
- Real-time or longitudinal data (results are a point-in-time snapshot).

---

## Tests

Focused tests live in `apps/web/src/App.test.tsx` under the describe block  
`'public /checks — audit coverage page'`.

Covered assertions:
- Page renders without any API call.
- All six audit module section headings are present.
- Evidence and limitations sections are present.
- Back-to-home link has `href="/"`.
- Homepage footer contains `href="/checks"`.
- Homepage coverage-entry section heading and CTA link are present.

Run: `pnpm --filter web test`
