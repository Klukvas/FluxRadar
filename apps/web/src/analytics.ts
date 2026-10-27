// Consent-gated Google Analytics 4 for fluxradar.net.
//
// Nothing here runs until the visitor allows the analytics category: gtag.js is
// not even requested before that, which is what the Cookie Policy promises. The
// tag is added as an external script from GA_SCRIPT_ORIGIN because the
// production CSP allows no inline script (see inline-script-policy.test.ts).
//
// What reaches Google is shaped here rather than left to gtag's defaults:
// - Page views are sent by the app, not by GA's history listener, so each one
//   carries a cleaned location: no query string (password-reset and
//   email-verification links put one-time tokens there) and no scan ids. The
//   one exception is the Google Ads click id on the hit that opens the visit —
//   see `landingLocation`.
// - Every hit carries a cleaned title too. The printable report puts the
//   customer's audited domain in `document.title`, and gtag would otherwise
//   attach it to every scroll or engagement event on that page.
// - Signals and ad personalisation are off in the tag as well as in the
//   property, and the `_ga` cookies end with the consent that allowed them.

import { approvedAttribution, approvedClickId } from './analytics-attribution';
import { ANALYTICS_HOSTNAME, GA_MEASUREMENT_ID, GA_SCRIPT_ORIGIN } from './analytics-config';
import {
  COOKIE_CONSENT_CHANGE_EVENT,
  COOKIE_CONSENT_KEY,
  COOKIE_CONSENT_TTL_MS,
  analyticsAllowed,
} from './browser-consent';

export const GA_SCRIPT_ID = 'fluxradar-ga';

/** gtag's own flag for "stop sending": set on withdrawal, cleared on a new allowance. */
const DISABLE_FLAG = `ga-disable-${GA_MEASUREMENT_ID}`;

const SCAN_PATH = /^\/scans\/[^/]+/;
const SCAN_PAGE_TITLE = 'FluxRadar scan';

export type AnalyticsParams = Readonly<
  Record<string, string | number | boolean | readonly Readonly<Record<string, string | number>>[]>
>;

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

let started = false;
let active = false;
let tagLoaded = false;
let landingReported = false;
let landingClickId: string | null = null;
let landingCampaign: ReturnType<typeof approvedAttribution> = null;
let lastPathname: string | null = null;
let lastLocation: string | null = null;

// gtag.js only reads dataLayer entries that are `arguments` objects; an array
// built from a rest parameter is silently ignored. Google's own snippet is
// written this way for the same reason.
const gtag: (...args: unknown[]) => void = function () {
  // eslint-disable-next-line prefer-rest-params
  (window.dataLayer ??= []).push(arguments);
};

export function isAnalyticsHost(hostname: string = window.location.hostname): boolean {
  return hostname === ANALYTICS_HOSTNAME;
}

/** The path as reported: scan ids collapse into one page per screen. */
export function analyticsPath(pathname: string): string {
  return pathname.replace(SCAN_PATH, '/scans/:id');
}

/** External referrers need only an HTTP(S) origin; private paths never leave the browser. */
export function analyticsReferrer(referrer: string, origin: string): string | undefined {
  try {
    const url = new URL(referrer);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    const path = url.origin === origin ? analyticsPath(url.pathname) : '/';
    return `${url.origin}${path}`;
  } catch {
    return undefined;
  }
}

function analyticsTitle(pathname: string): string {
  return SCAN_PATH.test(pathname) ? SCAN_PAGE_TITLE : document.title;
}

/** The cleaned page, as every hit but the first one of a visit reports it. */
function cleanLocation(): string {
  const { origin, pathname } = window.location;
  return `${origin}${analyticsPath(pathname)}`;
}

/**
 * What the address said when this visit opened: the Google Ads click id and the
 * approved campaign pair, read there and not when the hit that carries each one
 * is sent. An ad landing on a route the app no longer serves rewrites its own
 * address first — `/plans` lands on the home page (HomeScreen.tsx) — and that
 * effect runs before the first page view, and before a first-time visitor has
 * answered the banner, so a send-time read would drop the campaign and the id
 * of the very click that brought the visitor here. A visit ends with the
 * consent that allowed it, so the next one takes both from wherever the visitor
 * stands by then, or carries neither.
 */
function captureLandingAttribution(): void {
  const { search } = window.location;
  landingClickId = approvedClickId(search);
  landingCampaign = approvedAttribution(search);
}

/**
 * The same page, plus the Google Ads click id when this is the hit that opens
 * the visit. GA4 attributes a session from the location of its first hit, so
 * the id has to ride along there — and only there. It is therefore passed as a
 * parameter of that one `page_view` event, never to `config` or `set`: gtag
 * reads an event's own parameters ahead of both, so a click id left in either
 * would ride every later hit of the page too, including gtag's own automatic
 * events. The validated id needs no escaping; `approvedClickId` accepts
 * URL-safe characters only.
 */
function landingLocation(): string {
  const clean = cleanLocation();
  if (landingReported || landingClickId === null) return clean;
  return `${clean}?gclid=${landingClickId}`;
}

function setDisabled(disabled: boolean): void {
  (window as unknown as Record<string, unknown>)[DISABLE_FLAG] = disabled;
}

/**
 * Removes the cookies gtag set: host-only, and on the registrable domain gtag's
 * `cookie_domain: 'auto'` picks. A leading dot is ignored by browsers (RFC 6265
 * §5.2.3), so the dotted form also covers `domain=fluxradar.net`.
 */
