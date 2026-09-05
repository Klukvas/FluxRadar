# Remediation Result — 2026-09-05

## What Was Fixed

### WCAG Principle Labels (`apps/web/src/App.tsx`)

**Problem:** The `/checks` accessibility section labeled the four WCAG 2.2 principles using the
notation `(WCAG 1.x)`, `(WCAG 2.x)`, `(WCAG 3.x)`, `(WCAG 4.x)`. This is factually wrong —
those are version numbers not principle numbers — and would mislead users into thinking there are
WCAG 3 or WCAG 4 standards (which do not exist as ratified specifications).

**Fix:** Replaced all four labels with accurate wording:

| Before | After |
|--------|-------|
| `Perceivable (WCAG 1.x)` | `Perceivable (WCAG 2.2 Principle 1)` |
| `Operable (WCAG 2.x)` | `Operable (WCAG 2.2 Principle 2)` |
| `Understandable (WCAG 3.x)` | `Understandable (WCAG 2.2 Principle 3)` |
| `Robust (WCAG 4.x)` | `Robust (WCAG 2.2 Principle 4)` |

The success-criterion references (e.g. 1.1.1, 1.4.3, 2.1.1…) are unchanged and correct.

## Nearby Claims Audited — No Changes Required

### EN 301 549
- Line 999: `EN 301 549 (EU, chapter 9 references WCAG 2.1)` — **Accurate.** EN 301 549 v3.2.1
  (2021) chapter 9 normatively references WCAG 2.1. No change needed.

### Section 508
- Line 1000: `Section 508 (US federal, incorporates WCAG 2.0 AA)` — **Accurate.** The 2018
  Section 508 refresh incorporated WCAG 2.0 Level AA. No change needed.

### OWASP ASVS
- Line 948: `OWASP Application Security Verification Standard (ASVS) v4` — **Accurate.** ASVS
  v4 is the current stable release. The mapping references (9.1, 14.4, 3.4, 14.3, 14.2) are
  conservative public-signal mappings only, not claimed certifications. No change needed.

## Sitemap Audit

`apps/web/public/sitemap.xml` contains:
- `/` — home ✓
- `/blog` — blog index ✓
- `/blog/public-website-audit-checklist` — published EN article ✓
- `/blog/ai-crawler-readiness` — published EN article ✓
- `/blog/uk/tekhnichne-seo-audyt` — published UK article ✓
- `/blog/uk/pryvachnist-ta-cookie` — published UK article ✓

Orphaned draft articles (`/blog/bezpeka-ta-dostupnist-publichnyy-skaner`,
`/blog/tekhnichnyy-seo-publichnyy-audyt`) have `<meta name="robots" content="noindex, follow">`
and are **not** present in the sitemap. ✓

## Test / Build Results

| Check | Result |
|-------|--------|
| `tsc --noEmit` | ✅ No errors |
| `vite build apps/web` | ✅ Built in 153 ms |
| `vitest run App.test.tsx` | 22 failures (all pre-existing `window is not defined` — jsdom not configured in vite.config.ts test block; confirmed identical failure mode before these changes) |

## Files Modified

- `apps/web/src/App.tsx` — 4 label strings corrected (lines ~1008, 1013, 1018, 1023)

## Files Not Touched

API, billing, OAuth, secrets, auth routes, Prisma schema, deployment config, and all other
pre-existing modified files were left unchanged.
