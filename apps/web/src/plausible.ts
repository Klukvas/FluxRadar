// Consent-free page analytics for fluxradar.net (Plausible Cloud, EU).
//
// Beside the consent-gated GA4 in `analytics.ts`, which is untouched by this
// module. Plausible needs no cookie banner because it needs no cookie: it
// stores nothing on the device, and the only device state it touches at all is
// a READ of `localStorage.plausible_ignore`, the documented per-browser opt-out
// (https://plausible.io/docs/excluding-localstorage). So there is no consent
// gate here — only the same production-host check GA4 makes, which is also what
// keeps the tracker out of tests, `vite dev` and a local Docker build.
//
// What reaches Plausible is shaped here rather than left to the script's
// defaults, and for the same reasons as in `analytics.ts`:
// - Automatic page views are off (`autoCapturePageviews: false`). The app sends
//   one per screen itself, carrying the SAME cleaned address GA4 reports —
//   `analyticsPath`: no query string, scan ids collapsed to `/scans/:id`.
// - The approved campaign pair, and nothing else a query may hold, is appended
//   to the landing page view. Plausible reads `utm_*` out of the address it is
//   given, so a campaign has to travel there or not at all; `gclid` never does.
// - The referrer is cleaned before it is sent. The script reads
//   `document.referrer` by itself, which on a report page is a same-origin URL
//   with a scan id in it, so `transformRequest` replaces it with the cleaned
//   form — the same one GA4 gets from `analyticsReferrer`.
// - Every automatic capture is off by name: `outboundLinks`, `fileDownloads`,
//   `formSubmissions`, `hashBasedRouting`. Those are dashboard settings that
//   Plausible COMPILES INTO the site's script, so nothing in this repository
//   can see whether they are on — and an init option overrides the compiled
//   config, which is why all four are passed explicitly instead of left out.
//   They are not cosmetic: an outbound-link click reports `props.url`, which is
//   `link.href` whole, query string included. On a report page that is an
//   audited customer's domain, and on a mailed link it is a one-time token.
// - Nothing but a page view is sent at all. `transformRequest` answers null for
//   any other event name and the tracker drops the request instead of posting
//   it. That is the backstop for the bullet above: a capture switched on in the
//   dashboard, now or in a year, still cannot post anything from this app.
//   Engagement is unaffected, for the reason the next paragraph gives.
//
// Plausible's own engagement measurements need no help: the script attaches
// time-on-page and scroll depth to whatever address the last page view
// reported, so with manual page views they follow the cleaned address too, and
// a screen change flushes the previous screen's engagement before the new page
// view is sent. It reads that address out of the page view's payload AFTER
// `transformRequest` has returned it, and then posts each engagement directly
// without passing it through `transformRequest` again — so an engagement event
// carries the already-cleaned address and is not something the drop rule above
// can reach (plausible/analytics, tracker/src/track.js and
// tracker/src/engagement.js).

import { analyticsPath, analyticsReferrer, isAnalyticsHost } from './analytics';
import { approvedAttribution } from './analytics-attribution';
import {
  PLAUSIBLE_EVENT_PATH,
  PLAUSIBLE_SCRIPT_PATH,
  PLAUSIBLE_SITE_SCRIPT,
  plausibleConfigured,
} from './plausible-config';

export const PLAUSIBLE_SCRIPT_ID = 'fluxradar-plausible';

/** One event as the tracker is about to send it; only the fields we touch. */
interface PlausiblePayload {
  /** The event name. `pageview` is the only one this app ever sends. */
  n?: string;
  /** The page address. Ours already, from the `url` option on the page view. */
  u?: string;
  /** The referrer, which the script fills in from `document.referrer`. */
  r?: string | null;
  [key: string]: unknown;
}

interface PlausibleOptions {
  readonly endpoint: string;
  readonly autoCapturePageviews: boolean;
  readonly outboundLinks: boolean;
  readonly fileDownloads: boolean;
  readonly formSubmissions: boolean;
  readonly hashBasedRouting: boolean;
  /** Null means "do not send this event"; the tracker drops the request. */
  readonly transformRequest: (payload: PlausiblePayload) => PlausiblePayload | null;
}

interface PlausibleFunction {
  (event: string, options?: { readonly url?: string }): void;
  q?: unknown[];
  init?: (options?: PlausibleOptions) => void;
  o?: PlausibleOptions;
}

declare global {
  interface Window {
    plausible?: PlausibleFunction;
  }
}

let started = false;
let scriptLoaded = false;
let landingReported = false;
let landingCampaign: ReturnType<typeof approvedAttribution> = null;
let lastPathname: string | null = null;

/** The cleaned page, as every page view but a campaign landing reports it. */
function cleanLocation(): string {
  const { origin, pathname } = window.location;
  return `${origin}${analyticsPath(pathname)}`;
}

/**
 * The approved campaign pair as Plausible spells it.
 *
 * `approvedAttribution` validates the query against the fixed allowlist in
 * `analytics-attribution.ts` and answers with GA4's parameter names, so the two
 * tags credit a visit to exactly the same source and medium or to neither. An
 * unrecognised `utm_source` is not forwarded in either tag, and `gclid` is read
 * only for GA4 — Google Ads is the one thing it means and Plausible has no use
 * for it.
 */
