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
//   email-verification links put one-time tokens there) and no scan ids.
// - Every hit carries a cleaned title too. The printable report puts the
//   customer's audited domain in `document.title`, and gtag would otherwise
//   attach it to every scroll or engagement event on that page.
// - Signals and ad personalisation are off in the tag as well as in the
//   property, and the `_ga` cookies end with the consent that allowed them.

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

/** A referrer without its query, and with our own paths cleaned the same way. */
export function analyticsReferrer(referrer: string, origin: string): string | undefined {
  try {
    const url = new URL(referrer);
    const path = url.origin === origin ? analyticsPath(url.pathname) : url.pathname;
    return `${url.origin}${path}`;
  } catch {
    return undefined;
  }
}

function analyticsTitle(pathname: string): string {
  return SCAN_PATH.test(pathname) ? SCAN_PAGE_TITLE : document.title;
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

function stop(): void {
  if (active) setDisabled(true);
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
  const { origin, pathname } = window.location;
  const page = { location: `${origin}${analyticsPath(pathname)}`, title: analyticsTitle(pathname) };
  gtag('set', { page_location: page.location, page_title: page.title });
  return page;
}

/** Call after every screen change; repeated calls for the same path are ignored. */
export function trackPageView(): void {
  if (!measuring()) return;
  const { pathname, origin } = window.location;
  if (pathname === lastPathname) return;
  const referrer = lastLocation ?? analyticsReferrer(document.referrer, origin);
  const page = describeCurrentPage();
  gtag('event', 'page_view', {
    page_location: page.location,
    page_title: page.title,
    ...(referrer === undefined ? {} : { page_referrer: referrer }),
  });
  lastPathname = pathname;
  lastLocation = page.location;
}

export function trackEvent(name: string, params: AnalyticsParams = {}): void {
  if (!measuring()) return;
  describeCurrentPage();
  gtag('event', name, params);
}

/** Starts following the visitor's consent. Safe to call more than once. */
export function startAnalytics(): void {
  if (started) return;
  started = true;
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
  lastPathname = null;
  lastLocation = null;
  delete window.dataLayer;
  document.getElementById(GA_SCRIPT_ID)?.remove();
}
