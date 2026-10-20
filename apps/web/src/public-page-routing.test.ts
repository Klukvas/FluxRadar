import { describe, expect, it } from 'vitest';
import {
  legacyPublicRedirect,
  matchingPublicSnapshot,
  publicPageRoute,
} from './public-page-routing';

describe('public locale routing', () => {
  it.each([
    ['/checks?lang=uk', '/uk/checks'],
    ['/checks/?a=1&lang=uk&b=x%20y#methodology', '/uk/checks?a=1&b=x%20y#methodology'],
    [
      '/?lang=uk&utm_source=instagram&utm_medium=social',
      '/uk?utm_source=instagram&utm_medium=social',
    ],
    ['/uk/checks?lang=uk', null],
    ['/profiles?lang=uk', null],
    ['/checks?lang=en', null],
    ['/checks?lang&lang=uk', null],
    ['/checks?lang=uk&lang=en', null],
    ['/checks?lang=%75k', null],
    ['/checks?l%61ng=uk', null],
    ['/?lang=uk&verify_email=token', null],
    ['/?lang=uk&reset_token=token', null],
    ['/?lang=uk&%72eset_token=token', null],
    ['/checkout/return?lang=uk&request_id=x', null],
  ])('migrates only the literal unambiguous legacy alias %s', (input, expected) => {
    expect(legacyPublicRedirect(input)).toBe(expected);
  });
  it.each([
    '/%63hecks',
    '//checks',
    '/./checks',
    '/other/../checks',
    '/uk//checks',
    '/%75k/checks',
    '/checks%2f',
  ])('recognizes only normalized known public paths %s', (path) => {
    expect(publicPageRoute(path)?.page).toBe('checks');
    expect(
      matchingPublicSnapshot(
        `checks:${path.includes('uk') || path.includes('%75k') ? 'uk' : 'en'}`,
        path,
        '',
      )?.page,
    ).toBe('checks');
  });
  it.each([
    '/%',
    '/%ZZ',
    '/%FF',
    '/%00checks',
    '/../../checks',
    '/Checks',
    '/profiles',
    '/%70rofiles',
    '/uk/profiles',
  ])('rejects malformed or non-public paths %s', (path) => {
    expect(publicPageRoute(path)).toBeNull();
  });
  it.each([
    '/%63hecks?lang=uk',
    '//checks?lang=uk',
    '/other/../checks?lang=uk',
    '/checks%2f?lang=uk',
  ])('parses an origin-form target as a path %s', (path) => {
    expect(legacyPublicRedirect(path)).toBe('/uk/checks');
  });
  it.each(['', '?lang=en', '?lang=invalid', '?lang=en&lang=uk'])(
    'hydrates a matching path locale for %s',
    (search) => {
      expect(matchingPublicSnapshot('checks:uk', '/uk/checks', search)).toEqual({
        page: 'checks',
        language: 'uk',
      });
    },
  );
  it('rejects stale, private, unknown and token snapshots', () => {
    expect(matchingPublicSnapshot('home:en', '/profiles', '')).toBeNull();
    expect(matchingPublicSnapshot('home:en', '/unknown', '')).toBeNull();
    expect(matchingPublicSnapshot('checks:en', '/uk/checks', '')).toBeNull();
    expect(matchingPublicSnapshot('home:en', '/', '?verify_email=x')).toBeNull();
    expect(publicPageRoute('/uk/checks/')).toEqual({ page: 'checks', language: 'uk' });
  });
});
