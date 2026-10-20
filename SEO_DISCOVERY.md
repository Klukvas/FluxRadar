# Public discovery and measurement

Public English pages use their existing bare paths. Ukrainian equivalents use
`/uk` and `/uk/<page>`. The web build prerenders the same React application and
metadata for all sixteen public documents; a validated page/locale marker chooses
hydration. Auth, checkout, workspace and legacy private hash entries use their
existing client flows. Public reading does not depend on the session endpoint.

The eight known public `?lang=uk` aliases redirect to their Ukrainian path only
when the literal parameter is unambiguous. Other query parameters are retained;
encoded or duplicate language keys and auth/checkout tokens are not migrated.
Canonical/hreflang tags and the sitemap use the new paths. Known public paths share nginx-style percent decoding, slash merging and dot-segment matching. This does not normalize workspace paths or classify malformed/above-root targets as public; nginx rejects an above-root target while preview retains its existing unknown-route fallback. Existing standalone
blog and knowledge-base content remains static HTML.

## Release verification

1. Build with Node 24 and the production API base. Serve the actual output with
   the repository nginx configuration; run `nginx -t` before testing it.
2. For each public path in `apps/web/src/public-page-routing.ts`, fetch EN and UK
   without executing JavaScript. Verify full text, H1, canonical, language,
   reciprocal alternates and useful real links. Check the same pages with a
   browser on desktop and mobile, with JavaScript disabled and enabled.
3. Verify zero hydration errors with consent absent/present, an opposite stored
   language, an example finding fragment and a failed/delayed session. Exercise
   language Back/Forward and the private sign-in, verification and reset flows.
4. Check the literal/ambiguous/encoded query redirect matrix against both nginx
   and Vite preview. Inspect GET and HEAD `X-Robots-Tag` on workspace paths after
   the SPA fallback; public pages must remain indexable.
5. Validate every changed internal URL/fragment and JSON-LD against visible
   content. Home offers describe digital audit Services at current prices, with
   no invented inventory, shipping, reviews or guarantees of rich results.
6. After a separately authorized deployment, repeat the raw HTTP/browser checks
   on the public host. Use Search Console URL Inspection and allow for report
   lag. A technically valid response does not prove indexing, rankings or AI
   citations. Requesting indexing or submitting a sitemap is a separate owner
   action, not part of this verification.

## Attribution contract

Existing GA4 consent, page views, funnel milestones and live checkout/purchase
reporting remain the measurement path. There are no extra funnel events or
checkout changes. Analytics starts only after allowance and only on the exact
production hostname; withdrawal disables it and clears its cookies.

Only these complete, case-sensitive UTM pairs become standard GA campaign fields:

| `utm_source` | `utm_medium` |
| ------------ | ------------ |
| `instagram`  | `social`     |
| `google`     | `organic`    |
| `bing`       | `organic`    |
| `chatgpt`    | `referral`   |
| `perplexity` | `referral`   |
| `claude`     | `referral`   |
| `newsletter` | `email`      |

The fixed alias `utm_source=chatgpt.com` maps to `chatgpt/referral` with no medium
or one explicit `utm_medium=referral`. Conflicting or duplicate parameters are
ignored. This is supported input, not a claim that every ChatGPT click carries
that tag. Unknown campaigns, names/content/terms, click IDs, domains entered into
forms, emails, scan IDs and raw query strings are not forwarded. No attribution
is persisted in application storage. The approved pair is read when the tag is
first activated after consent; stripping a query before consent can lose it.

Page locations remain query-free and scan IDs are normalized; external referrers are reduced to HTTP(S) origins and same-origin referrer queries are removed. Native organic/referral inference is left to GA when there is no
approved pair. An absent/hidden referrer or unknown tag cannot identify an AI
visit. Consent refusal, blocking, report lag and aggregation limit coverage.
Inspect actual vendor-tag requests with **all collection intercepted/aborted**
when testing: never send synthetic production analytics events.

## Finite measurement follow-up

Record a dated pre-release baseline privately, without property/account IDs. If the verified property exposes the Generative AI performance report, record its period, update date and Google AI feature impressions separately. Those impressions do not measure ChatGPT or Perplexity mentions, clicks or conversions; page-level rows are not additive site totals.
Compare the same Search Console search type, dates and dimensions after a useful
observation window: clicks, impressions, CTR, position and indexing exclusions
are different measures. Do not add page-level aggregates into site totals or
attribute a change to prerender alone. Newly published URLs may be absent from a
lagging snapshot. For GA, inspect consented landing/source sessions and the
existing funnel through confirmed live purchases; missing measured revenue does
not establish that no sale occurred. Keep business totals out of public articles
unless the owner separately approves publication.

This batch does not schedule monitoring, start paid scans, publish outreach or
invent third-party case studies. The public first-party case compares raw HTML
before the change with a local release candidate; search outcomes remain pending.

## Owner checkpoints over 90 days

- **Day 0:** record the private baseline and release timestamp; verify raw HTML,
  language/canonical parity and the existing consented funnel. Record which
  Search Console reports are lagging. No performance outcome is claimed yet.
- **Day 7:** manually inspect the homepage, checks, example and case URLs in
  Search Console. Separate newly discovered URLs from previously indexed ones;
  record fetch/indexing state and structured-data status after recrawl.
- **Day 30:** compare equal-duration periods and the same dimensions. Review
  relevant queries, landing pages and the existing funnel; record uncertainty
  from small samples and consent coverage. Choose one evidence-backed content
  improvement only after the owner approves it as a separate task.
- **Day 60:** repeat the comparison and review recurring questions. A real client
  case requires actual results, permission to publish, reproducible dates and
  scope. External research needs primary sources; testimonials and independent
  references require genuine participants and explicit permission. Do not use
  customer databases or contact anyone to fill these evidence gaps.
- **Day 90:** review the accumulated observations and decide with the owner
  whether to continue, change the hypothesis or stop. Report technical
  accessibility separately from search traffic, citations and sales.

These are manual owner checkpoints, not scheduled jobs, outreach, account writes
or permission to start another implementation/content batch.
