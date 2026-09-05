# FluxRadar — Final Independent Review
**Date:** 2026-09-05  
**Reviewer:** Claude (final pass)  
**Scope:** New Scan close behaviour · /blog routing · four blog articles (2 EN + 2 UK) · /checks page · build / tests / content sanity

---

## Summary

| Area | Status |
|------|--------|
| TypeScript typecheck | ✅ 0 errors |
| Frontend tests (Vitest) | ✅ 25/25 pass |
| Production build | ✅ clean |
| New Scan close behaviour | ✅ correct |
| /blog routing (nginx) | ✅ correct |
| Blog articles — canonical 4 | ✅ correct |
| Orphaned blog articles | ⚠️ → **fixed** |
| WCAG 2.2 / EN 301 549 wording | ⚠️ → **fixed** |
| SVG inline accessibility | ✅ correct |
| External links safety | ✅ no unsafe blank-target links |
| /checks route in SPA | ✅ correct |

---

## Commands Run

```
cd apps/web
npm run typecheck   # 0 errors
npm test -- --run   # 25 passed
npm run build       # ✓ built in ~143 ms
```

---

## Findings & Fixes

### HIGH — Orphaned blog articles exposed to indexing

**Problem:** Two Ukrainian-slug articles existed under `/public/blog/` that are **not linked** from the blog index (`/blog`) and were not part of the intended 2+2 article set:

- `public/blog/bezpeka-ta-dostupnist-publichnyy-skaner/index.html`
- `public/blog/tekhnichnyy-seo-publichnyy-audyt/index.html`

Both had `<link rel="canonical">` pointing to themselves (not to a preferred URL), making them fully crawlable duplicate-risk pages. The blog index links only to:
- `/blog/public-website-audit-checklist` (EN)
- `/blog/ai-crawler-readiness` (EN)
- `/blog/uk/tekhnichne-seo-audyt` (UK)
- `/blog/uk/pryvachnist-ta-cookie` (UK)

**Fix:** Added `<meta name="robots" content="noindex, follow" />` to both orphaned articles, immediately after their canonical `<link>`. The canonical URL is preserved so that if these pages are later promoted they require only removal of the noindex tag.

> **Residual risk:** If the intent was to promote these as the primary Ukrainian articles and retire the `/uk/` variants, the fix should instead be the reverse — noindex the `/uk/` paths and update the blog index links. Confirm with the content author which pair is canonical.

---

### MEDIUM — Inaccurate standards claim on /checks page

**Problem:** The `/checks` accessibility section stated:

> "WCAG 2.2 Level AA, which also satisfies the requirements of EN 301 549 (EU) and Section 508 (US federal)."

This is technically imprecise in two ways:
1. **WCAG 2.2 removed SC 4.1.1 (Parsing)**, which is still required by EN 301 549 and Section 508 based on WCAG 2.1 and WCAG 2.0 respectively — so WCAG 2.2 is not a strict superset of those standards' WCAG requirements.
2. **EN 301 549 has ~68 functional requirements** beyond the WCAG chapter (e.g. functional performance criteria, documentation, support services) that automated DOM scanning does not touch at all.

**Fix** (`apps/web/src/App.tsx` lines 997–998): Replaced with:

> "WCAG 2.2 Level AA. WCAG 2.2 AA is a superset of the WCAG chapters referenced by EN 301 549 (EU, chapter 9 references WCAG 2.1) and Section 508 (US federal, incorporates WCAG 2.0 AA). Note that both standards include non-WCAG functional requirements that automated DOM scanning does not cover."

---

### LOW — New Scan close behaviour (review only, no fix needed)

`NewScanScreen` is rendered when `screen === 'new-scan'` and receives `onClose={() => navigate('desktop')}`. The `Window` component receives `onClose` and renders a close button. Closing the dialog returns the user to the desktop screen — correct behaviour, no URL is changed. The pattern matches all other dialog screens (`IntegrationsScreen`, `OnboardingScreen`).

---

### LOW — /blog routing (review only, no fix needed)

`readInitialRoute()` does **not** intercept `/blog/*` paths — they fall through to the `home` screen. However, these URLs are served as static HTML files from `public/blog/` by nginx via `try_files $uri $uri/index.html /index.html`. This is intentional: the blog is fully static and does not render through the React SPA. The nginx config comment explains this explicitly.

---

### LOW — /checks SPA route (review only, no fix needed)

`readInitialRoute()` correctly maps `path === '/checks'` → `screen: 'checks'`. The checks content renders via React (`ChecksScreen`). The static `robots.txt` and `sitemap.xml` do not include `/checks`, which is correct since it is app-rendered content and needs authentication context to be useful.

---

### LOW — SVG accessibility (review only, no fix needed)

All four linked blog articles use one of two correct patterns:
- `<svg role="img" aria-labelledby="title-id desc-id">` with `<title id="...">` + `<desc id="...">` inside the SVG.
- `<figure role="img" aria-labelledby="title-id" aria-describedby="desc-id">` wrapping an SVG with matching `id` attributes on internal `<title>`/`<desc>`.

Both patterns expose accessible names and descriptions to assistive technology. No bare decorative SVGs without `aria-hidden`.

---

### LOW — External link safety (review only, no fix needed)

No `target="_blank"` external links found across any blog articles. All inter-page links are relative. No unsafe opener vulnerabilities.

---

### LOW — OWASP ASVS v4 chapter mappings (review only, acceptable)

The ASVS section of `/checks` maps checks to v4 chapters: 9.1 (TLS), 14.4 (HTTP headers), 3.4 (cookies), 14.3 (unintended disclosure), 14.2 (SRI). These map correctly to ASVS v4.0.3 chapter content and are appropriate for public-profile scanning.

---

## Files Changed

| File | Change |
|------|--------|
| `apps/web/public/blog/bezpeka-ta-dostupnist-publichnyy-skaner/index.html` | Added `<meta name="robots" content="noindex, follow" />` |
| `apps/web/public/blog/tekhnichnyy-seo-publichnyy-audyt/index.html` | Added `<meta name="robots" content="noindex, follow" />` |
| `apps/web/src/App.tsx` | Replaced imprecise WCAG 2.2 / EN 301 549 / Section 508 "satisfies" claim with accurate superset description |

No API, billing, OAuth, secrets, or unrelated readiness files were touched.

---

## Residual Risks

1. **Orphaned article ownership** — two extra Ukrainian articles exist. If they are intended as drafts for future promotion, the current noindex is the right choice. If they are superseded by the `/uk/` articles, they should eventually be deleted or 301-redirected.
2. **Sitemap** — `public/sitemap.xml` should be audited to confirm it only lists the four canonical blog articles and not the orphaned URLs. (Not changed in this pass; not in scope of failing build checks.)
3. **EN 301 549 v3.2.1 vs earlier versions** — if FluxRadar targets the 2021 edition specifically, the description could note "v3.2.1 (2021)". Currently the text omits the version, which is acceptable for marketing copy.

---

## Addendum — Sitemap Fix (HIGH)

The orphaned articles were also present in `public/sitemap.xml` under a comment saying "pre-existing, preserved, not featured in main index". A `noindex` meta tag without removing the URL from the sitemap sends contradictory signals to search engines (Google's guidance: remove noindex pages from sitemaps). 

**Fix:** Removed both orphaned URLs from `public/sitemap.xml`. The four canonical articles and the homepage + blog index remain.

**File changed:** `apps/web/public/sitemap.xml`
