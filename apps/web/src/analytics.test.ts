import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';

import { CookieConsent } from './CookieConsent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const GA_SESSION_COOKIE = `_ga_${GA_MEASUREMENT_ID.replace(/^G-/, '')}`;

/**
 * Every string `run` assigns to `document.cookie`. happy-dom's jar neither
 * honours a past `expires` nor reads a cookie back once it was written with a
 * `domain`, so the deletions themselves are what a test can watch — and they
 * are what matters here, because the domain each one carries is the point.
 */
function cookieWrites(run: () => void): readonly string[] {
  const written = vi.spyOn(document, 'cookie', 'set');
  try {
    run();
    return written.mock.calls.map(([value]) => String(value));
  } finally {
    written.mockRestore();
  }
}

/** Each cookie a deletion write names, as `name` or `name@<domain>`. */
function deletedCookies(writes: readonly string[]): readonly string[] {
  return writes
    .filter((write) => write.includes('Max-Age=0'))
    .map((write) => {
      const name = write.slice(0, write.indexOf('='));
      const domain = /; domain=([^;]+)/.exec(write)?.[1];
      return domain === undefined ? name : `${name}@${domain}`;
    });
}

/** Both forms of the same name: host-only, and the registrable domain. */
function bothDomainForms(names: readonly string[]): readonly string[] {
  return names.flatMap((name) => [name, `${name}@.fluxradar.net`]);
}

beforeEach(() => {
  resetAnalyticsForTests();
  window.localStorage.clear();
  document.title = 'FluxRadar';
  visit('https://fluxradar.net/');
});

afterEach(() => {
  cleanup();
  resetAnalyticsForTests();
  window.localStorage.clear();
  // Before the host changes back: a `domain=` write is rejected elsewhere.
  for (const name of ['_ga', GA_SESSION_COOKIE, '_gcl_aw', '_gcl_zz', 'fluxradar_session']) {
    document.cookie = `${name}=; Max-Age=0; path=/`;
    document.cookie = `${name}=; Max-Age=0; path=/; domain=.fluxradar.net`;
  }
  visit('http://localhost:3000/');
});

