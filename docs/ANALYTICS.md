# Site analytics (Google Analytics 4)

FluxRadar's own visitor statistics for fluxradar.net. This is unrelated to the
Google Search Console / Analytics data customers connect to their reports.

## What runs, and when

| | |
| --- | --- |
| Property | `FluxRadar` (`p555045594`), web stream `FluxRadar web` |
| Measurement ID | `G-0N0B548CGE` — `apps/web/src/analytics-config.ts`, copied in `apps/web/public/blog/blog.js` |
| Loads | Only after the visitor ticks **Analytics** or chooses **Allow all** in the cookie banner, and only on `fluxradar.net` |
| Code | `apps/web/src/analytics.ts` (app), the Analytics block in `apps/web/public/blog/blog.js` (static blog) |

Before consent the browser makes no request to Google at all — gtag.js is not
even fetched. Withdrawing consent sets gtag's `ga-disable-<id>` flag and deletes
the `_ga` and `_ga_0N0B548CGE` cookies. The cookies are given the consent's own
lifetime (180 days) instead of GA's two-year default.

The consent record is `fluxradar.cookieConsent` version `v2`
(`apps/web/src/browser-consent.ts`). A `v1` record predates the analytics
category, so it does not count as a choice and the banner asks again — but the
language permission it gave is honoured until it expires.

`localhost`, previews and a local Docker build never report, even after
"Allow all": `ANALYTICS_HOSTNAME` gates the whole module.

## What is sent

Page views are sent by the app, not by GA's history listener, so every page
location is cleaned first:

- no query string — password-reset (`?reset_token=`) and email-verification
  (`?verify_email=`) links carry one-time secrets there;
- scan ids collapse to `/scans/:id`, `/scans/:id/issues`, `/scans/:id/report`;
- scan screens are titled `FluxRadar scan` — the printable report puts the
  audited domain in `document.title`, and gtag would attach it to every hit.

Product events, all GA4 recommended names where one exists:

| Event | Where | Parameters |
| --- | --- | --- |
| `sign_up` / `login` | `AuthScreen.tsx`, after the account is created or signed in | `method: 'email'` |
| `free_scan_started` | `new-scan-form.ts`, after the free check is accepted | — |
| `begin_checkout` | `new-scan-form.ts`, after the checkout session is created | `currency`, `value`, `items` |
| `purchase` | `Checkout.tsx`, when the server confirms the order | `transaction_id` (purchase id), `currency`, `value`, `items` |
| `scan_completed` | `ScanProgress.tsx`, when a watched scan finishes | `plan`, `status` |

`begin_checkout` and `purchase` are sent only when the store is in **live**
mode (`checkout-analytics.ts`): a test-card order sent to GA becomes revenue
that can never be removed from the property. No email, domain, URL of an
audited site or user id is ever sent.

## Property settings the code relies on

Set in the GA admin on 2026-09-21. If any of the first four is changed, the
Cookie Policy and Privacy Policy stop being true.

- **Data retention**: event data 2 months, user data 2 months.
- **Google signals**: off. **User-provided data collection**: off.
- **Ads personalization**: disallowed in all regions. No Google Ads link.
- **Enhanced measurement**:
  - *Page changes based on browser history events*: **off** — the app sends
    cleaned page views itself; GA's own would carry the raw URL.
  - *Outbound clicks* and *File downloads*: **off** — report pages link to the
    audited site, and those links would send the customer's URLs to Google.
  - Scrolls, site search, form interactions, video engagement: on (they carry
    the cleaned page location).
- **Redact data**: email on; URL query keys `reset_token`, `verify_email`,
  `token`, `code`, `state`, `email` — a second line behind the code's cleaning.
- **Unwanted referrals**: `accounts.google.com` (the Google OAuth return).
  Bing is deliberately not listed: excluding `bing.com` would also drop real
  Bing search traffic.
- **Key events**: `purchase` (GA marks it by default). GA only lists an event
  after it has been received, so `sign_up`, `free_scan_started` and
  `begin_checkout` are starred under Admin → Events → *Recent events* once the
  first ones arrive after the deploy.

## Content Security Policy

gtag.js comes from exactly `https://www.googletagmanager.com` (`script-src`);
hits go to Google's regional collection hosts (`connect-src`, and `img-src` for
the beacon fallback). DEPLOY-008 pins all of it — see "Content Security Policy"
in [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Checking it after a deploy

1. Open fluxradar.net in a private window, tick **Analytics**, **Save choice**.
2. GA → Reports → **Realtime**: the visit shows up within a minute.
3. Another private window, **Only necessary**, DevTools → Network: no request
   to `googletagmanager.com` or `google-analytics.com`.
