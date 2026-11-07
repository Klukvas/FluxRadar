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
// Four event names exist here and no others: `pageview`, and the three product
// milestones in PLAUSIBLE_GOALS — `sign_up`, `free_check_requested`,
// `purchase`. The three are bare counters, which is the whole reason they are
// here: GA4 already reports the same milestones with parameters, but only for
// the visitors who accepted cookies, so its sign-up count is a fraction of the
// real one. A counter carries no props, no revenue and nothing about the
// person — only its name and the cleaned page it happened on, so the owner can
// read /ru against /uk without any of it being about a reader.
//
// What reaches Plausible is shaped here rather than left to the script's
// defaults, and for the same reasons as in `analytics.ts`:
// - Automatic page views are off (`autoCapturePageviews: false`). The app sends
//   one per screen itself, carrying the SAME cleaned address GA4 reports —
//   `analyticsPath`: no query string, scan ids collapsed to `/scans/:id`.
// - The approved campaign pair, and nothing else a query may hold, is appended
//   to the landing page view. Plausible reads `utm_*` out of the address it is
//   given, so a campaign has to travel there or not at all; `gclid` never does.
//   A counter carries no campaign: a visit's source is already settled by the
//   page view that opened it.
// - The referrer is cleaned before it is sent. The script reads
//   `document.referrer` by itself, which on a report page is a same-origin URL
//   with a scan id in it, so `transformRequest` replaces it with the cleaned
//   form — the same one GA4 gets from `analyticsReferrer`. A counter's address
//   is cleaned the same way, so neither a query string nor a scan id can ride
//   on the page a milestone is credited to.
// - Every automatic capture is off by name: `outboundLinks`, `fileDownloads`,
//   `formSubmissions`, `hashBasedRouting`. Those are dashboard settings that
//   Plausible COMPILES INTO the site's script, so nothing in this repository
//   can see whether they are on — the script served today has the first three
//   on — and an init option overrides the compiled config, which is why all
//   four are passed explicitly instead of left out. They are not cosmetic: an
//   outbound-link click reports `props.url`, which is `link.href` whole, query
//   string included. On a report page that is an audited customer's domain, and
//   on a mailed link it is a one-time token.
// - Nothing outside those four names is sent at all. `transformRequest` answers
//   null for every other event name and the tracker drops the request instead
//   of posting it. That is the backstop for the bullet above: a capture
//   switched on in the dashboard, now or in a year, still cannot post anything
//   from this app, because it would arrive under a name this allowlist does not
//   hold. Engagement is unaffected, for the reason the next paragraph gives.
// - A counter is rebuilt from a keep-list rather than cleaned field by field,
//   so the props slot is empty however it was filled. `customProperties` is a
//   dashboard setting too, and it attaches `p` to EVERY event including these
//   three; rebuilding drops it, and drops whatever field a later tracker
//   version adds, without this file having to learn its name first.
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

/**
 * The product milestones counted without consent, and the only custom event
 * names this app may send. Each one is a bare count: the name and the cleaned
 * page, never a parameter and never anything about the person who reached it.
 * The same three are reported to GA4 with parameters, where they are consent
 * gated and so count only part of the visitors.
 */
export const PLAUSIBLE_GOALS = ['sign_up', 'free_check_requested', 'purchase'] as const;

/** One of the three counters, by name: nothing else type-checks. */
export type PlausibleGoal = (typeof PLAUSIBLE_GOALS)[number];

/** Every event name that may leave this app; `transformRequest` drops the rest. */
const ALLOWED_EVENTS: readonly string[] = ['pageview', ...PLAUSIBLE_GOALS];

/**
 * The fields a counter keeps, by name, because they are how the request
 * travels rather than anything it says: the event name, the tracker's own
 * format version, the site domain, and the referrer — which is then cleaned
 * like a page view's. The address replaces itself with a cleaned one, and
 * everything else the tracker may have attached — `p` from a dashboard
 * `customProperties`, `$` from a revenue option, a field a later version
 * introduces — is simply not copied over.
 */
const COUNTER_KEPT_FIELDS = ['n', 'v', 'd', 'r'] as const;

/** Plausible's documented per-browser opt-out, read exactly as the tracker reads it. */
const IGNORE_KEY = 'plausible_ignore';