describe('consent-gated Google Analytics', () => {
  it.each([
    ['Accept all', true],
    ['Only necessary', false],
  ] as const)('%s gates analytics through the banner action', (action, allowed) => {
    startAnalytics();
    render(createElement(CookieConsent, { language: 'en' }));
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    expect(document.getElementById(GA_SCRIPT_ID)).toBeNull();
    expect(window.dataLayer).toBeUndefined();
    expect(window.localStorage.getItem('fluxradar.cookieConsent')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: action }));
    expect(
      JSON.parse(window.localStorage.getItem('fluxradar.cookieConsent') ?? 'null'),
    ).toMatchObject({
      preferences: allowed,
      analytics: allowed,
    });
    expect(document.getElementById(GA_SCRIPT_ID) !== null).toBe(allowed);
    expect(sentEvents('page_view')).toHaveLength(allowed ? 1 : 0);
  });

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

  // The click id belongs to one hit: the page view that opens the visit. gtag
  // reads an event's own parameters ahead of `config` and of `set`, so a click
  // id left in either would ride every later hit of the page as well — the next
  // screens' page views and gtag's own automatic events (user_engagement,
  // scroll, form_start, click, file_download) among them.
  it('carries the Google Ads click id in the landing page view alone, never in config or set', () => {
    const landing = 'https://fluxradar.net/?gclid=AbC-123_xyz';
    visit(`${landing}&reset_token=secret`);
    saveCookieConsent(EVERYTHING_ALLOWED);
    startAnalytics();
    trackPageView();
    trackEvent('sign_up', { method: 'email' });
    visit('https://fluxradar.net/faq?gclid=AbC-123_xyz');
    trackPageView();
    trackEvent('scroll', { percent_scrolled: 90 });

    // One call in the whole dataLayer names the click id, and it is the landing
    // page view's own parameters.
    expect(gtagCalls().filter((call) => JSON.stringify(call).includes('gclid'))).toEqual([
      ['event', 'page_view', expect.objectContaining({ page_location: landing })],
    ]);
    // Said the other way round, so a regression names the culprit: the tag is
    // configured with, and every later hit is pointed at, the cleaned page.
    const configured = gtagCalls().filter((call) => call[0] === 'config');
    const pointed = gtagCalls().filter((call) => call[0] === 'set');
    expect(configured).toHaveLength(1);
    expect(configured[0]?.[2]).toMatchObject({ page_location: 'https://fluxradar.net/' });
    expect(pointed.length).toBeGreaterThan(1);
    for (const call of [...configured, ...pointed]) {
      expect(JSON.stringify(call)).not.toContain('gclid');
    }
    expect(sentEvents('page_view').map((params) => params.page_location)).toEqual([
      landing,
      'https://fluxradar.net/faq',
    ]);
    expect(JSON.stringify(gtagCalls())).not.toContain('secret');
  });

  // A withdrawal ends the visit as GA sees it, and a new allowance opens the
  // next one — which needs a landing hit of its own, or the ad click that
  // brought the visitor here goes unreported.
  it('reports the click again when analytics is allowed a second time on the landing page', () => {
    const landing = 'https://fluxradar.net/?gclid=AbC-123_xyz';
    visit(landing);
    saveCookieConsent(EVERYTHING_ALLOWED);
    startAnalytics();
    trackPageView();
    saveCookieConsent(NECESSARY_ONLY);
    saveCookieConsent(EVERYTHING_ALLOWED);

    expect(sentEvents('page_view').map((params) => params.page_location)).toEqual([
      landing,
      landing,
    ]);
  });

  // A refusal ends no visit, so it must not re-read the address: by then the
  // app has rewritten it (an ad landing on /plans lands on the home page), and
  // a visitor who says no and then changes their mind on the same page is still
  // the first visit of that click.
  it('reports the click when a refusal is reconsidered on a rewritten landing page', () => {
    visit('https://fluxradar.net/plans?gclid=AbC-123_xyz');
    startAnalytics();
    visit('https://fluxradar.net/');
    saveCookieConsent(NECESSARY_ONLY);
    saveCookieConsent(EVERYTHING_ALLOWED);

    expect(sentEvents('page_view').map((params) => params.page_location)).toEqual([
      'https://fluxradar.net/?gclid=AbC-123_xyz',
    ]);
  });

  // The flag only re-opens the chance to report a click; the address decides.
  it('adds nothing on a re-allowance once the visitor has left the ad landing page', () => {
    visit('https://fluxradar.net/?gclid=AbC-123_xyz');
    saveCookieConsent(EVERYTHING_ALLOWED);
    startAnalytics();
    trackPageView();
    visit('https://fluxradar.net/faq');
    saveCookieConsent(NECESSARY_ONLY);
    saveCookieConsent(EVERYTHING_ALLOWED);

    expect(sentEvents('page_view').map((params) => params.page_location)).toEqual([
      'https://fluxradar.net/?gclid=AbC-123_xyz',
      'https://fluxradar.net/faq',
    ]);
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

  // Google's own opt-out from the conversion linker, which otherwise keeps the
  // ad click in first-party `_gcl_*` cookies. Nothing here reads them — the
  // click id travels in the landing page view's location and no Google Ads tag
  // is loaded — and they are in neither the Cookie Policy's inventory nor the
  // cookies a withdrawal used to clear. It is a config-time setting, taken
  // before gtag.js is requested: support.google.com/google-ads/answer/2476688.
  it('turns the conversion linker off in the config call, and nowhere else', () => {
    saveCookieConsent(EVERYTHING_ALLOWED);
    startAnalytics();
    trackPageView();
    trackEvent('sign_up', { method: 'email' });

    const configured = gtagCalls().filter((call) => call[0] === 'config');
    expect(configured).toHaveLength(1);
    expect(configured[0]?.[1]).toBe(GA_MEASUREMENT_ID);
    expect(configured[0]?.[2]).toMatchObject({
      conversion_linker: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    expect(
      gtagCalls().filter((call) => JSON.stringify(call).includes('conversion_linker')),
    ).toEqual(configured);
  });

  // The linker is off from now on, but a visitor who allowed analytics while it
  // was still on carries its cookie until a withdrawal clears it. Each name
  // goes on both domain forms gtag may have used, and `_gcl_zz` stands for a
  // name Google has not documented: only the prefix sweep reaches it.
  it('deletes the conversion linker’s cookies as well, on both domain forms', () => {
    saveCookieConsent(EVERYTHING_ALLOWED);
    startAnalytics();
    document.cookie = '_gcl_aw=GCL.1.click; path=/';
    document.cookie = '_gcl_zz=GCL.1.other; path=/';
    // The one necessary cookie in the Cookie Policy's inventory: it stays.
    document.cookie = 'fluxradar_session=keep; path=/';

    const writes = cookieWrites(() => saveCookieConsent(NECESSARY_ONLY));

    expect(new Set(deletedCookies(writes))).toEqual(
      new Set(
        bothDomainForms([
          '_ga',
          GA_SESSION_COOKIE,
          '_gcl_aw',
          '_gcl_au',
          '_gcl_dc',
          '_gcl_gb',
          '_gcl_gs',
          '_gcl_zz',
        ]),
      ),
    );
    expect(document.cookie).not.toContain('_gcl_');
    expect(document.cookie).toContain('fluxradar_session=keep');
  });

  // The linker kept a second copy outside the jar: a `_gcl_ls` entry in
  // localStorage, which no cookie deletion reaches. Confirmed in production
  // after an "Accept all" on fluxradar.net/?gclid=… — every visitor measured
  // before the opt-out shipped carries it until a withdrawal takes it away.
  // Swept by prefix, which is why `_gcl_x` goes as well, and never by name: the
  // app's own `fluxradar.*` keys answer to the consent record, not to this.
  it('removes the linker’s localStorage keys on withdrawal, and only those', () => {
    saveCookieConsent(EVERYTHING_ALLOWED);
    window.localStorage.setItem('fluxradar.language', 'uk');
    startAnalytics();
    window.localStorage.setItem('_gcl_ls', '{"sid":1}');
    window.localStorage.setItem('_gcl_x', 'another');

    // Analytics withdrawn, the language the visitor allowed left standing.
    expect(saveCookieConsent({ preferences: true, analytics: false })).toBe(true);

    expect(window.localStorage.getItem('_gcl_ls')).toBeNull();
    expect(window.localStorage.getItem('_gcl_x')).toBeNull();
    expect(window.localStorage.getItem('fluxradar.language')).toBe('uk');
    expect(
      JSON.parse(window.localStorage.getItem('fluxradar.cookieConsent') ?? 'null'),
    ).toMatchObject({ preferences: true, analytics: false });
    expect(disabledFlag()).toBe(true);
  });

  // Storage access can throw by itself where the browser has blocked site data,
  // and the withdrawal is the one thing that must still happen: gtag is told to
  // stop and its cookies go, read or not. The entry that could not be removed
  // stays — the honest outcome, and better than an unanswered banner.
  it('withdraws even when localStorage throws', () => {
    saveCookieConsent(EVERYTHING_ALLOWED);
    startAnalytics();
    window.localStorage.setItem('_gcl_ls', '{"sid":1}');
    document.cookie = '_gcl_aw=GCL.1.click; path=/';
    const blocked = vi.spyOn(window.localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('storage is blocked');
    });

    try {
      const writes = cookieWrites(() => {
        expect(() => saveCookieConsent(NECESSARY_ONLY)).not.toThrow();
      });

      expect(new Set(deletedCookies(writes))).toEqual(
        new Set(
          bothDomainForms([
            '_ga',
            GA_SESSION_COOKIE,
            '_gcl_aw',
            '_gcl_au',
            '_gcl_dc',
            '_gcl_gb',
            '_gcl_gs',
          ]),
        ),
      );
      expect(disabledFlag()).toBe(true);
    } finally {
      blocked.mockRestore();
    }
    expect(window.localStorage.getItem('_gcl_ls')).not.toBeNull();
  });

  // Both entries outlive the opt-out that stopped new ones: `_gcl_aw` has 90
  // days of its own and `_gcl_ls` has no expiry at all, so a visitor who
  // accepted analytics before the linker was turned off keeps them for months
  // while nothing reads either. Start-up therefore sweeps the prefix whatever
  // the visitor has answered — and sweeps nothing else: `_ga` is the tag's
  // working cookie and belongs to a consent that is still standing.
  it('sweeps the linker\u2019s leftovers at start-up with analytics still allowed', () => {
    saveCookieConsent(EVERYTHING_ALLOWED);
    window.localStorage.setItem('fluxradar.language', 'uk');
    document.cookie = '_ga=GA1.1.123.456; path=/';
    document.cookie = '_gcl_aw=GCL.1.click; path=/';
    document.cookie = '_gcl_zz=GCL.1.other; path=/';
    document.cookie = 'fluxradar_session=keep; path=/';
    window.localStorage.setItem('_gcl_ls', '{"sid":1}');

    const writes = cookieWrites(() => startAnalytics());

    expect(new Set(deletedCookies(writes))).toEqual(
      new Set(bothDomainForms(['_gcl_aw', '_gcl_au', '_gcl_dc', '_gcl_gb', '_gcl_gs', '_gcl_zz'])),
    );
    expect(document.cookie).not.toContain('_gcl_');
    expect(window.localStorage.getItem('_gcl_ls')).toBeNull();
    // What the standing consent allowed is left exactly as it was.
    expect(document.cookie).toContain('_ga=GA1.1.123.456');
    expect(document.cookie).toContain('fluxradar_session=keep');
    expect(window.localStorage.getItem('fluxradar.language')).toBe('uk');
    expect(disabledFlag()).toBe(false);
    expect(document.getElementById(GA_SCRIPT_ID)).not.toBeNull();
  });

  // A visitor who refused, or who has not answered the banner at all, is in the
  // same position: the entries are already on the device and nothing is ever
  // going to read them. The sweep waits for no consent event to arrive, and
  // still asks Google for nothing.
  it('sweeps the linker\u2019s leftovers at start-up with no consent on record', () => {
    document.cookie = '_gcl_aw=GCL.1.click; path=/';
    document.cookie = 'fluxradar_session=keep; path=/';
    window.localStorage.setItem('_gcl_ls', '{"sid":1}');

    startAnalytics();

    expect(document.cookie).not.toContain('_gcl_');
    expect(window.localStorage.getItem('_gcl_ls')).toBeNull();
    expect(document.cookie).toContain('fluxradar_session=keep');
    expect(window.dataLayer).toBeUndefined();
    expect(document.getElementById(GA_SCRIPT_ID)).toBeNull();
  });

  // Off production the tag never ran, so there is nothing of Google's to find,
  // and the jar belongs to whoever else answers on that host. The sweep takes
  // the host check the `_ga` cleanup already takes.
  it('leaves the jar and storage alone at start-up on a host other than production', () => {
    visit('http://localhost:3000/');
    saveCookieConsent(EVERYTHING_ALLOWED);
    document.cookie = '_gcl_aw=GCL.1.click; path=/';
    window.localStorage.setItem('_gcl_ls', '{"sid":1}');

    const writes = cookieWrites(() => startAnalytics());

    expect(deletedCookies(writes)).toEqual([]);
    expect(document.cookie).toContain('_gcl_aw=GCL.1.click');
    expect(window.localStorage.getItem('_gcl_ls')).toBe('{"sid":1}');
  });

  // Storage access can throw by itself where the browser has blocked site data,
  // and start-up is not allowed to fail with it: the cookies still go and the
  // consent on record still takes effect. The entry that could not be removed
  // stays — the honest outcome, and better than a page that never measures.
  it('starts up even when localStorage throws during the sweep', () => {
    saveCookieConsent(EVERYTHING_ALLOWED);
    document.cookie = '_gcl_aw=GCL.1.click; path=/';
    window.localStorage.setItem('_gcl_ls', '{"sid":1}');
    const blocked = vi.spyOn(window.localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('storage is blocked');
    });

    try {
      expect(() => startAnalytics()).not.toThrow();
      trackPageView();

      expect(document.cookie).not.toContain('_gcl_');
      expect(disabledFlag()).toBe(false);
      expect(sentEvents('page_view')).toHaveLength(1);
    } finally {
      blocked.mockRestore();
    }
    expect(window.localStorage.getItem('_gcl_ls')).toBe('{"sid":1}');
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
      'https://mail.example/',
    );
    expect(analyticsReferrer('https://fluxradar.net/scans/x?verify_email=t', origin)).toBe(
      'https://fluxradar.net/scans/:id',
    );
    expect(analyticsReferrer('', origin)).toBeUndefined();
  });
});
