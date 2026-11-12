// Which country a scan should leave from when the owner has not chosen one.
//
// A site answers the visitors it is built for: a London plumber's site is read
// the way a London customer reads it, and a check from Kyiv can meet a geo
// block, a captcha or a different storefront instead (D-228). So the country
// nobody picked is guessed from what says who the site serves: its own domain
// (.co.uk, .ca, .com.ua), then where the profile says the business operates
// ("Київ, Україна" for a Kyiv studio on a .dev domain), then the person
// launching it (their browser's locale, or the request's Accept-Language). A generic .com with no
// hint goes to the United States, the largest English-speaking market.
//
// Shared by the API and the launch screen, so the country the screen shows is
// the one the server would pick for an older client that sends none.

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

/**
 * Country and city names an owner writes in the profile's "where does it
 * operate" field, by the egress location id, in English, Ukrainian and
 * Russian. Each name is a run of words; a word ending in `*` is a stem, so
 * the inflected forms the field is written in ("по Україні", "в Киеве")
 * match too. Any other word matches whole, so "Kyivstar" is not Kyiv.
 * Provinces and states are listed so "London, Ontario" names two countries
 * and is ignored rather than read as London, England.
 */
const LOCATION_BY_REGION_NAME: Readonly<Record<string, readonly string[]>> = {
  ua: [
    'ukraine',
    'україн*',
    'украин*',
    'ua',
    'kyiv',
    'kiev',
    'kyivska',
    'київ*',
    'києв*',
    'киев*',
    'lviv',
    'львів*',
    'львов*',
    'kharkiv',
    'харків*',
    'харков*',
    'харьков*',
    'odesa',
    'odessa',
    'одес*',
    'dnipro',
    'дніпр*',
    'днепр*',
    'zaporizhzhia',
    'запоріж*',
    'запорож*',
    'vinnytsia',
    'вінниц*',
    'винниц*',
    'poltava',
    'полтав*',
    'chernihiv',
    'черніг*',
    'черниг*',
    'zhytomyr',
    'житомир*',
    'rivne',
    'рівне',
    'рівному',
    'ровно',
    'lutsk',
    'луцьк*',
    'луцк*',
    'ternopil',
    'тернопіл*',
    'тернопол*',
    'uzhhorod',
    'ужгород*',
    'ivano frankivsk',
    'франківськ*',
    'франковск*',
    'mykolaiv',
    'миколаїв*',
    'миколаєв*',
    'николаев*',
    'kherson',
    'херсон*',
    'chernivtsi',
    'чернівц*',
    'черновц*',
    'cherkasy',
    'черкас*',
    'khmelnytskyi',
    'хмельницьк*',
    'хмельницк*',
    'sumy',
    'донецьк*',
    'донецк*',
    'donetsk',
    'луганськ*',
    'луганск*',
    'luhansk',
    'crimea',
    'крим*',
    'крым*',
    'kryvyi rih',
    'кривий ріг',
    'кривой рог',
    'kropyvnytskyi',
    'кропивницьк*',
    'mariupol',
    'маріупол*',
    'мариупол*',
    'kremenchuk',
    'кременчу*',
    'bila tserkva',
    'біла церква',
  ],
  gb: [
    'united kingdom',
    'great britain',
    'britain',
    'england',
    'scotland',
    'wales',
    'northern ireland',
    'uk',
    'u k',
    'gb',
    'великобритан*',
    'англія',
    'англії',
    'англия',
    'англии',
    'шотланд*',
    'london',
    'лондон*',
    'manchester',
    'манчестер*',
    'birmingham',
    'edinburgh',
    'glasgow',
    'liverpool',
    'leeds',
    'bristol',
  ],
  ca: [
    'canada',
    'канад*',
    'ontario',
    'онтаріо',
    'онтарио',
    'quebec',
    'québec',
    'british columbia',
    'alberta',
    'manitoba',
    'nova scotia',
    'toronto',
    'торонт*',
    'montreal',
    'montréal',
    'монреал*',
    'vancouver',
    'ванкувер*',
    'ottawa',
    'оттав*',
    'calgary',
    'калгар*',
  ],
  us: [
    'united states',
    'usa',
    'u s a',
    'u s',
    'us',
    'сша',
    'сполучен* штат*',
    'соединенн* штат*',
    'new york',
    'нью йорк*',
    'california',
    'каліфорні*',
    'калифорни*',
    'texas',
    'техас*',
    'florida',
    'флорид*',
    'chicago',
    'чикаго',
    'los angeles',
    'washington',
    'alabama',
    'arizona',
    'nevada',
    'oregon',
    'ohio',
    'illinois',
    'virginia',
    'pennsylvania',
    'massachusetts',
    'new jersey',
  ],
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
  profileRegion: string | null = null,
): string | null {
  const candidates = [
    locationFromSite(site),
    locationFromRegion(profileRegion),
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

/**
 * The country the profile says the business operates in, or null when the
 * field is empty, names no country we check from, or names more than one.
 */
function locationFromRegion(region: string | null): string | null {
  if (region === null) return null;
  const words = region
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '');
  const named = Object.entries(LOCATION_BY_REGION_NAME)
    .filter(([, names]) => names.some((name) => namedIn(words, name.split(' '))))
    .map(([id]) => id);
  return named.length === 1 ? (named[0] ?? null) : null;
}

/** Whether the words contain `name`'s words in a row, stems matching by prefix. */
function namedIn(words: readonly string[], name: readonly string[]): boolean {
  return words.some((_, start) =>
    name.every((part, offset) => {
      const word = words[start + offset];
      if (word === undefined) return false;
      return part.endsWith('*') ? word.startsWith(part.slice(0, -1)) : word === part;
    }),
  );
}

function locationFromLocale(locale: string): string | null {
  const [language = '', ...subtags] = locale.trim().split(/[-_]/);
  const region = subtags.find((subtag) => /^[a-z]{2}$/i.test(subtag))?.toUpperCase();
  if (region !== undefined && LOCATION_BY_REGION[region] !== undefined) {
    return LOCATION_BY_REGION[region];
  }
  return LOCATION_BY_LANGUAGE[language.toLowerCase()] ?? null;
}

/**
 * The language tags of an Accept-Language header, most preferred first; the
 * weights are dropped because the browser already lists them in that order.
 */
export function localesFromAcceptLanguage(header: string | undefined): readonly string[] {
  if (header === undefined) return [];
  return header
    .split(',')
    .map((part) => part.split(';')[0]?.trim() ?? '')
    .filter((tag) => tag !== '' && tag !== '*')
    .slice(0, 8);
}