/** One event as the tracker is about to send it; only the fields we touch. */
interface PlausiblePayload {
  /** The event name: a page view, or one of PLAUSIBLE_GOALS. */
  n?: string;
  /** The page address. Ours already, from the `url` option both senders pass. */
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
 * Any address this app may report, reduced to what a dashboard needs: the
 * cleaned same-origin path, or a bare origin for anything else.
 *
 * `analyticsReferrer` is the same reduction GA4's referrer goes through, and it
 * is the right one for a counter's own page too — a scan id collapses to
 * `/scans/:id` and a reset token or a Creem signature in the query is gone.
 * Anything unparseable falls back to the current cleaned page rather than to
 * the raw value.
 */
function cleanAddress(value: unknown): string {
  if (typeof value !== 'string') return cleanLocation();
  return analyticsReferrer(value, window.location.origin) ?? cleanLocation();
}

/**
 * One counter as it is actually sent: its name, the transport fields, and the
 * cleaned page it happened on. Built field by field from a keep-list, so a
 * props or revenue slot the tracker filled is not carried over — see the
 * `customProperties` note in the header.
 */
function bareCounter(payload: PlausiblePayload): PlausiblePayload {
  const kept = Object.fromEntries(
    COUNTER_KEPT_FIELDS.filter((field) => payload[field] !== undefined).map((field) => [
      field,
      payload[field],
    ]),
  );
  return { ...kept, u: cleanAddress(payload.u) };
}

/**
 * The referrer the script reads from `document.referrer` on its own, reduced
 * before it leaves: on `/scans/<id>` it is a same-origin URL carrying a scan
 * id, and on a mailed link it carries the query the rest of this module exists
 * to strip. Cleaned into a copy, because the payload belongs to the tracker and
 * it goes on reading it after the hook returns.
 */
function withCleanReferrer(payload: PlausiblePayload): PlausiblePayload {
  if (typeof payload.r !== 'string' || payload.r === '') return payload;
  const referrer = analyticsReferrer(payload.r, window.location.origin);
  return { ...payload, r: referrer ?? null };
}

/**
 * Last stop before an event leaves the browser, and the only place that can
 * refuse one: a null answer makes the tracker drop the request unsent.
 *
 * Four names pass — a page view and the three counters in PLAUSIBLE_GOALS —
 * and everything else is refused by name rather than cleaned. Anything else
 * arriving here was captured automatically by the script: an outbound-link
 * click, a file download, a form submission. Those captures are configured in
 * the Plausible dashboard and baked into the script it serves, so they can
 * appear without a change to this repository, and the outbound one carries
 * `props.url`: the link's full href. A report page links out to the audited
 * site, so that single field would publish a paying customer's domain, and a
 * signed or tokenised link would publish the token. `startPlausible` also turns
 * all three off through `init`; this is the half that holds if one is ever
 * switched back on, and it holds for a capture Plausible has not invented yet,
 * because an allowlist refuses a name nobody here has heard of.
 *
 * A page view's address is already ours, set through the `url` option, so the
 * one field left to clean on it is the referrer. A counter is rebuilt instead,
 * so that whatever the tracker attached, what is posted is a bare +1 against
 * the cleaned page.
 */
function transformRequest(payload: PlausiblePayload): PlausiblePayload | null {
  const name = payload.n;
  if (typeof name !== 'string' || !ALLOWED_EVENTS.includes(name)) return null;
  return withCleanReferrer(name === 'pageview' ? payload : bareCounter(payload));
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

/**
 * Whether this browser is being counted at all — the one gate a page view and
 * a counter share, so neither can ever be sent under conditions the other is
 * held back by.
 *
 * `started` already carries the production-host check and the configured-script
 * check from `startPlausible`, which is what keeps every event out of tests,
 * `vite dev`, a preview host and a local Docker build. The opt-out flag is read
 * here as well as by the tracker: it is the documented way to refuse a
 * measurement the cookie banner deliberately does not gate, and a refusal is
 * worth holding in this file too rather than trusting a script that is served
 * by somebody else and compiled from settings this repository cannot see.
 * An unreadable storage is not a refusal — the tracker treats it the same way.
 */
function counting(): boolean {
  if (!started || !scriptLoaded) return false;
  try {
    return window.localStorage.getItem(IGNORE_KEY) !== 'true';
  } catch {
    return true;
  }
}

/** Call after every screen change; repeated calls for the same path are ignored. */
export function trackPlausiblePageView(): void {
  if (!counting()) return;
  const { pathname } = window.location;
  if (pathname === lastPathname) return;
  const url = pageViewUrl();
  window.plausible?.('pageview', { url });
  landingReported = true;
  lastPathname = pathname;
}

/**
 * Counts one product milestone: a bare +1 against the cleaned page it happened
 * on, with no parameter of any kind and nothing about the person who reached
 * it. GA4 reports the same three milestones with parameters, but only for the
 * visitors who accepted cookies; this is the count of everyone.
 *
 * Deliberately not consent gated, for the reason the whole module is not: there
 * is nothing to consent to. It is gated on exactly what a page view is gated on
 * (`counting`), it queues through the same stub when the tracker script has not
 * arrived yet, and it never throws — a counter that fails must not take a
 * registration, a check or a purchase down with it, and must not stop the GA4
 * call it stands beside.
 *
 * Reporting a milestone once is the caller's job, as it is for GA4, because
 * only the caller knows what "once" means for it. The difference is that a
 * caller's own guard must not be the GA4 one: `trackEvent` answers false
 * without consent, so a guard built on its answer would never close for a
 * visitor who refused cookies, and would count the same purchase on every poll.
 */
export function plausibleGoal(name: PlausibleGoal): void {
  if (!counting()) return;
  try {
    window.plausible?.(name, { url: cleanLocation() });
  } catch (error) {
    console.error('FluxRadar visit counter failed', error);
  }
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
