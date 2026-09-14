// Deciding which profile each Search Console domain of one Google account feeds.

import { describe, expect, it } from 'vitest';

import type { GoogleBinding, SiteProfile } from './api';
import { googleDomainRows } from './google-domains';

const profile = (id: string, domain: string): SiteProfile => ({ id, name: id, domain });

const binding = (siteProfileId: string, searchConsoleSiteUrl: string | null): GoogleBinding => ({
  siteProfileId,
  searchConsoleSiteUrl,
  ga4PropertyId: null,
  ga4PropertyName: null,
  updatedAt: '2026-09-14T00:00:00.000Z',
});

const sites = (...siteUrls: string[]) => siteUrls.map((siteUrl) => ({ siteUrl }));

describe('google domain rows', () => {
  it('names every profile that already reads a domain', () => {
    const [row] = googleDomainRows(
      sites('sc-domain:example.com'),
      [profile('shop', 'https://shop.example.com'), profile('apex', 'https://example.com')],
      [binding('shop', 'sc-domain:example.com'), binding('apex', 'sc-domain:example.com')],
    );

    expect(row).toMatchObject({ kind: 'linked', profiles: [{ id: 'shop' }, { id: 'apex' }] });
  });

  it('offers the profile at a domain property’s own host before one on a subdomain', () => {
    const [row] = googleDomainRows(
      sites('sc-domain:example.com'),
      [profile('www', 'https://www.example.com'), profile('apex', 'https://example.com')],
      [],
    );

    expect(row).toMatchObject({ kind: 'matching', profile: { id: 'apex' } });
  });

  it('covers a subdomain only through a domain property', () => {
    const www = [profile('www', 'https://www.example.com')];

    expect(googleDomainRows(sites('sc-domain:example.com'), www, [])[0]).toMatchObject({
      kind: 'matching',
    });
    expect(googleDomainRows(sites('https://example.com/'), www, [])[0]).toMatchObject({
      kind: 'unlinked',
    });
  });

  // A profile at the address that already reads another domain can neither be
  // linked (that would replace its choice) nor duplicated by Create (addresses
  // are unique per account), so the row opens it instead.
  it('opens the profile at the address when it already reads another domain', () => {
    const [row] = googleDomainRows(
      sites('https://example.com/'),
      [profile('apex', 'https://example.com')],
      [binding('apex', 'sc-domain:example.com')],
    );

    expect(row).toMatchObject({ kind: 'occupied', profile: { id: 'apex' } });
  });

  it('prefers a free profile on a subdomain over a busy one at the address', () => {
    const [row] = googleDomainRows(
      sites('sc-domain:example.com'),
      [profile('apex', 'https://example.com'), profile('www', 'https://www.example.com')],
      [binding('apex', 'https://example.com/')],
    );

    expect(row).toMatchObject({ kind: 'matching', profile: { id: 'www' } });
  });

  it('says an http property cannot become an audited address instead of offering Create', () => {
    const [row] = googleDomainRows(sites('http://example.com/'), [], []);

    expect(row).toMatchObject({ kind: 'unsupported', reason: 'insecure_scheme' });
  });

  it('offers a profile whose binding holds only an Analytics property', () => {
    const [row] = googleDomainRows(
      sites('sc-domain:example.com'),
      [profile('apex', 'https://example.com')],
      [binding('apex', null)],
    );

    expect(row).toMatchObject({ kind: 'matching', profile: { id: 'apex' } });
  });
});
