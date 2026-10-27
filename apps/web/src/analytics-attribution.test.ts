import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APPROVED_CAMPAIGN_PAIRS,
  approvedAttribution,
  approvedClickId,
} from './analytics-attribution';
import {
  analyticsReferrer,
  resetAnalyticsForTests,
  startAnalytics,
  trackPageView,
} from './analytics';
import { saveCookieConsent } from './browser-consent';

const parser = readFileSync(resolve(process.cwd(), 'public/blog/attribution.js'), 'utf8');
const sandbox: {
  readonly URLSearchParams: typeof URLSearchParams;
  readonly window: {
    fluxradarApprovedAttribution?: typeof approvedAttribution;
    fluxradarApprovedClickId?: typeof approvedClickId;
  };
} = { URLSearchParams, window: {} };
runInNewContext(parser, sandbox);
const blogAttribution = sandbox.window.fluxradarApprovedAttribution;
const blogClickId = sandbox.window.fluxradarApprovedClickId;
if (blogAttribution === undefined) throw new Error('Missing static attribution parser');
if (blogClickId === undefined) throw new Error('Missing static click-id parser');

/** One case per published pair; a source may publish more than one medium. */
const PUBLISHED_PAIRS = Object.entries(APPROVED_CAMPAIGN_PAIRS).flatMap(([source, media]) =>
  media.map((medium) => [source, medium] as const),
);
const calls = () =>
  (window.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));
const reportedPages = () =>
  calls()
    .filter((call) => call[0] === 'event' && call[1] === 'page_view')
    .map((call) => (call[2] as { page_location: string }).page_location);
const visit = (path: string) =>
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(
    `https://fluxradar.net${path}`,
  );
afterEach(() => {
  resetAnalyticsForTests();
  localStorage.clear();
  visit('/');
});