export function clearAnalyticsCookies(): void {
  const names = ['_ga', `_ga_${GA_MEASUREMENT_ID.replace(/^G-/, '')}`];
  const domains = ['', `; domain=.${ANALYTICS_HOSTNAME}`];
  for (const name of names) {
    for (const domain of domains) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; path=/${domain}`;
    }
  }
}

function loadTag(): void {
  setDisabled(false);
  if (tagLoaded) return;
  tagLoaded = true;
  gtag('js', new Date());
  gtag('config', GA_MEASUREMENT_ID, {
    send_page_view: false,
    ...landingCampaign,
    page_location: cleanLocation(),
    page_referrer: analyticsReferrer(document.referrer, window.location.origin) ?? '',
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    // GA's default is two years; the cookie should not outlive the consent.
    cookie_expires: COOKIE_CONSENT_TTL_MS / 1000,
    cookie_flags: 'SameSite=Lax;Secure',
  });
  const script = document.createElement('script');
  script.id = GA_SCRIPT_ID;
  script.async = true;
  script.src = `${GA_SCRIPT_ORIGIN}/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
  document.head.appendChild(script);
}

/**
 * Ends measurement, and sets up the visit that may follow. A withdrawal takes
 * the `_ga` cookies with it, so the next allowance is a new client with a visit
 * of its own, and that visit needs a landing hit or the ad click behind it goes
 * unreported. A withdraw-and-allow cycle on the landing page therefore reports
 * the click once more: the deliberate choice of the lesser error — one extra
 * visit credited to a click that really happened, against losing a real click
 * altogether. The address is read again there, so a visitor who has meanwhile
 * moved on carries no id into the next visit.
 *
 * Only a visit that was running is re-opened that way. Calls that end nothing —
 * a refusal answered before analytics ever started, or a consent event from
 * another tab — leave the captured address alone, because by then the app may
 * have rewritten the one it was read from (`/plans` lands on the home page) and
 * a second read would drop the click of a visitor who has not yet said no for
 * good.
 */
function stop(): void {
  if (active) {
    setDisabled(true);
    landingReported = false;
    captureLandingAttribution();
  }
  active = false;
  lastPathname = null;
  lastLocation = null;
  if (isAnalyticsHost()) clearAnalyticsCookies();
}

/**
 * Follows the current consent. A page view is sent on activation only when the
 * visitor allows analytics mid-visit; at start-up the app sends the first one
 * itself, once the screen has set its title.
 */
function sync(sendPageView: boolean): void {
  if (!isAnalyticsHost() || !analyticsAllowed()) {
    stop();
    return;
  }
  if (active) return;
  active = true;
  loadTag();
  if (sendPageView) trackPageView();
}

function onConsentChange(): void {
  sync(true);
}

function onStorage(event: StorageEvent): void {
  if (event.key === COOKIE_CONSENT_KEY || event.key === null) sync(true);
}

/** True while hits may be sent; a consent that expired mid-visit ends it here. */
function measuring(): boolean {
  if (active && !analyticsAllowed()) stop();
  return active;
}

/** Points every later hit — page views and gtag's automatic events — at the cleaned page. */
function describeCurrentPage(): { readonly location: string; readonly title: string } {
  const page = { location: cleanLocation(), title: analyticsTitle(window.location.pathname) };
  gtag('set', { page_location: page.location, page_title: page.title });
  return page;
}

/** Call after every screen change; repeated calls for the same path are ignored. */
export function trackPageView(): void {
  if (!measuring()) return;
  const { pathname, origin } = window.location;
  if (pathname === lastPathname) return;
  const referrer = lastLocation ?? analyticsReferrer(document.referrer, origin);
  const hitLocation = landingLocation();
  const page = describeCurrentPage();
  gtag('event', 'page_view', {
    page_location: hitLocation,
    page_title: page.title,
    ...(referrer === undefined ? {} : { page_referrer: referrer }),
  });
  landingReported = true;
  lastPathname = pathname;
  lastLocation = page.location;
}

/** How gtag delivers one event; never part of what the event says. */
export interface DeliveryOptions {
  /**
   * Sent with the beacon transport, and called once gtag has handed it over —
   * for an event sent right before the page navigates away.
   */
  readonly onDelivered: () => void;
}

/** Sends one event; answers whether it was sent, so a caller can report a milestone once. */
export function trackEvent(
  name: string,
  params: AnalyticsParams = {},
  delivery?: DeliveryOptions,
): boolean {
  if (!measuring()) return false;
  describeCurrentPage();
  gtag(
    'event',
    name,
    delivery === undefined
      ? params
      : { ...params, transport_type: 'beacon', event_callback: delivery.onDelivered },
  );
  return true;
}

/** Starts following the visitor's consent. Safe to call more than once. */
export function startAnalytics(): void {
  if (started) return;
  started = true;
  captureLandingAttribution();
  window.addEventListener(COOKIE_CONSENT_CHANGE_EVENT, onConsentChange);
  window.addEventListener('storage', onStorage);
  sync(false);
}

/** Test seam: forgets the tag and the listeners' state so each test starts clean. */
export function resetAnalyticsForTests(): void {
  window.removeEventListener(COOKIE_CONSENT_CHANGE_EVENT, onConsentChange);
  window.removeEventListener('storage', onStorage);
  started = false;
  active = false;
  tagLoaded = false;
  landingReported = false;
  landingClickId = null;
  landingCampaign = null;
  lastPathname = null;
  lastLocation = null;
  delete window.dataLayer;
  document.getElementById(GA_SCRIPT_ID)?.remove();
}
