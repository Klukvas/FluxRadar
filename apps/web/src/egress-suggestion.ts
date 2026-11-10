// Which country a scan should leave from when the owner has not chosen one.
//
// A site answers the visitors it is built for: a London plumber's site is read
// the way a London customer reads it, and a check from Kyiv can meet a geo
// block, a captcha or a different storefront instead (D-228). So the country
// nobody picked is guessed from the two things that say who the site serves:
// its own domain (.co.uk, .ca, .com.ua), then the person launching it (their
// browser's locale, or the request's Accept-Language). A generic .com with no
// hint goes to the United States, the largest English-speaking market.
//
// Mirrors `suggestEgressLocationId` in @fluxradar/contracts, which the API uses
// for a client that sends no country; the cases in egress-suggestion.test.ts
// are the same in both, so the screen shows the country the server would pick.

/** Country-code top-level domains, by the egress location id that serves them. */
const LOCATION_BY_TLD: Readonly<Record<string, string>> = {
  ua: 'ua',
  // .укр, as `new URL` hands it over (punycode).
  'xn--j1amh': 'ua',
  uk: 'gb',
  gb: 'gb',
  ca: 'ca',
  us: 'us',
};

/** Locale region subtags (en-GB, fr-CA), by the egress location id. */
const LOCATION_BY_REGION: Readonly<Record<string, string>> = {
  UA: 'ua',
  GB: 'gb',
  UK: 'gb',
  CA: 'ca',
  US: 'us',
};

/** A bare language says the country only when one country speaks it. */
const LOCATION_BY_LANGUAGE: Readonly<Record<string, string>> = {
  uk: 'ua',
};

/** Where a site with no hint at all is checked from. */
export const FALLBACK_EGRESS_LOCATION = 'us';

/**
 * The location id to use, among `available`, or null when none of the guesses
 * is on offer (the caller then falls back to the deployment's default).
 */
export function suggestEgressLocationId(
  site: string,
  available: readonly string[],
  visitorLocales: readonly string[] = [],
): string | null {
  const candidates = [
    locationFromSite(site),
    ...visitorLocales.map(locationFromLocale),
    FALLBACK_EGRESS_LOCATION,
  ];
  return candidates.find((id) => id !== null && available.includes(id)) ?? null;
}

function locationFromSite(site: string): string | null {
  const tld = hostOf(site).split('.').at(-1) ?? '';
  return LOCATION_BY_TLD[tld] ?? null;
}

function hostOf(site: string): string {
  const trimmed = site.trim().toLowerCase();
  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname.replace(
      /\.$/,
      '',
    );
  } catch {
    return '';
  }
}

function locationFromLocale(locale: string): string | null {
  const [language = '', ...subtags] = locale.trim().split(/[-_]/);
  const region = subtags.find((subtag) => /^[a-z]{2}$/i.test(subtag))?.toUpperCase();
  if (region !== undefined && LOCATION_BY_REGION[region] !== undefined) {
    return LOCATION_BY_REGION[region];
  }
  return LOCATION_BY_LANGUAGE[language.toLowerCase()] ?? null;
}