describe('bounded consented campaign attribution', () => {
  it.each(PUBLISHED_PAIRS)(
    'accepts only the published %s / %s pair in both runtimes',
    (source, medium) => {
      const query = `?utm_source=${source}&utm_medium=${medium}`;
      expect(approvedAttribution(query)).toEqual({
        campaign_source: source,
        campaign_medium: medium,
      });
      expect(blogAttribution(query)).toEqual(approvedAttribution(query));
    },
  );
  it.each(['?utm_source=chatgpt.com', '?utm_source=chatgpt.com&utm_medium=referral'])(
    'normalizes only the fixed vendor alias %s',
    (query) => {
      expect(approvedAttribution(query)).toEqual({
        campaign_source: 'chatgpt',
        campaign_medium: 'referral',
      });
      expect(blogAttribution(query)).toEqual(approvedAttribution(query));
    },
  );
  it.each([
    '',
    '?utm_source=instagram',
    '?utm_source=instagram&utm_medium=email',
    '?utm_source=Instagram&utm_medium=social',
    '?utm_source=person%40example.com&utm_medium=social',
    '?utm_source=instagram&utm_source=google&utm_medium=social',
    '?utm_source=instagram&utm_medium=social&utm_medium=organic',
    // The paid pair is published for google only, and only one at a time.
    '?utm_source=google&utm_medium=cpc&utm_medium=organic',
    '?utm_source=google&utm_medium=CPC',
    '?utm_source=instagram&utm_medium=cpc',
    '?utm_source=bing&utm_medium=cpc',
    '?reset_token=secret',
    '?utm_source=chatgpt.com&utm_medium=email',
    '?utm_source=chatgpt.com&utm_medium=referral&utm_medium=referral',
    '?utm_source=chatgpt.com&utm_source=chatgpt.com',
  ])('ignores absent, ambiguous and private query values %s', (query) => {
    expect(approvedAttribution(query)).toBeNull();
    expect(blogAttribution(query)).toBeNull();
  });
  it('reads the pair only after consent and emits neither raw queries nor extra campaign fields', () => {
    visit(
      '/uk?utm_source=instagram&utm_medium=social&utm_campaign=person%40example.com&reset_token=secret',
    );
    startAnalytics();
    expect(window.dataLayer).toBeUndefined();
    saveCookieConsent({ preferences: false, analytics: false });
    expect(window.dataLayer).toBeUndefined();
    saveCookieConsent({ preferences: false, analytics: true });
    const config = calls().find((call) => call[0] === 'config')?.[2];
    expect(config).toMatchObject({
      campaign_source: 'instagram',
      campaign_medium: 'social',
      page_location: 'https://fluxradar.net/uk',
    });
    expect(JSON.stringify(calls())).not.toMatch(
      /person%40|person@example|gclid|secret|utm_|campaign_name/,
    );
    const before = calls().length;
    saveCookieConsent({ preferences: false, analytics: false });
    trackPageView();
    expect(calls()).toHaveLength(before);
    saveCookieConsent({ preferences: false, analytics: true });
    expect(calls().filter((call) => call[0] === 'config')).toHaveLength(1);
  });
  // The pair is read when analytics starts, not when the tag is configured: an
  // ad landing on a route the app no longer serves rewrites its own address
  // first (an old /plans link opens the home pricing block), and a first-time
  // visitor answers the banner only after that. A send-time read would leave
  // the paid visit looking organic — exactly the campaign the money bought.
  it('keeps the campaign pair when the address is rewritten before consent is given', () => {
    visit('/plans?utm_source=google&utm_medium=cpc');
    startAnalytics();
    window.history.replaceState(null, '', '/');
    expect(window.dataLayer).toBeUndefined();

    saveCookieConsent({ preferences: false, analytics: true });

    expect(calls().find((call) => call[0] === 'config')?.[2]).toMatchObject({
      campaign_source: 'google',
      campaign_medium: 'cpc',
      page_location: 'https://fluxradar.net/',
    });
    expect(JSON.stringify(calls())).not.toMatch(/utm_|plans/);
  });

  it.each([
    'https://chatgpt.com/c/private-thread?token=secret',
    'https://mail.example/reset/private-token',
    'javascript:private',
    'file:///private/path',
  ])('removes private external paths and non-web referrers %s', (referrer) => {
    const result = analyticsReferrer(referrer, 'https://fluxradar.net');
    expect(result).toBe(referrer.startsWith('https:') ? new URL(referrer).origin + '/' : undefined);
    expect(JSON.stringify(result) ?? '').not.toMatch(/private|secret/);
  });
  it('leaves organic and ordinary referral classification to GA rather than inventing blank sources', () => {
    visit('/checks?utm_source=unapproved&utm_medium=organic');
    saveCookieConsent({ preferences: false, analytics: true });
    startAnalytics();
    const config = calls().find((call) => call[0] === 'config')?.[2];
    expect(config).not.toHaveProperty('campaign_source');
    expect(config).not.toHaveProperty('campaign_medium');
    expect(JSON.stringify(calls())).not.toContain('unapproved');
  });
});