function landingQuery(): string {
  if (landingCampaign === null) return '';
  const query = new URLSearchParams({
    utm_source: landingCampaign.campaign_source,
    utm_medium: landingCampaign.campaign_medium,
  });
  return `?${query.toString()}`;
}

/**
 * What this page view reports: the cleaned page, plus the approved campaign
 * pair when this is the view that opens the visit.
 *
 * Plausible takes a visit's source from the first event it sees, exactly as
 * GA4 does, so the campaign has to ride that one view. The pair is read at
 * start-up rather than here for the reason `captureLandingAttribution`
 * documents: an ad landing on a route the app no longer serves rewrites its own
 * address before the first page view is sent.
 */
function pageViewUrl(): string {
  const clean = cleanLocation();
  return landingReported ? clean : `${clean}${landingQuery()}`;
}

/**
 * Last stop before an event leaves the browser, and the only place that can
 * refuse one: a null answer makes the tracker drop the request unsent.
 *
 * A page view is the one event this app sends, so anything else arriving here
 * was captured automatically by the script — an outbound-link click, a file
 * download, a form submission — and is refused by name rather than cleaned.
 * Those captures are configured in the Plausible dashboard and baked into the
 * script it serves, so they can appear without a change to this repository, and
 * the outbound one carries `props.url`: the link's full href. A report page
 * links out to the audited site, so that single field would publish a paying
 * customer's domain, and a signed or tokenised link would publish the token.
 * `startPlausible` also turns all three off through `init`; this is the half
 * that holds if one is ever switched back on.
 *
 * For the page view that does pass, the address is already ours, set through
 * the `url` option, so the one field left to clean is the referrer the script
 * reads from `document.referrer` on its own: on `/scans/<id>` that is a
 * same-origin URL carrying a scan id, and on a mailed link it carries the query
 * the rest of this module exists to strip. `analyticsReferrer` reduces a
 * same-origin referrer to its cleaned path and anything external to its bare
 * origin, which is all either tag is told.
 */
function transformRequest(payload: PlausiblePayload): PlausiblePayload | null {
  if (payload.n !== 'pageview') return null;
  if (typeof payload.r !== 'string' || payload.r === '') return payload;
  const referrer = analyticsReferrer(payload.r, window.location.origin);
  return { ...payload, r: referrer ?? null };
}

/**
 * Plausible's own snippet, as the current docs write it, with one difference:
 * it is executed from this bundle instead of an inline `<script>`, because the
 * production CSP allows no inline script (see inline-script-policy.test.ts).
 * The stub queues whatever is called before the tracker arrives and keeps the
 * options for it in `plausible.o`; the tracker replays the queue on load.
 */
function loadScript(): void {
  if (scriptLoaded) return;
  scriptLoaded = true;
  const queueing: PlausibleFunction = function (...args: unknown[]) {
    (queueing.q ??= []).push(args);
  } as PlausibleFunction;
  const existing = window.plausible;
  const plausible = existing ?? queueing;
  plausible.init ??= (options?: PlausibleOptions) => {
    plausible.o = options;
  };
  window.plausible = plausible;
  plausible.init({
    endpoint: PLAUSIBLE_EVENT_PATH,
    autoCapturePageviews: false,
    // All four are dashboard settings compiled into the served script, and an
    // init option overrides that compiled config. Passed explicitly so turning
    // one on in Plausible cannot start sending link hrefs from this app.
    outboundLinks: false,
    fileDownloads: false,
    formSubmissions: false,
    hashBasedRouting: false,
    transformRequest,
  });
  const script = document.createElement('script');
  script.id = PLAUSIBLE_SCRIPT_ID;
  script.async = true;
  script.src = PLAUSIBLE_SCRIPT_PATH;
  document.head.appendChild(script);
}

/** Call after every screen change; repeated calls for the same path are ignored. */
export function trackPlausiblePageView(): void {
  if (!started || !scriptLoaded) return;
  const { pathname } = window.location;
  if (pathname === lastPathname) return;
  const url = pageViewUrl();
  window.plausible?.('pageview', { url });
  landingReported = true;
  lastPathname = pathname;
}

/**
 * Starts counting page views, on the production host and nowhere else.
 *
 * No consent is asked for and none is read: nothing is stored on the device, so
 * there is nothing for the banner to permit. Safe to call more than once.
 *
 * `siteScript` is the site's own script id and defaults to the one the build
 * ships. It is a parameter so the tests can exercise both a configured build
 * and the placeholder that switches the count off; nothing but a test passes
 * it.
 */
export function startPlausible(siteScript: string = PLAUSIBLE_SITE_SCRIPT): void {
  if (started) return;
  // An unconfigured build measures nothing rather than requesting a script that
  // does not exist yet (plausible-config.ts).
  if (!plausibleConfigured(siteScript)) return;
  if (!isAnalyticsHost()) return;
  started = true;
  landingCampaign = approvedAttribution(window.location.search);
  loadScript();
}

/** Test seam: forgets the tracker and this module's state so each test starts clean. */
export function resetPlausibleForTests(): void {
  started = false;
  scriptLoaded = false;
  landingReported = false;
  landingCampaign = null;
  lastPathname = null;
  delete window.plausible;
  document.getElementById(PLAUSIBLE_SCRIPT_ID)?.remove();
}
