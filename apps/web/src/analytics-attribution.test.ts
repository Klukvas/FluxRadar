import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { APPROVED_CAMPAIGN_PAIRS, approvedAttribution } from './analytics-attribution';
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
  readonly window: { fluxradarApprovedAttribution?: typeof approvedAttribution };
} = { URLSearchParams, window: {} };
runInNewContext(parser, sandbox);
const blogAttribution = sandbox.window.fluxradarApprovedAttribution;
if (blogAttribution === undefined) throw new Error('Missing static attribution parser');
const calls = () =>
  (window.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));
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
  it.each(['ua_search_audit_test', 'ua_attribution_check'])(
    'accepts the fixed public Google Ads campaign %s in the SPA',
    (campaign) => {
      expect(
        approvedAttribution(`?utm_source=google&utm_medium=cpc&utm_campaign=${campaign}`),
      ).toEqual({
        campaign_source: 'google',
        campaign_medium: 'cpc',
        campaign_name: campaign,
      });
    },
  );
  it.each([
    '?utm_source=google&utm_medium=cpc',
    '?utm_source=google&utm_medium=cpc&utm_campaign=',
    '?utm_source=google&utm_medium=cpc&utm_campaign=person%40example.com',
    '?utm_source=google&utm_medium=cpc&utm_campaign=customer-site.example',
    '?utm_source=google&utm_medium=cpc&utm_campaign=ua_search_audit_test&utm_campaign=ua_search_audit_test',
    '?utm_source=google&utm_source=google&utm_medium=cpc&utm_campaign=ua_search_audit_test',
    '?utm_source=google&utm_medium=cpc&utm_medium=cpc&utm_campaign=ua_search_audit_test',
    '?utm_source=google&utm_medium=cpc&utm_campaign=UA_SEARCH_AUDIT_TEST',
  ])('rejects missing, ambiguous or private paid campaign labels %s', (query) => {
    expect(approvedAttribution(query)).toBeNull();
  });

  it.each(Object.entries(APPROVED_CAMPAIGN_PAIRS))(
    'accepts only the published %s pair in both runtimes',
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
    '?gclid=private&reset_token=secret',
    '?utm_source=chatgpt.com&utm_medium=email',
    '?utm_source=chatgpt.com&utm_medium=referral&utm_medium=referral',
    '?utm_source=chatgpt.com&utm_source=chatgpt.com',
  ])('ignores absent, ambiguous and private query values %s', (query) => {
    expect(approvedAttribution(query)).toBeNull();
    expect(blogAttribution(query)).toBeNull();
  });
  it('reads the pair only after consent and emits neither raw queries nor extra campaign fields', () => {
    visit(
      '/uk?utm_source=instagram&utm_medium=social&utm_campaign=person%40example.com&gclid=private&reset_token=secret',
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
