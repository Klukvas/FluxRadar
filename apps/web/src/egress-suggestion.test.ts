import { describe, expect, it } from 'vitest';

import { suggestEgressLocationId } from './egress-suggestion';

const ALL = ['ua', 'us', 'gb', 'ca'];

describe('suggestEgressLocationId', () => {
  it.each([
    ['https://plumber.co.uk', 'gb'],
    ['https://shop.ca', 'ca'],
    ['https://clinic.com.ua', 'ua'],
    ['https://city.gov.us', 'us'],
    ['https://CLINIC.KIEV.UA.', 'ua'],
  ])('reads the country from the domain of %s', (site, expected) => {
    expect(suggestEgressLocationId(site, ALL, ['uk-UA'])).toBe(expected);
  });

  it('falls back to the visitor locale for a generic domain', () => {
    expect(suggestEgressLocationId('https://example.com', ALL, ['en-GB', 'en'])).toBe('gb');
    expect(suggestEgressLocationId('https://example.com', ALL, ['fr-CA'])).toBe('ca');
    expect(suggestEgressLocationId('https://example.com', ALL, ['uk'])).toBe('ua');
  });

  it('checks a generic domain with no hint from the United States', () => {
    expect(suggestEgressLocationId('https://example.com', ALL, ['de-DE', 'ru'])).toBe('us');
    expect(suggestEgressLocationId('example.io', ALL)).toBe('us');
  });

  it('only suggests a location that is on offer', () => {
    expect(suggestEgressLocationId('https://plumber.co.uk', ['ua', 'us'], [])).toBe('us');
    expect(suggestEgressLocationId('https://plumber.co.uk', ['ua'], [])).toBeNull();
    expect(suggestEgressLocationId('https://example.com', [], ['en-US'])).toBeNull();
  });

  it('survives a value that is not an address', () => {
    expect(suggestEgressLocationId('not a url at all', ALL)).toBe('us');
  });
});
