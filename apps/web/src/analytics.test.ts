import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  GA_SCRIPT_ID,
  analyticsPath,
  analyticsReferrer,
  resetAnalyticsForTests,
  startAnalytics,
  trackEvent,
  trackPageView,
} from './analytics';
import { GA_MEASUREMENT_ID, GA_SCRIPT_ORIGIN } from './analytics-config';
import { EVERYTHING_ALLOWED, NECESSARY_ONLY, saveCookieConsent } from './browser-consent';

type HappyWindow = { happyDOM: { setURL: (url: string) => void } };

function visit(url: string): void {
  (window as unknown as HappyWindow).happyDOM.setURL(url);
}

/** Each gtag call as a plain array — dataLayer holds `arguments` objects. */
function gtagCalls(): unknown[][] {
  return (window.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));
}

function sentEvents(name: string): Record<string, unknown>[] {
  return gtagCalls()
    .filter((call) => call[0] === 'event' && call[1] === name)
    .map((call) => call[2] as Record<string, unknown>);
}

function disabledFlag(): unknown {
  return (window as unknown as Record<string, unknown>)[`ga-disable-${GA_MEASUREMENT_ID}`];
}

beforeEach(() => {
  resetAnalyticsForTests();
  window.localStorage.clear();
  document.title = 'FluxRadar';
  visit('https://fluxradar.net/');
});

afterEach(() => {
  resetAnalyticsForTests();
  window.localStorage.clear();
  document.cookie = '_ga=; Max-Age=0; path=/';
  visit('http://localhost:3000/');
});

describe('consent-gated Google Analytics', () => {
  it('requests nothing from Google before the visitor allows analytics', () => {
    saveCookieConsent({ preferences: true, analytics: false });
    startAnalytics();
    trackPageView();
    trackEvent('sign_up', { method: 'email' });

    expect(document.getElementById(GA_SCRIPT_ID)).toBeNull();
    expect(window.dataLayer).toBeUndefined();
  });

  // Dev servers, previews and a local Docker build share the code but must never
  // report into the production property, even after "Allow all".
  it('stays off on any host other than production', () => {
    visit('http://localhost:5199/');
    saveCookieConsent(EVERYTHING_ALLOWED);
    startAnalytics();
    trackPageView();

    expect(document.getElementById(GA_SCRIPT_ID)).toBeNull();
    expect(window.dataLayer).toBeUndefined();
  });

  it('loads gtag.js from the allowed origin with signals and ad personalisation off', () => {
    saveCookieConsent(EVERYTHING_ALLOWED);
    startAnalytics();

    const script = document.getElementById(GA_SCRIPT_ID) as HTMLScriptElement | null;
    expect(script?.src).toBe(`${GA_SCRIPT_ORIGIN}/gtag/js?id=${GA_MEASUREMENT_ID}`);
    const config = gtagCalls().find((call) => call[0] === 'config');
    expect(config?.[1]).toBe(GA_MEASUREMENT_ID);
    expect(config?.[2]).toMatchObject({
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      cookie_expires: 180 * 24 * 60 * 60,
    });
  });

  it('starts when analytics is allowed mid-visit and reports the page without its query', () => {
    visit('https://fluxradar.net/?reset_token=one-time-secret');
    document.title = 'FluxRadar — public website audit';
    startAnalytics();
    expect(window.dataLayer).toBeUndefined();

    saveCookieConsent({ preferences: false, analytics: true });

    const [pageView] = sentEvents('page_view');
    expect(pageView).toMatchObject({
      page_location: 'https://fluxradar.net/',
      page_title: 'FluxRadar — public website audit',
    });
    expect(JSON.stringify(window.dataLayer)).not.toContain('one-time-secret');
  });

  // The printable report puts the audited domain in document.title; neither the
  // scan id nor that domain belongs in the visitor statistics.
  it('reports scan screens by their shape, never by scan id or audited domain', () => {
    saveCookieConsent(EVERYTHING_ALLOWED);
    startAnalytics();
    visit('https://fluxradar.net/scans/scan_123/report');
    document.title = 'FluxRadar report — customer-site.example';
    trackPageView();
    trackEvent('scroll');

    expect(sentEvents('page_view')[0]).toMatchObject({
      page_location: 'https://fluxradar.net/scans/:id/report',
      page_title: 'FluxRadar scan',
    });
    const sent = JSON.stringify(gtagCalls());
    expect(sent).not.toContain('scan_123');
    expect(sent).not.toContain('customer-site.example');
  });

  it('sends one page view per screen and names the previous screen as referrer', () => {
    saveCookieConsent(EVERYTHING_ALLOWED);
    startAnalytics();
    trackPageView();
    trackPageView();
    visit('https://fluxradar.net/faq');
    trackPageView();

    const views = sentEvents('page_view');
    expect(views).toHaveLength(2);
    expect(views[1]).toMatchObject({
      page_location: 'https://fluxradar.net/faq',
      page_referrer: 'https://fluxradar.net/',
    });
  });

  it('stops sending and deletes its cookies when the visitor withdraws', () => {
    saveCookieConsent(EVERYTHING_ALLOWED);
    startAnalytics();
    document.cookie = '_ga=GA1.1.123.456; path=/';

    saveCookieConsent(NECESSARY_ONLY);
    const before = gtagCalls().length;
    trackEvent('sign_up', { method: 'email' });

    expect(disabledFlag()).toBe(true);
    expect(document.cookie).not.toContain('_ga=');
    expect(gtagCalls()).toHaveLength(before);
  });

  it('resumes after a new allowance without loading the tag twice', () => {
    saveCookieConsent(EVERYTHING_ALLOWED);
    startAnalytics();
    saveCookieConsent(NECESSARY_ONLY);
    saveCookieConsent(EVERYTHING_ALLOWED);
    trackEvent('login', { method: 'email' });

    expect(disabledFlag()).toBe(false);
    expect(document.querySelectorAll(`#${GA_SCRIPT_ID}`)).toHaveLength(1);
    expect(sentEvents('login')).toEqual([{ method: 'email' }]);
  });
});

describe('what a reported location may contain', () => {
  it.each([
    ['/scans/abc', '/scans/:id'],
    ['/scans/abc/issues', '/scans/:id/issues'],
    ['/scans/abc/report', '/scans/:id/report'],
    ['/profiles', '/profiles'],
    ['/blog/ai-crawler-readiness', '/blog/ai-crawler-readiness'],
  ])('reports %s as %s', (path, reported) => {
    expect(analyticsPath(path)).toBe(reported);
  });

  it('drops the query from any referrer and cleans our own paths', () => {
    const origin = 'https://fluxradar.net';
    expect(analyticsReferrer('https://mail.example/inbox?user=a@b.c', origin)).toBe(
      'https://mail.example/inbox',
    );
    expect(analyticsReferrer('https://fluxradar.net/scans/x?verify_email=t', origin)).toBe(
      'https://fluxradar.net/scans/:id',
    );
    expect(analyticsReferrer('', origin)).toBeUndefined();
  });
});