// The Google Ads click id is the one query value allowed through, because GA4
// cannot tell a paid click from an organic visit without it. Everything that
// makes it safe is in these tests: one well-formed value, on the landing hit
// only, after consent only.
describe('the Google Ads click id', () => {
  const VALID_ID = 'Cj0KCQjw-6WZBhDV_AbCd-123';

  it.each([VALID_ID, 'a', 'A1_b-2', 'x'.repeat(200)])('accepts %s in both runtimes', (id) => {
    expect(approvedClickId(`?gclid=${id}`)).toBe(id);
    expect(blogClickId(`?gclid=${id}`)).toBe(id);
  });

  it.each([
    '',
    '?gclid=',
    '?gclid=&gclid=',
    `?gclid=${VALID_ID}&gclid=${VALID_ID}`,
    '?gclid=one&gclid=two',
    `?gclid=${'x'.repeat(201)}`,
    '?gclid=has%20space',
    '?gclid=person%40example.com',
    '?gclid=%3Cscript%3E',
    '?gclid=a.b',
    '?gclid=a%2Fb',
    '?gclid=a%26b',
    '?GCLID=uppercase-name',
    '?gclid_source=aw.ds',
    '?reset_token=secret',
  ])('rejects %s in both runtimes', (query) => {
    expect(approvedClickId(query)).toBeNull();
    expect(blogClickId(query)).toBeNull();
  });

  it('rides on the landing page view only, and only after consent', () => {
    visit(`/uk?gclid=${VALID_ID}&utm_source=google&utm_medium=cpc&reset_token=secret`);
    startAnalytics();
    expect(window.dataLayer).toBeUndefined();

    saveCookieConsent({ preferences: false, analytics: true });
    trackPageView();

    const landing = `https://fluxradar.net/uk?gclid=${VALID_ID}`;
    const views = calls().filter((call) => call[0] === 'event' && call[1] === 'page_view');
    expect(views).toHaveLength(1);
    expect(views[0]?.[2]).toMatchObject({ page_location: landing });
    // The tag is configured with the cleaned page, and the persistent page gtag
    // attaches to its own events is the cleaned one too: an event parameter
    // outranks both, so the id in either would outlive its one hit.
    expect(calls().find((call) => call[0] === 'config')?.[2]).toMatchObject({
      campaign_source: 'google',
      campaign_medium: 'cpc',
      page_location: 'https://fluxradar.net/uk',
    });
    expect(calls().find((call) => call[0] === 'set')?.[1]).toMatchObject({
      page_location: 'https://fluxradar.net/uk',
    });
    expect(
      calls()
        .filter((call) => call[0] === 'config' || call[0] === 'set')
        .map((call) => JSON.stringify(call))
        .filter((call) => call.includes('gclid')),
    ).toEqual([]);
    expect(JSON.stringify(calls())).not.toMatch(/secret|utm_/);
  });

  it('leaves the second screen of the visit without it', () => {
    visit(`/?gclid=${VALID_ID}`);
    saveCookieConsent({ preferences: false, analytics: true });
    startAnalytics();
    trackPageView();
    visit(`/faq?gclid=${VALID_ID}`);
    trackPageView();

    expect(reportedPages()).toEqual([
      `https://fluxradar.net/?gclid=${VALID_ID}`,
      'https://fluxradar.net/faq',
    ]);
  });

  // An ad can land on a route the app no longer serves: an old /plans link opens
  // the home pricing block and rewrites its own address (HomeScreen.tsx) in an
  // effect that runs before the first page view is sent. The click id belongs to
  // that visit either way, which is why it is read when analytics starts rather
  // than when the hit goes out.
  it('keeps the click id of a landing whose address is rewritten before the first page view', () => {
    visit(`/plans?gclid=${VALID_ID}&utm_source=google&utm_medium=cpc`);
    saveCookieConsent({ preferences: false, analytics: true });
    startAnalytics();
    window.history.replaceState(null, '', '/');
    trackPageView();

    expect(reportedPages()).toEqual([`https://fluxradar.net/?gclid=${VALID_ID}`]);
    // The campaign pair survives the rewrite for the same reason: the tag is
    // configured at start-up, before the address changes.
    expect(calls().find((call) => call[0] === 'config')?.[2]).toMatchObject({
      campaign_source: 'google',
      campaign_medium: 'cpc',
    });
    expect(
      calls()
        .filter((call) => call[0] === 'config' || call[0] === 'set')
        .filter((call) => JSON.stringify(call).includes('gclid')),
    ).toEqual([]);
  });

  // The same landing for a first-time visitor, who answers the banner after the
  // rewrite has already cleaned the address. This is the common shape of an ad
  // click, so the id has to outlive the rewrite here too.
  it('keeps the click id when the rewrite happens before consent is given', () => {
    visit(`/plans?gclid=${VALID_ID}`);
    startAnalytics();
    window.history.replaceState(null, '', '/');
    expect(window.dataLayer).toBeUndefined();

    saveCookieConsent({ preferences: false, analytics: true });

    expect(reportedPages()).toEqual([`https://fluxradar.net/?gclid=${VALID_ID}`]);
  });

  it.each(['?gclid=one&gclid=two', '?gclid=not%20a%20click%20id', `?gclid=${'x'.repeat(201)}`])(
    'drops the malformed query %s without reporting it',
    (query) => {
      visit(`/${query}`);
      saveCookieConsent({ preferences: false, analytics: true });
      startAnalytics();
      trackPageView();

      expect(calls().find((call) => call[0] === 'config')?.[2]).toMatchObject({
        page_location: 'https://fluxradar.net/',
      });
      expect(JSON.stringify(calls())).not.toContain('gclid');
    },
  );
});
