import { describe, expect, it } from 'vitest';

import { localesFromAcceptLanguage, suggestEgressLocationId } from './egress-suggestion.js';

const ALL = ['ua', 'us', 'gb', 'ca'];

describe('suggestEgressLocationId', () => {
  it.each([
    ['https://plumber.co.uk', 'gb'],
    ['https://shop.ca', 'ca'],
    ['https://clinic.com.ua', 'ua'],
    ['https://city.gov.us', 'us'],
    ['https://CLINIC.KIEV.UA.', 'ua'],
    ['https://магазин.укр', 'ua'],
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

  it('reads the country from the profile region when the domain says nothing', () => {
    expect(
      suggestEgressLocationId('https://studio.dev', ALL, ['ru', 'en-US'], 'Київ, Україна'),
    ).toBe('ua');
    expect(suggestEgressLocationId('https://shop.com', ALL, ['en-US'], 'Львов')).toBe('ua');
    expect(suggestEgressLocationId('https://shop.com', ALL, ['uk'], 'London, UK')).toBe('gb');
    expect(suggestEgressLocationId('https://shop.com', ALL, ['uk'], 'Toronto')).toBe('ca');
    expect(suggestEgressLocationId('https://shop.com', ALL, ['uk'], 'United States')).toBe('us');
  });

  it('lets the domain outrank the profile region', () => {
    expect(suggestEgressLocationId('https://plumber.co.uk', ALL, [], 'Київ')).toBe('gb');
  });

  it('ignores a region that names no country, or more than one', () => {
    expect(suggestEgressLocationId('https://shop.com', ALL, ['en-GB'], 'Berlin')).toBe('gb');
    expect(suggestEgressLocationId('https://shop.com', ALL, ['en-GB'], 'Ukraine and Canada')).toBe(
      'gb',
    );
    expect(suggestEgressLocationId('https://shop.com', ALL, ['en-GB'], '  ')).toBe('gb');
    expect(suggestEgressLocationId('https://shop.com', ALL, ['en-GB'], null)).toBe('gb');
  });

  it('matches region names as whole words, and stems in any case form', () => {
    const fromRegion = (region: string): string | null =>
      suggestEgressLocationId('https://shop.com', ALL, ['ru', 'en-US'], region);
    expect(fromRegion('Працюємо по Україні')).toBe('ua');
    expect(fromRegion('в Киеве и области')).toBe('ua');
    expect(fromRegion('м. Львова')).toBe('ua');
    expect(fromRegion('Харківська область')).toBe('ua');
    expect(fromRegion('Kyivska oblast')).toBe('ua');
    expect(fromRegion('Kyivstar office')).toBe('us');
    expect(fromRegion('U.S.')).toBe('us');
    expect(fromRegion('в Лондоне')).toBe('gb');
    expect(fromRegion('по всей Канаде')).toBe('ca');
    expect(fromRegion('Соединенные Штаты')).toBe('us');
  });

  it('ignores names that do not settle a country', () => {
    const fromRegion = (region: string): string | null =>
      suggestEgressLocationId('https://shop.com', ALL, ['en-GB'], region);
    expect(fromRegion('Московская область')).toBe('gb');
    expect(fromRegion('Latin America')).toBe('gb');
    expect(fromRegion('London, Ontario')).toBe('gb');
    expect(fromRegion('Odessa, Texas')).toBe('gb');
    expect(fromRegion('Russia')).toBe('gb');
  });

  it('skips a region whose country is not on offer', () => {
    expect(suggestEgressLocationId('https://shop.com', ['us', 'gb'], ['en-GB'], 'Київ')).toBe('gb');
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

describe('localesFromAcceptLanguage', () => {
  it('keeps the tags in the order the browser sent them', () => {
    expect(localesFromAcceptLanguage('en-GB,en;q=0.9,uk;q=0.8,*;q=0.1')).toEqual([
      'en-GB',
      'en',
      'uk',
    ]);
    expect(localesFromAcceptLanguage(undefined)).toEqual([]);
  });
});
